use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "android", target_os = "ios", test))]
use serde_json::Value;

#[cfg(any(target_os = "android", target_os = "ios"))]
use std::panic::{catch_unwind, AssertUnwindSafe};
#[cfg(any(target_os = "android", target_os = "ios"))]
use std::str::FromStr;

#[cfg(target_os = "ios")]
use std::ffi::{c_char, CString};

#[cfg(target_os = "android")]
use jni::objects::{JClass, JString};
#[cfg(target_os = "android")]
use jni::sys::{jboolean, jstring};
#[cfg(target_os = "android")]
use jni::JNIEnv;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{Manager, Wry};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_open_grind_notifications);

#[cfg(any(target_os = "android", target_os = "ios"))]
use super::runtime::{ApiRuntime, RequestClass, RetryPolicy, RuntimeError};
use crate::error::AppError;
#[cfg(any(target_os = "android", target_os = "ios"))]
use crate::storage::{
	account_storage_lock, AuthStorage, DeviceStorage, SigningKeyStorage,
};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
	pub supported: bool,
	pub enabled: bool,
	pub messages: bool,
	pub taps: bool,
	pub show_previews: bool,
	pub permission: String,
	pub last_successful_check: Option<u64>,
	pub last_error: Option<String>,
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
impl NotificationSettings {
	fn unsupported() -> Self {
		Self {
			supported: false,
			enabled: false,
			messages: true,
			taps: true,
			show_previews: false,
			permission: "unsupported".to_owned(),
			last_successful_check: None,
			last_error: None,
		}
	}
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetNotificationSettings {
	pub enabled: bool,
	pub messages: bool,
	pub taps: bool,
	pub show_previews: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRoute {
	pub route: String,
	pub account_id: String,
}

#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct MobileNotifications {
	handle: PluginHandle<Wry>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-notifications")
		.setup(|_app, _api| {
			#[cfg(target_os = "android")]
			{
				let handle = _api.register_android_plugin(
					"org.opengrind.notifications",
					"NotificationsPlugin",
				)?;
				_app.manage(MobileNotifications { handle });
			}
			#[cfg(target_os = "ios")]
			{
				let handle = _api.register_ios_plugin(
					init_plugin_open_grind_notifications,
				)?;
				_app.manage(MobileNotifications { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn notification_get_settings(
	app: tauri::AppHandle,
) -> Result<NotificationSettings, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "getSettings", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Ok(NotificationSettings::unsupported())
	}
}

#[tauri::command]
pub async fn notification_set_settings(
	app: tauri::AppHandle,
	enabled: bool,
	messages: bool,
	taps: bool,
	show_previews: bool,
) -> Result<NotificationSettings, AppError> {
	let settings = SetNotificationSettings {
		enabled,
		messages,
		taps,
		show_previews,
	};
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "setSettings", settings).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (app, settings);
		Ok(NotificationSettings::unsupported())
	}
}

#[tauri::command]
pub async fn notification_test(app: tauri::AppHandle) -> Result<(), AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		let _: Value = run_mobile(&app, "testNotification", ()).await?;
		return Ok(());
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Err(AppError::Api {
			code: 400,
			message: "Background notifications are only supported on Android"
				.to_owned(),
		})
	}
}

#[tauri::command]
pub async fn notification_sync(
	app: tauri::AppHandle,
	interval_minutes: u64,
) -> Result<(), AppError> {
	if !(15..=1_440).contains(&interval_minutes) {
		return Err(AppError::Api {
			code: 400,
			message: "Notification polling interval must be between 15 and 1440 minutes"
				.to_owned(),
		});
	}
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		let _: Value = run_mobile(
			&app,
			"syncSchedule",
			NotificationScheduleInput { interval_minutes },
		)
		.await?;
		return Ok(());
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (app, interval_minutes);
		Ok(())
	}
}

#[cfg(any(target_os = "android", target_os = "ios"))]
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct NotificationScheduleInput {
	interval_minutes: u64,
}

#[cfg(target_os = "android")]
#[derive(Debug, Serialize)]
struct LogcatSettingsInput {
	enabled: bool,
}

