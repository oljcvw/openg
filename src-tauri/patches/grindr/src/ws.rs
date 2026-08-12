use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, watch};
use tokio::time::{interval_at, sleep, Instant, MissedTickBehavior};
use wreq::websocket::{CloseCode, CloseFrame, Message, Utf8Bytes, WebSocket};

use crate::auth::{AuthState, Session};
use crate::error::GrindrError;
use crate::headers::GrindrHeaders;
use crate::rest::InnerClient;

const WS_URL: &str = "wss://grindr.mobi/v1/ws";

const WS_BROADCAST_CAPACITY: usize = 256;
const PING_INTERVAL: Duration = Duration::from_secs(10);
const RETRY_STEP: Duration = Duration::from_secs(5);
const RETRY_NOMINAL_CAP: Duration = Duration::from_secs(180);

#[derive(Debug, Clone, PartialEq, Eq)]
struct Eligibility {
	control_generation: u64,
	session_id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum DisconnectDisposition {
	WaitForNewEligibility,
	RefreshSession,
	Retry,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum ConnectionOutcome {
	Interrupted,
	WaitForNewEligibility(Eligibility),
	RefreshSession(Eligibility),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MessageLoopExit {
	Interrupted,
	NormalRemoteClose,
	InvalidSession,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PingTick {
	Send,
	TimedOut { successful_ping_pongs: u64 },
}

#[derive(Debug, Default)]
struct Heartbeat {
	awaiting_pong: bool,
	successful_ping_pongs: u64,
}

impl Heartbeat {
	fn on_ping_tick(&mut self) -> PingTick {
		if self.awaiting_pong {
			return PingTick::TimedOut {
				successful_ping_pongs: self.successful_ping_pongs,
			};
		}
		self.awaiting_pong = true;
		PingTick::Send
	}

	fn on_pong(&mut self) {
		if self.awaiting_pong {
			self.awaiting_pong = false;
			self.successful_ping_pongs =
				self.successful_ping_pongs.saturating_add(1);
		}
	}
}

trait WsTransport {
	fn send_message(
		&mut self,
		message: Message,
	) -> Pin<Box<dyn Future<Output = Result<(), GrindrError>> + Send + '_>>;

	fn next_message(
		&mut self,
	) -> Pin<
		Box<
			dyn Future<Output = Option<Result<Message, GrindrError>>>
				+ Send
				+ '_,
		>,
	>;
}

impl WsTransport for WebSocket {
	fn send_message(
		&mut self,
		message: Message,
	) -> Pin<Box<dyn Future<Output = Result<(), GrindrError>> + Send + '_>> {
		Box::pin(async move {
			self.send(message)
				.await
				.map_err(|error| GrindrError::Http(error.to_string()))
		})
	}

	fn next_message(
		&mut self,
	) -> Pin<
		Box<
			dyn Future<Output = Option<Result<Message, GrindrError>>>
				+ Send
				+ '_,
		>,
	> {
		Box::pin(async move {
			self.next().await.map(|result| {
				result.map_err(|error| GrindrError::Http(error.to_string()))
			})
		})
	}
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) struct WsControl {
	pub enabled: bool,
	pub generation: u64,
}

/// A command to send over the websocket.
///
/// The client adds the session token; you set `type`, `ref_id`, and `payload`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WsCommand {
	/// Command type, e.g. `"chat.v1.message.send"`.
	pub r#type: String,
	/// Your id for this command, echoed back in the reply.
	pub ref_id: String,
	/// The command payload.
	pub payload: Value,
}

/// An event received over the websocket.
#[derive(Debug, Clone)]
pub struct WsEvent {
	/// The event's `type` field.
	pub event_type: String,
	/// The full event JSON, including the `type` field.
	pub payload: Value,
}

/// Whether the websocket is connected.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum WsConnectionState {
	/// Not connected (logged out, reconnecting, or backing off).
	#[default]
	Disconnected,
	/// Connected and ready to send and receive.
	Connected,
}

pub(crate) struct WsChannels {
	pub event_tx: broadcast::Sender<WsEvent>,
	pub state_tx: watch::Sender<WsConnectionState>,
}

pub(crate) fn make_channels() -> (WsChannels, WsHandles) {
	let (event_tx, _) = broadcast::channel(WS_BROADCAST_CAPACITY);
	let (cmd_tx, cmd_rx) = mpsc::channel(64);
	let (state_tx, state_rx) = watch::channel(WsConnectionState::Disconnected);
	let (control_tx, control_rx) = watch::channel(WsControl::default());

	let channels = WsChannels {
		event_tx: event_tx.clone(),
		state_tx,
	};
	let handles = WsHandles {
		cmd_tx,
		cmd_rx,
		state_rx,
		control_tx,
		control_rx,
	};
	(channels, handles)
}

pub(crate) struct WsHandles {
	pub cmd_tx: mpsc::Sender<WsCommand>,
	pub cmd_rx: mpsc::Receiver<WsCommand>,
	pub state_rx: watch::Receiver<WsConnectionState>,
	pub control_tx: watch::Sender<WsControl>,
	pub control_rx: watch::Receiver<WsControl>,
}

pub(crate) fn spawn_ws_task(
	inner: Arc<InnerClient>,
	auth: Arc<AuthState>,
	channels: WsChannels,
	mut cmd_rx: mpsc::Receiver<WsCommand>,
	mut control_rx: watch::Receiver<WsControl>,
) {
	tokio::spawn(async move {
		let mut session_rx = auth.session_tx.subscribe();
		let mut retry_attempt = 1_u64;
		let mut blocked_eligibility = None;

		while let Some(eligibility) = wait_until_ready(
			&auth,
			&mut session_rx,
			&mut control_rx,
			blocked_eligibility.as_ref(),
		)
		.await
		{
			blocked_eligibility = None;
			match connect_and_run(
				&inner,
				&auth,
				&channels,
				&mut cmd_rx,
				&mut session_rx,
				&mut control_rx,
				&eligibility,
				&mut retry_attempt,
			)
			.await
			{
				Ok(ConnectionOutcome::Interrupted) => {
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);
					retry_attempt = 1;
				}
				Ok(ConnectionOutcome::WaitForNewEligibility(closed)) => {
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);
					tracing::info!(
						"[ws] normal remote close; waiting for new eligibility"
					);
					blocked_eligibility = Some(closed);
					retry_attempt = 1;
				}
				Ok(ConnectionOutcome::RefreshSession(rejected)) => {
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);
					tracing::warn!(
						"[ws] invalid session; refreshing before reconnect"
					);
					let inner = &inner;
					let auth = &auth;
					blocked_eligibility = refresh_before_reconnect(
						rejected,
						|session_id| async move {
							crate::auth::refresh_after_unauthorized(
								&inner,
								&auth,
								&session_id,
							)
							.await
						},
					)
					.await;
					retry_attempt = 1;
				}
				Err(GrindrError::Auth(_)) => {
					tracing::warn!("[ws] auth error, waiting for next login");
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);
					retry_attempt = 1;
				}
				Err(e) => {
					let _ =
						channels.state_tx.send(WsConnectionState::Disconnected);

					if auth.session.read().await.is_none()
						|| !control_active(
							&control_rx,
							eligibility.control_generation,
						) {
						retry_attempt = 1;
						drain_pending_commands(&mut cmd_rx);
						continue;
					}
					let retry_delay = retry_delay(retry_attempt);
					tracing::warn!(attempt = retry_attempt, "[ws] connection error: {e}; retrying in {retry_delay:?}");
					if !wait_for_retry(
						retry_delay,
						&mut session_rx,
						&mut control_rx,
						eligibility.control_generation,
					)
					.await
					{
						retry_attempt = 1;
						drain_pending_commands(&mut cmd_rx);
						continue;
					}
					retry_attempt = retry_attempt.saturating_add(1);
				}
			}
			drain_pending_commands(&mut cmd_rx);
		}
	});
}

