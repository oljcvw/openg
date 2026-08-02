use std::future::Future;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use tokio::sync::{Mutex, Notify, Semaphore};

const MAX_CONCURRENT_REQUESTS: usize = 20;
const HALF_OPEN_WAIT: Duration = Duration::from_secs(5);
const RESET_WINDOW: Duration = Duration::from_secs(10 * 60);
const COOLDOWNS: [Duration; 3] = [
	Duration::from_secs(60),
	Duration::from_secs(120),
	Duration::from_secs(300),
];

static API_RUNTIME: OnceLock<ApiRuntime> = OnceLock::new();
static NEXT_RUNTIME_ID: AtomicU64 = AtomicU64::new(1);
static NEXT_JITTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone)]
pub struct ApiRuntime {
	client: grindr::GrindrClient,
	recovery: Arc<RequestRecovery>,
	id: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryPolicy {
	SafeRead,
	NeverReplay,
}

#[derive(Debug)]
pub enum RuntimeError {
	Grindr(grindr::GrindrError),
	Cooldown { retry_at_ms: u64 },
}

#[derive(Default)]
struct CircuitState {
	open_until: Option<Instant>,
	last_block: Option<Instant>,
	escalation: usize,
	half_open: bool,
}

struct RequestRecovery {
	state: Mutex<CircuitState>,
	notify: Notify,
	requests: Semaphore,
}

enum Admission {
	Proceed { half_open: bool },
	Wait,
	Cooldown { retry_at_ms: u64 },
}

impl ApiRuntime {
	pub fn install(client: grindr::GrindrClient) -> &'static Self {
		API_RUNTIME.get_or_init(|| Self::new(client))
	}

	pub fn get() -> Option<&'static Self> {
		API_RUNTIME.get()
	}

	pub fn get_or_try_init(
		device: grindr::DeviceInfo,
		session: Option<grindr::Session>,
	) -> Result<&'static Self, grindr::GrindrError> {
		if let Some(runtime) = Self::get() {
			return Ok(runtime);
		}
		let client = grindr::GrindrClient::new(device, session)?;
		Ok(Self::install(client))
	}

	fn new(client: grindr::GrindrClient) -> Self {
		Self {
			client,
			recovery: Arc::new(RequestRecovery {
				state: Mutex::new(CircuitState::default()),
				notify: Notify::new(),
				requests: Semaphore::new(MAX_CONCURRENT_REQUESTS),
			}),
			id: NEXT_RUNTIME_ID.fetch_add(1, Ordering::Relaxed),
		}
	}

	pub fn client(&self) -> &grindr::GrindrClient {
		&self.client
	}

	pub fn id(&self) -> u64 {
		self.id
	}

	pub async fn request<F, Fut, T>(
		&self,
		policy: RetryPolicy,
		operation: F,
	) -> Result<T, RuntimeError>
	where
		F: Fn() -> Fut,
		Fut: Future<Output = Result<T, grindr::GrindrError>>,
	{
		let half_open = loop {
			match self.recovery.admit(policy).await {
				Admission::Proceed { half_open } => break half_open,
				Admission::Cooldown { retry_at_ms } => {
					return Err(RuntimeError::Cooldown { retry_at_ms })
				}
				Admission::Wait => {
					if tokio::time::timeout(
						HALF_OPEN_WAIT,
						self.recovery.notify.notified(),
					)
					.await
					.is_err()
					{
						let retry_at_ms = system_time_ms() + 1_000;
						return Err(RuntimeError::Cooldown { retry_at_ms });
					}
				}
			}
		};

		let first = self.recovery.call(&operation).await;
		match first {
			Ok(value) => {
				self.recovery.note_success(half_open).await;
				Ok(value)
			}
			Err(grindr::GrindrError::Blocked)
				if policy == RetryPolicy::SafeRead && !half_open =>
			{
				tokio::time::sleep(retry_jitter()).await;
				match self.recovery.call(&operation).await {
					Ok(value) => Ok(value),
					Err(error @ grindr::GrindrError::Blocked) => {
						self.recovery.note_block().await;
						Err(RuntimeError::Grindr(error))
					}
					Err(error @ grindr::GrindrError::RateLimited) => {
						self.recovery.note_block().await;
						Err(RuntimeError::Grindr(error))
					}
					Err(error) => Err(RuntimeError::Grindr(error)),
				}
			}
			Err(error @ grindr::GrindrError::Blocked)
			| Err(error @ grindr::GrindrError::RateLimited) => {
				self.recovery.note_block().await;
				Err(RuntimeError::Grindr(error))
			}
			Err(error) => {
				self.recovery.note_non_blocking_failure(half_open).await;
				Err(RuntimeError::Grindr(error))
			}
		}
	}
}

impl RequestRecovery {
	async fn call<F, Fut, T>(
		&self,
		operation: &F,
	) -> Result<T, grindr::GrindrError>
	where
		F: Fn() -> Fut,
		Fut: Future<Output = Result<T, grindr::GrindrError>>,
	{
		let _permit = self
			.requests
			.acquire()
			.await
			.expect("request semaphore closed");
		operation().await
	}

