use std::future::Future;
use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::{broadcast::error::RecvError, watch};

#[cfg(target_os = "android")]
use jni::{objects::JClass, sys::jboolean, JNIEnv};

use crate::error::{AppError, BanInfo};
use crate::state::AppState;

#[derive(Debug, Clone, Copy)]
struct RealtimeInputs {
	requested: bool,
	foreground: bool,
	network_available: bool,
}

impl Default for RealtimeInputs {
	fn default() -> Self {
		Self {
			requested: false,
			foreground: !cfg!(mobile),
			network_available: !cfg!(target_os = "android"),
		}
	}
}

impl RealtimeInputs {
	fn desired(&self) -> bool {
		self.requested && self.foreground && self.network_available
	}
}

struct RealtimeController {
	inputs: Mutex<RealtimeInputs>,
	desired_tx: watch::Sender<bool>,
}

static REALTIME_CONTROLLER: OnceLock<RealtimeController> = OnceLock::new();

pub fn install_realtime_controller(client: grindr::GrindrClient) {
	let (desired_tx, desired_rx) = watch::channel(false);
	let worker_client = client.clone();
	if REALTIME_CONTROLLER
		.set(RealtimeController {
			inputs: Mutex::new(RealtimeInputs::default()),
			desired_tx,
		})
		.is_err()
	{
		tracing::warn!("[ws-lifecycle] controller already installed");
		return;
	}

	tauri::async_runtime::spawn(run_latest_state_loop(
		desired_rx,
		false,
		move |enabled| {
			let client = worker_client.clone();
			async move {
				client.set_realtime_enabled(enabled).await;
			}
		},
	));
}

pub fn set_app_foreground(foreground: bool) {
	update_realtime_inputs("lifecycle", |inputs| {
		inputs.foreground = foreground;
	});
}

pub fn set_network_available(available: bool) {
	update_realtime_inputs("network", |inputs| {
		inputs.network_available = available;
	});
}

fn request_realtime() -> Result<(), AppError> {
	let Some(controller) = REALTIME_CONTROLLER.get() else {
		return Err(AppError::Http(
			"Realtime controller is not initialized".to_owned(),
		));
	};
	update_controller(controller, "requested", |inputs| {
		inputs.requested = true;
	});
	Ok(())
}

fn update_realtime_inputs(
	reason: &'static str,
	update: impl FnOnce(&mut RealtimeInputs),
) {
	let Some(controller) = REALTIME_CONTROLLER.get() else {
		tracing::debug!(reason, "[ws-lifecycle] update before initialization");
		return;
	};
	update_controller(controller, reason, update);
}

fn update_controller(
	controller: &RealtimeController,
	reason: &'static str,
	update: impl FnOnce(&mut RealtimeInputs),
) {
	let desired = {
		let mut inputs = controller
			.inputs
			.lock()
			.unwrap_or_else(|poisoned| poisoned.into_inner());
		update(&mut inputs);
		inputs.desired()
	};

	if controller.desired_tx.send_if_modified(|current| {
		if *current == desired {
			return false;
		}
		*current = desired;
		true
	}) {
		tracing::info!(
			reason,
			enabled = desired,
			"[ws-lifecycle] realtime state changed"
		);
	}
}