async fn refresh_before_reconnect<Refresh, RefreshFuture>(
	rejected: Eligibility,
	refresh: Refresh,
) -> Option<Eligibility>
where
	Refresh: FnOnce(String) -> RefreshFuture,
	RefreshFuture: std::future::Future<Output = bool>,
{
	let rejected_session_id = rejected.session_id.clone();
	if refresh(rejected_session_id).await {
		None
	} else {
		Some(rejected)
	}
}

async fn wait_until_ready(
	auth: &AuthState,
	session_rx: &mut watch::Receiver<Option<Session>>,
	control_rx: &mut watch::Receiver<WsControl>,
	blocked: Option<&Eligibility>,
) -> Option<Eligibility> {
	loop {
		let control = *control_rx.borrow_and_update();
		let session_id = session_token(auth).await;
		if let (true, Some(session_id)) = (control.enabled, session_id) {
			let eligibility = Eligibility {
				control_generation: control.generation,
				session_id,
			};
			if eligibility_is_new(&eligibility, blocked) {
				return Some(eligibility);
			}
		}
		tokio::select! {
			changed = control_rx.changed() => changed.ok()?,
			changed = session_rx.changed() => changed.ok()?,
		}
	}
}

fn eligibility_is_new(
	current: &Eligibility,
	blocked: Option<&Eligibility>,
) -> bool {
	blocked != Some(current)
}