#[tauri::command]
pub async fn set_logcat_enabled(
	app: tauri::AppHandle,
	enabled: bool,
) -> Result<(), AppError> {
	crate::logging::set_logcat_enabled(enabled);
	#[cfg(target_os = "android")]
	{
		let _: Value = run_mobile(
			&app,
			"setLogcatEnabled",
			LogcatSettingsInput { enabled },
		)
		.await?;
	}
	#[cfg(not(target_os = "android"))]
	let _ = app;
	Ok(())
}

#[tauri::command]
pub async fn notification_cancel(
	app: tauri::AppHandle,
) -> Result<(), AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		let _: Value = run_mobile(&app, "cancelSchedule", ()).await?;
		return Ok(());
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Ok(())
	}
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClearNotificationAccount {
	account_id: String,
}

#[tauri::command]
pub async fn notification_clear_account(
	app: tauri::AppHandle,
	account_id: u64,
) -> Result<(), AppError> {
	let input = ClearNotificationAccount {
		account_id: account_id.to_string(),
	};
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		let _: Value = run_mobile(&app, "clearAccount", input).await?;
		return Ok(());
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (app, input);
		Ok(())
	}
}

#[tauri::command]
pub async fn notification_take_route(
	app: tauri::AppHandle,
) -> Result<Option<NotificationRoute>, AppError> {
	#[cfg(target_os = "ios")]
	{
		return run_mobile(&app, "takePendingRoute", ()).await;
	}
	#[cfg(not(target_os = "ios"))]
	{
		let _ = app;
		Ok(None)
	}
}

#[cfg(any(target_os = "android", target_os = "ios"))]
async fn run_mobile<I, O>(
	app: &tauri::AppHandle,
	command: &str,
	input: I,
) -> Result<O, AppError>
where
	I: Serialize,
	O: for<'de> Deserialize<'de>,
{
	app.state::<MobileNotifications>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|error| {
			AppError::Http(format!(
				"Native notification bridge failed: {error}"
			))
		})
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(any(target_os = "android", target_os = "ios", test))]
struct PollMessage {
	conversation_id: String,
	title: String,
	preview: Option<String>,
	timestamp: u64,
	unread_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg(any(target_os = "android", target_os = "ios", test))]
