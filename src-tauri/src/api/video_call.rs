use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::{Manager, Wry};

use crate::error::AppError;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCallAvailability {
	pub available: bool,
	pub build_configured: Option<bool>,
	pub permissions_granted: Option<bool>,
	pub camera_permission: Option<String>,
	pub microphone_permission: Option<String>,
	pub reason: Option<String>,
	pub sdk_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoCallSession {
	pub channel_id: String,
	pub token: String,
	pub direction: String,
	pub connected_limit_seconds: u64,
	pub quality: String,
}

#[cfg(target_os = "android")]
pub struct AndroidVideoCall {
	handle: PluginHandle<Wry>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-video-call")
		.setup(|_app, _api| {
			#[cfg(target_os = "android")]
			{
				let handle = _api.register_android_plugin(
					"org.opengrind.media",
					"VideoCallPlugin",
				)?;
				_app.manage(AndroidVideoCall { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn video_call_availability(
	app: tauri::AppHandle,
) -> Result<VideoCallAvailability, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "availability", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Ok(VideoCallAvailability {
			available: false,
			build_configured: Some(false),
			permissions_granted: Some(false),
			camera_permission: Some("unsupported".to_owned()),
			microphone_permission: Some("unsupported".to_owned()),
			reason: Some("unsupported-platform".to_owned()),
			sdk_version: None,
		})
	}
}

#[tauri::command]
pub async fn video_call_start(
	app: tauri::AppHandle,
	session: VideoCallSession,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(
			&app,
			"start",
			serde_json::json!({
				"channel": session.channel_id,
				"token": session.token,
				"uid": 0,
				"quality": session.quality,
				"direction": session.direction,
				"connectedLimitSeconds": session.connected_limit_seconds,
			}),
		)
		.await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, session);
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn video_call_renew_token(
	app: tauri::AppHandle,
	token: String,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(
			&app,
			"renewToken",
			serde_json::json!({ "token": token }),
		)
		.await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, token);
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn video_call_stop(app: tauri::AppHandle) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "stop", ()).await;
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
	app.state::<AndroidVideoCall>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|error| {
			AppError::Http(format!("Android video-call bridge failed: {error}"))
		})
}

#[cfg(not(target_os = "android"))]
fn unsupported_error() -> AppError {
	AppError::Api {
		code: 400,
		message: "Video calls are only supported on Android".to_owned(),
	}
}