fn classify_server_close(code: Option<CloseCode>) -> DisconnectDisposition {
	match code.map(|code| code.0) {
		Some(1000) => DisconnectDisposition::WaitForNewEligibility,
		Some(3000 | 4401) => DisconnectDisposition::RefreshSession,
		_ => DisconnectDisposition::Retry,
	}
}

fn classify_upgrade_status(status: wreq::StatusCode) -> DisconnectDisposition {
	if status == wreq::StatusCode::UNAUTHORIZED {
		DisconnectDisposition::RefreshSession
	} else {
		DisconnectDisposition::Retry
	}
}

fn control_active(
	control_rx: &watch::Receiver<WsControl>,
	generation: u64,
) -> bool {
	let control = *control_rx.borrow();
	control.enabled && control.generation == generation
}

async fn wait_for_retry(
	delay: Duration,
	session_rx: &mut watch::Receiver<Option<Session>>,
	control_rx: &mut watch::Receiver<WsControl>,
	generation: u64,
) -> bool {
	tokio::select! {
		_ = sleep(delay) => control_active(control_rx, generation),
		_ = control_rx.changed() => false,
		_ = session_rx.changed() => false,
	}
}

fn drain_pending_commands(cmd_rx: &mut mpsc::Receiver<WsCommand>) {
	while cmd_rx.try_recv().is_ok() {}
}

fn retry_delay(attempt: u64) -> Duration {
	let nominal_ms = RETRY_STEP
		.as_millis()
		.saturating_mul(u128::from(attempt))
		.min(RETRY_NOMINAL_CAP.as_millis()) as u64;
	let half_ms = nominal_ms / 2;
	Duration::from_millis(half_ms + rand::random_range(0..half_ms))
}