async fn run_latest_state_loop<Apply, ApplyFuture>(
	mut desired_rx: watch::Receiver<bool>,
	mut applied: bool,
	mut apply: Apply,
) where
	Apply: FnMut(bool) -> ApplyFuture,
	ApplyFuture: Future<Output = ()>,
{
	while desired_rx.changed().await.is_ok() {
		let desired = *desired_rx.borrow_and_update();
		if desired == applied {
			continue;
		}
		apply(desired).await;
		applied = desired;
	}
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_opengrind_realtime_RealtimeNetworkMonitor_nativeSetNetworkAvailable(
	_env: JNIEnv,
	_class: JClass,
	available: jboolean,
) {
	let result = std::panic::catch_unwind(|| {
		set_network_available(available != 0);
	});
	if result.is_err() {
		tracing::error!("[ws-lifecycle] JNI network update panicked");
	}
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionErrorPayload {
	message: String,
	unauthorized: bool,
}

pub fn spawn_ws_task(app: AppHandle) {
	{
		let app = app.clone();
		tauri::async_runtime::spawn(async move {
			let client = {
				let state = app.state::<AppState>();
				let Ok(c) = state.client() else { return };
				c.clone()
			};
			let mut rx = client.ws_receiver();
			loop {
				match rx.recv().await {
					Ok(event) => {
						let safe_type = event.event_type.replace('.', "_");
						app.emit(
							&format!("grindr:{safe_type}"),
							&event.payload,
						)
						.ok();
					}
					Err(RecvError::Lagged(skipped)) => {
						app.emit("ws:events-dropped", skipped).ok();
					}
					Err(RecvError::Closed) => break,
				}
			}
		});
	}

	{
		let app = app.clone();
		tauri::async_runtime::spawn(async move {
			let client = {
				let state = app.state::<AppState>();
				let Ok(c) = state.client() else { return };
				c.clone()
			};
			let mut rx = client.connection_state();
			emit_ws_state(&app, &rx.borrow());
			loop {
				if rx.changed().await.is_err() {
					break;
				}
				emit_ws_state(&app, &rx.borrow());
			}
		});
	}

	{
		let app = app.clone();
		tauri::async_runtime::spawn(async move {
			let client = {
				let state = app.state::<AppState>();
				let Ok(c) = state.client() else { return };
				c.clone()
			};
			let mut rx = client.auth_event_receiver();
			loop {
				let event = match rx.recv().await {
					Ok(event) => event,
					// Terminal auth events clear the session before they are
					// sent, so nothing follows one and a lag can never evict it.
					Err(RecvError::Lagged(_)) => continue,
					Err(RecvError::Closed) => break,
				};
				match event {
					grindr::AuthEvent::LoggedOut => {
						app.emit(
							"auth:session-error",
							SessionErrorPayload {
								message: "Session expired".to_owned(),
								unauthorized: true,
							},
						)
						.ok();
					}
					grindr::AuthEvent::RefreshFailed { message } => {
						app.emit(
							"auth:session-error",
							SessionErrorPayload {
								message,
								unauthorized: false,
							},
						)
						.ok();
					}
					grindr::AuthEvent::Banned(info) => {
						app.emit("auth:banned", BanInfo::from(info)).ok();
					}
					_ => {}
				}
			}
		});
	}
}

fn emit_ws_state(app: &AppHandle, state: &grindr::WsConnectionState) {
	match state {
		grindr::WsConnectionState::Connected => {
			app.emit("ws:connected", ()).ok()
		}
		grindr::WsConnectionState::Disconnected => {
			app.emit("ws:disconnected", ()).ok()
		}
	};
}

#[tauri::command]
pub async fn ws_connect(
	_state: tauri::State<'_, AppState>,
) -> Result<(), AppError> {
	request_realtime()
}

#[tauri::command]
pub async fn ws_send(
	state: tauri::State<'_, AppState>,
	command: grindr::WsCommand,
) -> Result<(), AppError> {
	let client = state.client()?;
	if *client.connection_state().borrow()
		!= grindr::WsConnectionState::Connected
	{
		return Err(AppError::Http("WS not connected".to_owned()));
	}
	client
		.ws_sender()
		.send(command)
		.await
		.map_err(|_| AppError::Http("WS not connected".to_owned()))
}

#[cfg(test)]
mod tests {
	use std::sync::Arc;

	use tokio::sync::{watch, Mutex, Notify};

	use super::{run_latest_state_loop, RealtimeInputs};

	#[test]
	fn realtime_requires_request_foreground_and_network() {
		let mut inputs = RealtimeInputs {
			requested: true,
			foreground: true,
			network_available: true,
		};
		assert!(inputs.desired());

		inputs.foreground = false;
		assert!(!inputs.desired());
		inputs.foreground = true;
		inputs.network_available = false;
		assert!(!inputs.desired());
	}

	#[tokio::test]
	async fn lifecycle_application_is_serialized_and_uses_latest_state() {
		let (desired_tx, desired_rx) = watch::channel(false);
		let applied = Arc::new(Mutex::new(Vec::new()));
		let first_apply_started = Arc::new(Notify::new());
		let release_first_apply = Arc::new(Notify::new());

		let task = {
			let applied = applied.clone();
			let first_apply_started = first_apply_started.clone();
			let release_first_apply = release_first_apply.clone();
			tokio::spawn(async move {
				run_latest_state_loop(desired_rx, false, move |enabled| {
					let applied = applied.clone();
					let first_apply_started = first_apply_started.clone();
					let release_first_apply = release_first_apply.clone();
					async move {
						applied.lock().await.push(enabled);
						if enabled {
							first_apply_started.notify_one();
							release_first_apply.notified().await;
						}
					}
				})
				.await;
			})
		};

		desired_tx.send(true).unwrap();
		first_apply_started.notified().await;
		desired_tx.send(false).unwrap();
		desired_tx.send(true).unwrap();
		release_first_apply.notify_one();
		tokio::task::yield_now().await;
		drop(desired_tx);
		task.await.unwrap();

		assert_eq!(*applied.lock().await, vec![true]);
	}

	#[tokio::test]
	async fn final_disable_waits_for_in_flight_enable() {
		let (desired_tx, desired_rx) = watch::channel(false);
		let applied = Arc::new(Mutex::new(Vec::new()));
		let enable_started = Arc::new(Notify::new());
		let release_enable = Arc::new(Notify::new());
		let disable_applied = Arc::new(Notify::new());

		let task = {
			let applied = applied.clone();
			let enable_started = enable_started.clone();
			let release_enable = release_enable.clone();
			let disable_applied = disable_applied.clone();
			tokio::spawn(async move {
				run_latest_state_loop(desired_rx, false, move |enabled| {
					let applied = applied.clone();
					let enable_started = enable_started.clone();
					let release_enable = release_enable.clone();
					let disable_applied = disable_applied.clone();
					async move {
						applied.lock().await.push(enabled);
						if enabled {
							enable_started.notify_one();
							release_enable.notified().await;
						} else {
							disable_applied.notify_one();
						}
					}
				})
				.await;
			})
		};

		desired_tx.send(true).unwrap();
		enable_started.notified().await;
		desired_tx.send(false).unwrap();
		tokio::task::yield_now().await;
		assert_eq!(*applied.lock().await, vec![true]);

		release_enable.notify_one();
		disable_applied.notified().await;
		drop(desired_tx);
		task.await.unwrap();

		assert_eq!(*applied.lock().await, vec![true, false]);
	}
}
