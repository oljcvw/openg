use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(target_os = "android")]
use std::panic::{catch_unwind, AssertUnwindSafe};
#[cfg(target_os = "android")]
use std::str::FromStr;

#[cfg(target_os = "android")]
use jni::objects::{JClass, JString};
#[cfg(target_os = "android")]
use jni::sys::jstring;
#[cfg(target_os = "android")]
use jni::JNIEnv;
#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::{Manager, Wry};

use crate::error::AppError;
#[cfg(target_os = "android")]
use crate::storage::{AuthStorage, DeviceStorage, SigningKeyStorage};

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

#[cfg(not(target_os = "android"))]
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

#[cfg(target_os = "android")]
pub struct AndroidNotifications {
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
				_app.manage(AndroidNotifications { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn notification_get_settings(
	app: tauri::AppHandle,
) -> Result<NotificationSettings, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "getSettings", ()).await;
	}
	#[cfg(not(target_os = "android"))]
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
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "setSettings", settings).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, settings);
		Ok(NotificationSettings::unsupported())
	}
}

#[tauri::command]
pub async fn notification_test(app: tauri::AppHandle) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		let _: Value = run_mobile(&app, "testNotification", ()).await?;
		return Ok(());
	}
	#[cfg(not(target_os = "android"))]
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
pub async fn notification_sync(app: tauri::AppHandle) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		let _: Value = run_mobile(&app, "syncSchedule", ()).await?;
		return Ok(());
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Ok(())
	}
}

#[tauri::command]
pub async fn notification_cancel(
	app: tauri::AppHandle,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		let _: Value = run_mobile(&app, "cancelSchedule", ()).await?;
		return Ok(());
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Ok(())
	}
}

#[cfg(target_os = "android")]
async fn run_mobile<I, O>(
	app: &tauri::AppHandle,
	command: &str,
	input: I,
) -> Result<O, AppError>
where
	I: Serialize,
	O: for<'de> Deserialize<'de>,
{
	app.state::<AndroidNotifications>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|error| {
			AppError::Http(format!(
				"Android notification bridge failed: {error}"
			))
		})
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PollMessage {
	conversation_id: String,
	title: String,
	preview: Option<String>,
	timestamp: u64,
	unread_count: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PollTap {
	profile_id: u64,
	display_name: Option<String>,
	timestamp: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "state", rename_all = "camelCase")]
#[cfg(target_os = "android")]
enum PollResponse {
	Ok {
		account_id: String,
		messages: Vec<PollMessage>,
		taps: Vec<PollTap>,
	},
	SignedOut,
	Retry {
		error: String,
	},
}

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

fn value_u64(value: &Value) -> Option<u64> {
	value
		.as_u64()
		.or_else(|| value.as_str().and_then(|raw| raw.parse().ok()))
}

#[cfg(target_os = "android")]
fn poll_notifications() -> PollResponse {
	crate::storage::init_keyring();

	let session = match AuthStorage::get_session() {
		Ok(Some(session)) => session,
		Ok(None) => return PollResponse::SignedOut,
		Err(error) => {
			return PollResponse::Retry {
				error: format!("session unavailable: {error}"),
			}
		}
	};
	let account_id = session.profile_id.clone();
	let device = match DeviceStorage::load() {
		Ok(Some(device)) => device,
		Ok(None) => {
			return PollResponse::Retry {
				error: "device identity unavailable".to_owned(),
			}
		}
		Err(error) => {
			return PollResponse::Retry {
				error: format!("device identity unavailable: {error}"),
			}
		}
	};
	let saved_key = match SigningKeyStorage::load() {
		Ok(key) => key,
		Err(error) => {
			return PollResponse::Retry {
				error: format!("device signing key unavailable: {error}"),
			}
		}
	};

	let runtime = match tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
	{
		Ok(runtime) => runtime,
		Err(error) => {
			return PollResponse::Retry {
				error: format!("background runtime failed: {error}"),
			}
		}
	};

	runtime.block_on(async move {
		let client = match grindr::GrindrClient::new(device, Some(session)) {
			Ok(client) => client,
			Err(error) => {
				return PollResponse::Retry {
					error: format!("background client failed: {error}"),
				}
			}
		};
		if let Some(key) = saved_key {
			client.restore_signing_key(key).await;
		}

		let post = grindr::Method::from_str("POST").expect("valid method");
		let get = grindr::Method::from_str("GET").expect("valid method");
		let inbox = match client
			.request_authenticated_raw(post, "/v4/inbox?page=1", None)
			.await
		{
			Ok(response) => response,
			Err(error) => {
				persist_client_state(&client);
				return PollResponse::Retry {
					error: format!("inbox request failed: {error}"),
				};
			}
		};
		let taps = match client
			.request_authenticated_raw(get, "/v2/taps/received", None)
			.await
		{
			Ok(response) => response,
			Err(error) => {
				persist_client_state(&client);
				return PollResponse::Retry {
					error: format!("taps request failed: {error}"),
				};
			}
		};
		persist_client_state(&client);

		match (parse_messages(&inbox.body), parse_taps(&taps.body)) {
			(Ok(messages), Ok(taps)) => PollResponse::Ok {
				account_id,
				messages,
				taps,
			},
			(Err(error), _) | (_, Err(error)) => PollResponse::Retry { error },
		}
	})
}

#[cfg(target_os = "android")]
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
) -> jstring {
	let response = catch_unwind(AssertUnwindSafe(poll_notifications))
		.unwrap_or_else(|_| PollResponse::Retry {
			error: "background poll panicked".to_owned(),
		});
	let json = serde_json::to_string(&response).unwrap_or_else(|_| {
		r#"{"state":"retry","error":"response encoding failed"}"#.to_owned()
	});
	env.new_string(json)
		.map(JString::into_raw)
		.unwrap_or(std::ptr::null_mut())
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
}