async fn connect_and_run(
	inner: &InnerClient,
	auth: &AuthState,
	channels: &WsChannels,
	cmd_rx: &mut mpsc::Receiver<WsCommand>,
	session_rx: &mut watch::Receiver<Option<Session>>,
	control_rx: &mut watch::Receiver<WsControl>,
	eligibility: &Eligibility,
	retry_attempt: &mut u64,
) -> Result<ConnectionOutcome, GrindrError> {
	let generation = eligibility.control_generation;
	let authorization = tokio::select! {
		_ = control_rx.changed() => return Ok(ConnectionOutcome::Interrupted),
		authorization = crate::auth::authorization_header(inner, auth) => authorization,
	}
	.ok_or_else(|| GrindrError::Auth("not logged in".to_owned()))?;
	if !control_active(control_rx, generation) {
		return Ok(ConnectionOutcome::Interrupted);
	}
	let Some(session_id) = session_token(auth).await else {
		return Ok(ConnectionOutcome::Interrupted);
	};
	let active_eligibility = Eligibility {
		control_generation: generation,
		session_id,
	};

	let fp = inner.fingerprint().await;
	let headers = GrindrHeaders::build(
		&fp.device,
		&fp.user_agent,
		Some(&authorization),
		Some("[FREE]"),
	)?;

	let mut builder = fp.ws_http.websocket(WS_URL);
	for (name, value) in &headers.items {
		builder = builder.header(name.clone(), value.clone());
	}

	let response = tokio::select! {
		_ = control_rx.changed() => return Ok(ConnectionOutcome::Interrupted),
		response = builder.send() => response,
	}
	.map_err(|e| GrindrError::Http(format!("WS connect failed: {e}")))?;
	if !control_active(control_rx, generation) {
		return Ok(ConnectionOutcome::Interrupted);
	}
	if classify_upgrade_status(response.status())
		== DisconnectDisposition::RefreshSession
	{
		return Ok(ConnectionOutcome::RefreshSession(active_eligibility));
	}

	let mut ws = tokio::select! {
		_ = control_rx.changed() => return Ok(ConnectionOutcome::Interrupted),
		websocket = response.into_websocket() => websocket,
	}
	.map_err(|e| GrindrError::Http(format!("WS upgrade failed: {e}")))?;
	if !control_active(control_rx, generation) {
		return Ok(ConnectionOutcome::Interrupted);
	}

	let outcome = run_message_loop(
		&mut ws,
		cmd_rx,
		auth,
		session_rx,
		control_rx,
		generation,
		retry_attempt,
		PING_INTERVAL,
		&channels.state_tx,
		&channels.event_tx,
	)
	.await?;
	Ok(match outcome {
		MessageLoopExit::Interrupted => ConnectionOutcome::Interrupted,
		MessageLoopExit::NormalRemoteClose => {
			ConnectionOutcome::WaitForNewEligibility(active_eligibility)
		}
		MessageLoopExit::InvalidSession => {
			ConnectionOutcome::RefreshSession(active_eligibility)
		}
	})
}

async fn session_token(auth: &AuthState) -> Option<String> {
	auth.session
		.read()
		.await
		.as_ref()
		.map(|s| s.session_id.clone())
}