	async fn admit(&self, policy: RetryPolicy) -> Admission {
		let now = Instant::now();
		let mut state = self.state.lock().await;
		let Some(open_until) = state.open_until else {
			return Admission::Proceed { half_open: false };
		};
		if now < open_until {
			return Admission::Cooldown {
				retry_at_ms: system_time_ms()
					+ open_until.duration_since(now).as_millis() as u64,
			};
		}
		if policy == RetryPolicy::NeverReplay {
			return Admission::Cooldown {
				retry_at_ms: system_time_ms() + 1_000,
			};
		}
		if state.half_open {
			return Admission::Wait;
		}
		state.half_open = true;
		Admission::Proceed { half_open: true }
	}

	async fn note_success(&self, half_open: bool) {
		if !half_open {
			return;
		}
		let mut state = self.state.lock().await;
		state.open_until = None;
		state.half_open = false;
		self.notify.notify_waiters();
	}

	async fn note_non_blocking_failure(&self, half_open: bool) {
		if !half_open {
			return;
		}
		let mut state = self.state.lock().await;
		state.half_open = false;
		self.notify.notify_waiters();
	}

	async fn note_block(&self) {
		let now = Instant::now();
		let mut state = self.state.lock().await;
		if state
			.last_block
			.is_some_and(|last| now.duration_since(last) <= RESET_WINDOW)
		{
			state.escalation = (state.escalation + 1).min(COOLDOWNS.len() - 1);
		} else {
			state.escalation = 0;
		}
		state.last_block = Some(now);
		state.open_until = Some(now + COOLDOWNS[state.escalation]);
		state.half_open = false;
		self.notify.notify_waiters();
	}
}

fn retry_jitter() -> Duration {
	let sequence = NEXT_JITTER.fetch_add(977, Ordering::Relaxed) % 3_001;
	Duration::from_millis(2_000 + sequence)
}

fn system_time_ms() -> u64 {
	SystemTime::now()
		.duration_since(UNIX_EPOCH)
		.unwrap_or_default()
		.as_millis() as u64
}

pub fn retry_policy(method: &grindr::Method, path: &str) -> RetryPolicy {
	let route = path.split_once('?').map_or(path, |(route, _)| route);
	if method == grindr::Method::GET || method == grindr::Method::HEAD {
		RetryPolicy::SafeRead
	} else if method == grindr::Method::POST
		&& matches!(route, "/v4/inbox" | "/v3/profiles")
	{
		RetryPolicy::SafeRead
	} else {
		RetryPolicy::NeverReplay
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn only_reads_and_allowlisted_posts_can_replay() {
		assert_eq!(
			retry_policy(&grindr::Method::GET, "/v3/me/profile"),
			RetryPolicy::SafeRead
		);
		assert_eq!(
			retry_policy(&grindr::Method::POST, "/v4/inbox?page=1"),
			RetryPolicy::SafeRead
		);
		assert_eq!(
			retry_policy(&grindr::Method::POST, "/v3/profiles"),
			RetryPolicy::SafeRead
		);
		assert_eq!(
			retry_policy(&grindr::Method::POST, "/v4/chat/message/send"),
			RetryPolicy::NeverReplay
		);
		assert_eq!(
			retry_policy(&grindr::Method::PUT, "/v3.1/me/profile"),
			RetryPolicy::NeverReplay
		);
	}

	#[tokio::test]
	async fn open_circuit_rejects_requests_without_calling_operation() {
		let recovery = RequestRecovery {
			state: Mutex::new(CircuitState {
				open_until: Some(Instant::now() + Duration::from_secs(60)),
				..CircuitState::default()
			}),
			notify: Notify::new(),
			requests: Semaphore::new(MAX_CONCURRENT_REQUESTS),
		};
		assert!(matches!(
			recovery.admit(RetryPolicy::SafeRead).await,
			Admission::Cooldown { .. }
		));
		assert!(matches!(
			recovery.admit(RetryPolicy::NeverReplay).await,
			Admission::Cooldown { .. }
		));
	}

	#[tokio::test]
	async fn repeated_blocks_escalate_and_successful_probe_closes_circuit() {
		let recovery = RequestRecovery {
			state: Mutex::new(CircuitState::default()),
			notify: Notify::new(),
			requests: Semaphore::new(MAX_CONCURRENT_REQUESTS),
		};
		recovery.note_block().await;
		assert_eq!(recovery.state.lock().await.escalation, 0);
		recovery.note_block().await;
		assert_eq!(recovery.state.lock().await.escalation, 1);
		{
			let mut state = recovery.state.lock().await;
			state.open_until = Some(Instant::now() - Duration::from_secs(1));
		}
		assert!(matches!(
			recovery.admit(RetryPolicy::SafeRead).await,
			Admission::Proceed { half_open: true }
		));
		recovery.note_success(true).await;
		assert!(recovery.state.lock().await.open_until.is_none());
	}
}