struct PollTap {
	profile_id: u64,
	display_name: Option<String>,
	timestamp: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
#[cfg(any(target_os = "android", target_os = "ios", test))]
#[cfg_attr(all(test, not(target_os = "android")), allow(dead_code))]
enum PollResponse {
	Ok {
		account_id: String,
		messages: Vec<PollMessage>,
		taps: Vec<PollTap>,
	},
	SignedOut,
	Deferred,
	Retry {
		code: PollFailureCode,
	},
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[cfg(any(target_os = "android", target_os = "ios", test))]
#[cfg_attr(all(test, not(target_os = "android")), allow(dead_code))]
enum PollFailureCode {
	RuntimeUnavailable,
	SessionUnavailable,
	DeviceUnavailable,
	SigningKeyUnavailable,
	ClientUnavailable,
	InboxRequest,
	InboxResponse,
	InboxDecode,
	TapsRequest,
	TapsResponse,
	TapsDecode,
	PollPanicked,
	ResponseEncoding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(any(target_os = "android", target_os = "ios", test))]
enum PollHttpDisposition {
	Success,
	Deferred,
	SignedOut,
	Retry(&'static str),
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn parse_messages(body: &[u8]) -> Result<Vec<PollMessage>, String> {
	let root: Value = serde_json::from_slice(body)
		.map_err(|e| format!("inbox decode failed: {e}"))?;
	let entries = root
		.get("entries")
		.and_then(Value::as_array)
		.ok_or_else(|| "inbox response omitted entries".to_owned())?;

	Ok(entries
		.iter()
		.filter_map(|entry| {
			let data = entry.get("data")?;
			if data.get("muted").and_then(Value::as_bool).unwrap_or(false) {
				return None;
			}
			let unread_count = value_u64(data.get("unreadCount")?)?;
			if unread_count == 0 {
				return None;
			}
			Some(PollMessage {
				conversation_id: data
					.get("conversationId")?
					.as_str()?
					.to_owned(),
				title: data
					.get("name")
					.and_then(Value::as_str)
					.filter(|name| !name.trim().is_empty())
					.unwrap_or("New message")
					.to_owned(),
				preview: data
					.get("preview")
					.and_then(|preview| preview.get("text"))
					.and_then(Value::as_str)
					.filter(|text| !text.trim().is_empty())
					.map(str::to_owned),
				timestamp: value_u64(data.get("lastActivityTimestamp")?)?,
				unread_count,
			})
		})
		.collect())
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn parse_taps(body: &[u8]) -> Result<Vec<PollTap>, String> {
	let root: Value = serde_json::from_slice(body)
		.map_err(|e| format!("taps decode failed: {e}"))?;
	let profiles = root
		.get("profiles")
		.and_then(Value::as_array)
		.ok_or_else(|| "taps response omitted profiles".to_owned())?;

	Ok(profiles
		.iter()
		.filter_map(|profile| {
			Some(PollTap {
				profile_id: value_u64(profile.get("profileId")?)?,
				display_name: profile
					.get("displayName")
					.and_then(Value::as_str)
					.filter(|name| !name.trim().is_empty())
					.map(str::to_owned),
				timestamp: value_u64(profile.get("timestamp")?)?,
			})
		})
		.collect())
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn value_u64(value: &Value) -> Option<u64> {
	value
		.as_u64()
		.or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn notification_error_kind(error: &grindr::GrindrError) -> &'static str {
	match error {
		grindr::GrindrError::Http(_) => "http",
		grindr::GrindrError::Auth(_) => "auth",
		grindr::GrindrError::Api { .. } => "api",
		grindr::GrindrError::Unauthorized { .. } => "unauthorized",
		grindr::GrindrError::Banned(_) => "banned",
		grindr::GrindrError::RateLimited => "rate_limited",
		grindr::GrindrError::Blocked => "request_blocked",
		_ => "other",
	}
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn classify_poll_http_response(
	status: u16,
	body: &[u8],
) -> PollHttpDisposition {
	if (200..300).contains(&status) {
		return PollHttpDisposition::Success;
	}

	match grindr::GrindrError::from_response(status, body) {
		grindr::GrindrError::Blocked | grindr::GrindrError::RateLimited => {
			PollHttpDisposition::Deferred
		}
		grindr::GrindrError::Unauthorized { .. } => {
			PollHttpDisposition::SignedOut
		}
		ref error => PollHttpDisposition::Retry(notification_error_kind(error)),
	}
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn poll_notifications(
	messages_enabled: bool,
	taps_enabled: bool,
) -> PollResponse {
	crate::storage::init_keyring();
	let poll_started = std::time::Instant::now();
	tracing::info!(
		active_foreground_requests = super::rest::active_foreground_requests(),
		messages_enabled,
		taps_enabled,
		"[notification-poll] start"
	);

	let runtime = match tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
	{
		Ok(runtime) => runtime,
		Err(_) => {
			return PollResponse::Retry {
				code: PollFailureCode::RuntimeUnavailable,
			}
		}
	};
	let _storage_guard = runtime.block_on(account_storage_lock().lock());
	let session = match AuthStorage::get_session() {
		Ok(Some(session)) => session,
		Ok(None) => return PollResponse::SignedOut,
		Err(_) => {
			return PollResponse::Retry {
				code: PollFailureCode::SessionUnavailable,
			}
		}
	};
	let account_id = session.profile_id.clone();
	let mut device = match DeviceStorage::load() {
		Ok(Some(device)) => device,
		Ok(None) => {
			return PollResponse::Retry {
				code: PollFailureCode::DeviceUnavailable,
			}
		}
		Err(_) => {
			return PollResponse::Retry {
				code: PollFailureCode::DeviceUnavailable,
			}
		}
	};
	if let Err(error) = super::identity::align_device(&mut device) {
		tracing::warn!(
			"[notification-poll] physical identity alignment failed: {error}"
		);
	} else if let Err(error) = DeviceStorage::save(&device) {
		tracing::error!(
			"[notification-poll] aligned identity persist failed: {error}"
		);
	}
	let saved_key = match SigningKeyStorage::load() {
		Ok(key) => key,
		Err(_) => {
			return PollResponse::Retry {
				code: PollFailureCode::SigningKeyUnavailable,
			}
		}
	};
	runtime.block_on(async move {
		let api_runtime =
			match ApiRuntime::get_or_try_init(device, Some(session)) {
				Ok(runtime) => runtime,
				Err(_) => {
					return PollResponse::Retry {
						code: PollFailureCode::ClientUnavailable,
					}
				}
			};
		let client = api_runtime.client();
		tracing::info!(
			runtime_id = api_runtime.id(),
			"[notification-poll] runtime"
		);
		if let Some(key) = saved_key {
			client.restore_signing_key(key).await;
		}

		let post = grindr::Method::from_str("POST").expect("valid method");
		let get = grindr::Method::from_str("GET").expect("valid method");
		let messages = if messages_enabled {
			let inbox_client = client.clone();
			let inbox = match api_runtime
				.request_raw_classified(
					RetryPolicy::SafeRead,
					RequestClass::BackgroundPoll,
					"/v4/inbox?page",
					move || {
						let client = inbox_client.clone();
						let method = post.clone();
						async move {
							client
								.request_authenticated_raw(
									method,
									"/v4/inbox?page=1",
									None,
								)
								.await
						}
					},
				)
				.await
			{
				Ok(response) => {
					tracing::info!(
						route = "/v4/inbox?page",
						status = response.status,
						response_bytes = response.body.len(),
						elapsed_ms = poll_started.elapsed().as_millis() as u64,
						"[notification-poll] request_complete"
					);
					response
				}
				Err(RuntimeError::Cooldown { .. })
				| Err(RuntimeError::Cancelled)
				| Err(RuntimeError::Grindr(grindr::GrindrError::Blocked))
				| Err(RuntimeError::Grindr(grindr::GrindrError::RateLimited)) => {
					persist_client_state(client);
					return PollResponse::Deferred;
				}
				Err(RuntimeError::Grindr(
					error @ grindr::GrindrError::Unauthorized { .. },
				)) => {
					tracing::warn!(
						route = "/v4/inbox?page",
						elapsed_ms = poll_started.elapsed().as_millis() as u64,
						error_kind = notification_error_kind(&error),
						"[notification-poll] signed_out"
					);
					persist_client_state(client);
					return PollResponse::SignedOut;
				}
				Err(RuntimeError::Grindr(error)) => {
					tracing::warn!(
						route = "/v4/inbox?page",
						elapsed_ms = poll_started.elapsed().as_millis() as u64,
						error_kind = notification_error_kind(&error),
						"[notification-poll] request_failed"
					);
					persist_client_state(client);
					return PollResponse::Retry {
						code: PollFailureCode::InboxRequest,
					};
				}
			};
			match classify_poll_http_response(inbox.status, &inbox.body) {
				PollHttpDisposition::Success => {}
				PollHttpDisposition::Deferred => {
					tracing::warn!(
						route = "/v4/inbox?page",
						status = inbox.status,
						"[notification-poll] response_deferred"
					);
					persist_client_state(client);
					return PollResponse::Deferred;
				}
				PollHttpDisposition::SignedOut => {
					tracing::warn!(
						route = "/v4/inbox?page",
						status = inbox.status,
						"[notification-poll] signed_out"
					);
					persist_client_state(client);
					return PollResponse::SignedOut;
				}
				PollHttpDisposition::Retry(error_kind) => {
					tracing::warn!(
						route = "/v4/inbox?page",
						status = inbox.status,
						error_kind,
						"[notification-poll] response_failed"
					);
					persist_client_state(client);
					return PollResponse::Retry {
						code: PollFailureCode::InboxResponse,
					};
				}
			}
			match parse_messages(&inbox.body) {
				Ok(messages) => messages,
				Err(_) => {
					persist_client_state(client);
					return PollResponse::Retry {
						code: PollFailureCode::InboxDecode,
					};
				}
			}
		} else {
			Vec::new()
		};
		let taps = if taps_enabled {
			let taps_client = client.clone();
			let taps_response = match api_runtime
				.request_raw_classified(
					RetryPolicy::SafeRead,
					RequestClass::BackgroundPoll,
					"/v2/taps/received",
					move || {
						let client = taps_client.clone();
						let method = get.clone();
						async move {
							client
								.request_authenticated_raw(
									method,
									"/v2/taps/received",
									None,
								)
								.await
						}
					},
				)
				.await
			{
				Ok(response) => {
					tracing::info!(
						route = "/v2/taps/received",
						status = response.status,
						response_bytes = response.body.len(),
						elapsed_ms = poll_started.elapsed().as_millis() as u64,
						"[notification-poll] request_complete"
					);
					response
				}
				Err(RuntimeError::Cooldown { .. })
				| Err(RuntimeError::Cancelled)
				| Err(RuntimeError::Grindr(grindr::GrindrError::Blocked))
				| Err(RuntimeError::Grindr(grindr::GrindrError::RateLimited)) => {
					persist_client_state(client);
					return PollResponse::Deferred;
				}
				Err(RuntimeError::Grindr(
					error @ grindr::GrindrError::Unauthorized { .. },
				)) => {
					tracing::warn!(
						route = "/v2/taps/received",
						elapsed_ms = poll_started.elapsed().as_millis() as u64,
						error_kind = notification_error_kind(&error),
						"[notification-poll] signed_out"
					);
					persist_client_state(client);
					return PollResponse::SignedOut;
				}
				Err(RuntimeError::Grindr(error)) => {
					tracing::warn!(
						route = "/v2/taps/received",
						elapsed_ms = poll_started.elapsed().as_millis() as u64,
						error_kind = notification_error_kind(&error),
						"[notification-poll] request_failed"
					);
					persist_client_state(client);
					return PollResponse::Retry {
						code: PollFailureCode::TapsRequest,
					};
				}
			};
			match classify_poll_http_response(
				taps_response.status,
				&taps_response.body,
			) {
				PollHttpDisposition::Success => {}
				PollHttpDisposition::Deferred => {
					tracing::warn!(
						route = "/v2/taps/received",
						status = taps_response.status,
						"[notification-poll] response_deferred"
					);
					persist_client_state(client);
					return PollResponse::Deferred;
				}
				PollHttpDisposition::SignedOut => {
					tracing::warn!(
						route = "/v2/taps/received",
						status = taps_response.status,
						"[notification-poll] signed_out"
					);
					persist_client_state(client);
					return PollResponse::SignedOut;
				}
				PollHttpDisposition::Retry(error_kind) => {
					tracing::warn!(
						route = "/v2/taps/received",
						status = taps_response.status,
						error_kind,
						"[notification-poll] response_failed"
					);
					persist_client_state(client);
					return PollResponse::Retry {
						code: PollFailureCode::TapsResponse,
					};
				}
			}
			match parse_taps(&taps_response.body) {
				Ok(taps) => taps,
				Err(_) => {
					persist_client_state(client);
					return PollResponse::Retry {
						code: PollFailureCode::TapsDecode,
					};
				}
			}
		} else {
			Vec::new()
		};
		persist_client_state(client);
		tracing::info!(
			elapsed_ms = poll_started.elapsed().as_millis() as u64,
			"[notification-poll] complete"
		);

		PollResponse::Ok {
			account_id,
			messages,
			taps,
		}
	})
}

#[cfg(any(target_os = "android", target_os = "ios"))]
fn persist_client_state(client: &grindr::GrindrClient) {
	match client.session_receiver().borrow().as_ref() {
		Some(session) => {
			if let Err(error) = AuthStorage::set_session(session) {
				tracing::error!(
					"[notifications] session persist failed: {error}"
				);
			}
		}
		None => AuthStorage::delete_session(),
	}
	if let Some(key) = client.signing_key_receiver().borrow().clone() {
		if let Err(error) = SigningKeyStorage::save(&key) {
			tracing::error!(
				"[notifications] signing key persist failed: {error}"
			);
		}
	}
}

#[cfg(target_os = "android")]
#[no_mangle]
pub extern "system" fn Java_org_opengrind_notifications_NotificationBridge_nativePoll(
	env: JNIEnv,
	_class: JClass,
	messages_enabled: jboolean,
	taps_enabled: jboolean,
) -> jstring {
	crate::logging::init();
	let response = catch_unwind(AssertUnwindSafe(|| {
		poll_notifications(messages_enabled != 0, taps_enabled != 0)
	}))
	.unwrap_or_else(|_| PollResponse::Retry {
		code: PollFailureCode::PollPanicked,
	});
	let json = serde_json::to_string(&response).unwrap_or_else(|_| {
		serde_json::json!({
			"state": "retry",
			"code": PollFailureCode::ResponseEncoding,
		})
		.to_string()
	});
	env.new_string(json)
		.map(JString::into_raw)
		.unwrap_or(std::ptr::null_mut())
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn open_grind_notifications_poll(
	messages_enabled: i32,
	taps_enabled: i32,
) -> *mut c_char {
	let response = catch_unwind(AssertUnwindSafe(|| {
		crate::logging::init();
		let response =
			poll_notifications(messages_enabled != 0, taps_enabled != 0);
		serde_json::to_string(&response)
			.ok()
			.and_then(|json| CString::new(json).ok())
	}))
	.ok()
	.flatten()
	.unwrap_or_else(|| {
		CString::new(r#"{"state":"retry","code":"poll_panicked"}"#)
			.unwrap_or_default()
	});
	response.into_raw()
}

#[cfg(target_os = "ios")]
#[no_mangle]
pub unsafe extern "C" fn open_grind_notifications_free(value: *mut c_char) {
	if !value.is_null() {
		// SAFETY: `value` must come from `open_grind_notifications_poll`
		// and this function consumes it exactly once.
		drop(unsafe { CString::from_raw(value) });
	}
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn parses_only_unmuted_unread_messages_without_requiring_preview_text() {
		let messages = parse_messages(
			br#"{"entries":[
				{"data":{"conversationId":"chat-1","name":"Ada","lastActivityTimestamp":42,
					"unreadCount":2,"preview":{"text":"hello"},"muted":false}},
				{"data":{"conversationId":"chat-2","name":"","lastActivityTimestamp":"43",
					"unreadCount":1,"preview":null,"muted":false}},
				{"data":{"conversationId":"chat-3","name":"Muted","lastActivityTimestamp":44,
					"unreadCount":3,"preview":{"text":"secret"},"muted":true}},
				{"data":{"conversationId":"chat-4","name":"Read","lastActivityTimestamp":45,
					"unreadCount":0,"preview":{"text":"seen"},"muted":false}}
			]}"#,
		)
		.unwrap();

		assert_eq!(
			messages,
			vec![
				PollMessage {
					conversation_id: "chat-1".to_owned(),
					title: "Ada".to_owned(),
					preview: Some("hello".to_owned()),
					timestamp: 42,
					unread_count: 2,
				},
				PollMessage {
					conversation_id: "chat-2".to_owned(),
					title: "New message".to_owned(),
					preview: None,
					timestamp: 43,
					unread_count: 1,
				},
			]
		);
	}

	#[test]
	fn parses_tap_identity_without_requiring_a_display_name() {
		let taps = parse_taps(
			br#"{"profiles":[
				{"profileId":7,"displayName":"Ada","timestamp":100},
				{"profileId":"8","displayName":null,"timestamp":"101"}
			]}"#,
		)
		.unwrap();

		assert_eq!(
			taps,
			vec![
				PollTap {
					profile_id: 7,
					display_name: Some("Ada".to_owned()),
					timestamp: 100,
				},
				PollTap {
					profile_id: 8,
					display_name: None,
					timestamp: 101,
				},
			]
		);
	}

	#[test]
	fn classifies_raw_notification_statuses_before_body_parsing() {
		assert_eq!(
			classify_poll_http_response(200, br#"{"entries":[]}"#),
			PollHttpDisposition::Success
		);
		assert_eq!(
			classify_poll_http_response(401, br#"{"message":"expired"}"#),
			PollHttpDisposition::SignedOut
		);
		assert_eq!(
			classify_poll_http_response(429, br#"{"message":"slow down"}"#),
			PollHttpDisposition::Deferred
		);
	}

	#[test]
	fn hostile_server_body_never_enters_worker_response() {
		let hostile = "private-token=secret user@example.com";
		let disposition = classify_poll_http_response(500, hostile.as_bytes());
		assert_eq!(disposition, PollHttpDisposition::Retry("api"));

		let response = PollResponse::Retry {
			code: PollFailureCode::InboxResponse,
		};
		let serialized = serde_json::to_string(&response).unwrap();
		assert!(!serialized.contains(hostile));
		assert_eq!(serialized, r#"{"state":"retry","code":"inbox_response"}"#);
	}
}