async fn run_message_loop<Transport: WsTransport + Send>(
	ws: &mut Transport,
	cmd_rx: &mut mpsc::Receiver<WsCommand>,
	auth: &AuthState,
	session_rx: &mut watch::Receiver<Option<Session>>,
	control_rx: &mut watch::Receiver<WsControl>,
	generation: u64,
	retry_attempt: &mut u64,
	ping_interval: Duration,
	state_tx: &watch::Sender<WsConnectionState>,
	event_tx: &broadcast::Sender<WsEvent>,
) -> Result<MessageLoopExit, GrindrError> {
	if session_token(auth).await.is_none() {
		return Ok(MessageLoopExit::Interrupted);
	}

	let mut ping = interval_at(Instant::now() + ping_interval, ping_interval);
	ping.set_missed_tick_behavior(MissedTickBehavior::Delay);
	let mut heartbeat = Heartbeat::default();
	loop {
		tokio::select! {
			_ = control_rx.changed() => {
					if !control_active(control_rx, generation) {
						close_normally(ws).await;
						return Ok(MessageLoopExit::Interrupted);
					}
			}
			changed = session_rx.changed() => {
				let logged_out = changed.is_err() || session_rx.borrow_and_update().is_none();
					if logged_out {
						close_normally(ws).await;
						return Ok(MessageLoopExit::Interrupted);
					}
				}
				_ = ping.tick() => {
					if let PingTick::TimedOut { successful_ping_pongs } = heartbeat.on_ping_tick() {
						return Err(GrindrError::Http(format!(
							"WS pong timeout after {ping_interval:?} ({successful_ping_pongs} successful ping/pongs)",
						)));
					}
					ws.send_message(Message::ping(Vec::<u8>::new())).await?;
				}
				msg = ws.next_message() => match msg {
				Some(Ok(Message::Text(text))) => {
					if let Ok(payload) = serde_json::from_str::<Value>(text.as_str()) {
						if let Some(event_type) = payload["type"].as_str() {
							if event_type == "ws.connection.established" {
								*retry_attempt = 1;
								let _ = state_tx.send(WsConnectionState::Connected);
							}

							let _ = event_tx.send(WsEvent {
								event_type: event_type.to_owned(),
								payload,
							});
						}
					}
				}
					Some(Ok(Message::Pong(_))) => heartbeat.on_pong(),
					Some(Ok(Message::Close(frame))) => match classify_server_close(frame.map(|frame| frame.code)) {
						DisconnectDisposition::WaitForNewEligibility => {
							return Ok(MessageLoopExit::NormalRemoteClose);
						}
						DisconnectDisposition::RefreshSession => {
							return Ok(MessageLoopExit::InvalidSession);
						}
						DisconnectDisposition::Retry => {
							return Err(GrindrError::Http("WS connection closed by server".to_owned()));
						}
					},
					None => {
						return Err(GrindrError::Http("WS connection closed by server".to_owned()));
				}
					Some(Err(error)) => {
						return Err(error);
				}
				Some(Ok(_)) => {}
			},
			cmd = cmd_rx.recv() => match cmd {
					Some(cmd) => {
						let Some(token) = session_token(auth).await else {
							return Ok(MessageLoopExit::Interrupted);
					};
					let json = serde_json::json!({
						"type": cmd.r#type,
						"ref":  cmd.ref_id,
						"token": token,
						"payload": cmd.payload,
					});
						ws.send_message(Message::text(json.to_string())).await?;
				}
					None => return Ok(MessageLoopExit::Interrupted),
			}
		}
	}
}

async fn close_normally<Transport: WsTransport + Send>(ws: &mut Transport) {
	let _ = ws
		.send_message(Message::close(CloseFrame {
			code: CloseCode(1000),
			reason: Utf8Bytes::from("Normal closure"),
		}))
		.await;
}

#[cfg(test)]
mod tests {
	use super::*;
	use tokio::sync::Notify;

	struct FakeWebSocket {
		incoming: mpsc::UnboundedReceiver<Result<Message, GrindrError>>,
		outgoing: mpsc::UnboundedSender<Message>,
	}

	impl WsTransport for FakeWebSocket {
		fn send_message(
			&mut self,
			message: Message,
		) -> Pin<Box<dyn Future<Output = Result<(), GrindrError>> + Send + '_>>
		{
			Box::pin(async move {
				self.outgoing.send(message).map_err(|_| {
					GrindrError::Http(
						"fake websocket receiver closed".to_owned(),
					)
				})
			})
		}

		fn next_message(
			&mut self,
		) -> Pin<
			Box<
				dyn Future<Output = Option<Result<Message, GrindrError>>>
					+ Send
					+ '_,
			>,
		> {
			Box::pin(self.incoming.recv())
		}
	}

	type FakeLoop = (
		mpsc::UnboundedSender<Result<Message, GrindrError>>,
		mpsc::UnboundedReceiver<Message>,
		watch::Sender<WsControl>,
		tokio::task::JoinHandle<Result<MessageLoopExit, GrindrError>>,
	);

	fn spawn_fake_message_loop(ping_interval: Duration) -> FakeLoop {
		let (auth, mut session_rx) =
			AuthState::new(Some(fake_session("session")));
		let auth = Arc::new(auth);
		let (incoming_tx, incoming) = mpsc::unbounded_channel();
		let (outgoing, outgoing_rx) = mpsc::unbounded_channel();
		let (command_tx, mut command_rx) = mpsc::channel(1);
		let (control_tx, mut control_rx) = watch::channel(WsControl {
			enabled: true,
			generation: 1,
		});
		let (state_tx, _) = watch::channel(WsConnectionState::Disconnected);
		let (event_tx, _) = broadcast::channel(1);

		let task = tokio::spawn(async move {
			let _command_tx = command_tx;
			let mut socket = FakeWebSocket { incoming, outgoing };
			let mut retry_attempt = 1;
			run_message_loop(
				&mut socket,
				&mut command_rx,
				&auth,
				&mut session_rx,
				&mut control_rx,
				1,
				&mut retry_attempt,
				ping_interval,
				&state_tx,
				&event_tx,
			)
			.await
		});
		(incoming_tx, outgoing_rx, control_tx, task)
	}

	#[test]
	fn official_retry_delay_uses_linear_equal_jitter() {
		for (attempt, nominal_ms) in
			[(1, 5_000), (2, 10_000), (36, 180_000), (80, 180_000)]
		{
			for _ in 0..100 {
				let delay = retry_delay(attempt).as_millis() as u64;
				assert!(delay >= nominal_ms / 2);
				assert!(delay < nominal_ms);
			}
		}
	}

	#[test]
	fn official_close_codes_select_wait_refresh_or_retry() {
		assert_eq!(
			classify_server_close(Some(CloseCode(1000))),
			DisconnectDisposition::WaitForNewEligibility,
		);
		for code in [3000, 4401] {
			assert_eq!(
				classify_server_close(Some(CloseCode(code))),
				DisconnectDisposition::RefreshSession,
			);
		}
		assert_eq!(
			classify_server_close(Some(CloseCode(1006))),
			DisconnectDisposition::Retry,
		);
		assert_eq!(classify_server_close(None), DisconnectDisposition::Retry,);
	}

	#[test]
	fn websocket_upgrade_401_forces_session_refresh() {
		assert_eq!(
			classify_upgrade_status(wreq::StatusCode::UNAUTHORIZED),
			DisconnectDisposition::RefreshSession,
		);
		assert_eq!(
			classify_upgrade_status(wreq::StatusCode::SWITCHING_PROTOCOLS),
			DisconnectDisposition::Retry,
		);
		assert_eq!(
			classify_upgrade_status(wreq::StatusCode::FORBIDDEN),
			DisconnectDisposition::Retry,
		);
	}

	#[tokio::test]
	async fn invalid_session_refresh_finishes_before_reconnect() {
		let refresh_started = Arc::new(Notify::new());
		let release_refresh = Arc::new(Notify::new());
		let rejected = Eligibility {
			control_generation: 7,
			session_id: "rejected".to_owned(),
		};

		let refresh_task = {
			let refresh_started = refresh_started.clone();
			let release_refresh = release_refresh.clone();
			tokio::spawn(async move {
				refresh_before_reconnect(rejected, |session_id| async move {
					assert_eq!(session_id, "rejected");
					refresh_started.notify_one();
					release_refresh.notified().await;
					true
				})
				.await
			})
		};
		refresh_started.notified().await;
		assert!(!refresh_task.is_finished());
		release_refresh.notify_one();
		assert_eq!(refresh_task.await.unwrap(), None);
	}

	#[tokio::test]
	async fn failed_invalid_session_refresh_blocks_reconnect() {
		let rejected = Eligibility {
			control_generation: 7,
			session_id: "rejected".to_owned(),
		};
		assert_eq!(
			refresh_before_reconnect(rejected.clone(), |_| async { false })
				.await,
			Some(rejected),
		);
	}

	#[test]
	fn normal_close_requires_new_control_or_session_generation() {
		let closed = Eligibility {
			control_generation: 7,
			session_id: "session-a".to_owned(),
		};
		assert!(!eligibility_is_new(&closed, Some(&closed)));
		assert!(eligibility_is_new(
			&Eligibility {
				control_generation: 8,
				session_id: "session-a".to_owned(),
			},
			Some(&closed),
		));
		assert!(eligibility_is_new(
			&Eligibility {
				control_generation: 7,
				session_id: "session-b".to_owned(),
			},
			Some(&closed),
		));
	}

	#[tokio::test]
	async fn normal_close_waits_until_session_generation_changes() {
		let (auth, mut session_rx) =
			AuthState::new(Some(fake_session("session-a")));
		let auth = Arc::new(auth);
		let (_control_tx, mut control_rx) = watch::channel(WsControl {
			enabled: true,
			generation: 7,
		});
		let closed = Eligibility {
			control_generation: 7,
			session_id: "session-a".to_owned(),
		};
		let started = Arc::new(Notify::new());

		let wait_task = {
			let auth = auth.clone();
			let started = started.clone();
			tokio::spawn(async move {
				started.notify_one();
				wait_until_ready(
					&auth,
					&mut session_rx,
					&mut control_rx,
					Some(&closed),
				)
				.await
			})
		};
		started.notified().await;
		tokio::task::yield_now().await;
		assert!(!wait_task.is_finished());

		auth.set_session(fake_session("session-b")).await;
		let ready = wait_task.await.unwrap().unwrap();

		assert_eq!(ready.session_id, "session-b");
		assert_eq!(ready.control_generation, 7);
	}

	fn fake_session(session_id: &str) -> Session {
		Session {
			email: "user@example.com".to_owned(),
			expires_at: u64::MAX,
			profile_id: "profile".to_owned(),
			session_id: session_id.to_owned(),
			auth_token: "refresh-token".to_owned(),
			kind: crate::auth::SessionKind::Email,
			third_party_user_id: None,
			restriction: None,
		}
	}

	#[test]
	fn timely_pong_allows_next_ping() {
		let mut heartbeat = Heartbeat::default();
		assert_eq!(heartbeat.on_ping_tick(), PingTick::Send);
		heartbeat.on_pong();
		assert_eq!(heartbeat.on_ping_tick(), PingTick::Send);
	}

	#[tokio::test]
	async fn message_loop_sends_next_ping_after_pong() {
		let (incoming, mut outgoing, control, task) =
			spawn_fake_message_loop(Duration::from_millis(5));

		let first =
			tokio::time::timeout(Duration::from_secs(1), outgoing.recv())
				.await
				.unwrap()
				.unwrap();
		assert!(matches!(first, Message::Ping(_)));
		incoming.send(Ok(Message::pong(Vec::<u8>::new()))).unwrap();
		let second =
			tokio::time::timeout(Duration::from_secs(1), outgoing.recv())
				.await
				.unwrap()
				.unwrap();
		assert!(matches!(second, Message::Ping(_)));

		control
			.send(WsControl {
				enabled: false,
				generation: 2,
			})
			.unwrap();
		assert_eq!(task.await.unwrap().unwrap(), MessageLoopExit::Interrupted);
	}

	#[test]
	fn missing_pong_fails_on_next_ping_tick() {
		let mut heartbeat = Heartbeat::default();
		assert_eq!(heartbeat.on_ping_tick(), PingTick::Send);
		assert_eq!(
			heartbeat.on_ping_tick(),
			PingTick::TimedOut {
				successful_ping_pongs: 0,
			},
		);
	}

	#[tokio::test]
	async fn message_loop_fails_when_pong_is_missing() {
		let (_incoming, mut outgoing, _control, task) =
			spawn_fake_message_loop(Duration::from_millis(5));

		let first =
			tokio::time::timeout(Duration::from_secs(1), outgoing.recv())
				.await
				.unwrap()
				.unwrap();
		assert!(matches!(first, Message::Ping(_)));

		let error = tokio::time::timeout(Duration::from_secs(1), task)
			.await
			.unwrap()
			.unwrap()
			.unwrap_err();
		assert!(matches!(
			error,
			GrindrError::Http(message) if message.contains("WS pong timeout")
		));
	}

	#[test]
	fn official_ping_interval_is_ten_seconds() {
		assert_eq!(PING_INTERVAL, Duration::from_secs(10));
	}
}
