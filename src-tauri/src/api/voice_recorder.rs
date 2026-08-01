use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::{Manager, Wry};

use crate::error::AppError;

#[derive(Debug, Deserialize, Serialize)]
pub struct VoicePermissionStatus {
	pub status: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum VoiceRecordingResult {
	Ready {
		#[serde(rename = "dataBase64")]
		data_base64: String,
		#[serde(rename = "contentType")]
		content_type: String,
		#[serde(rename = "durationMs")]
		duration_ms: u64,
	},
	TooShort,
}

#[cfg(target_os = "android")]
pub struct AndroidVoiceRecorder {
	handle: PluginHandle<Wry>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-voice-recorder")
		.setup(|_app, _api| {
			#[cfg(target_os = "android")]
			{
				let handle = _api.register_android_plugin(
					"org.opengrind.voicerecorder",
					"VoiceRecorderPlugin",
				)?;
				_app.manage(AndroidVoiceRecorder { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn voice_recorder_permission_status(
	app: tauri::AppHandle,
) -> Result<VoicePermissionStatus, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "getPermissionStatus", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Ok(VoicePermissionStatus {
			status: "unsupported".to_owned(),
		})
	}
}

#[tauri::command]
pub async fn voice_recorder_request_permission(
	app: tauri::AppHandle,
) -> Result<VoicePermissionStatus, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "requestPermission", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Ok(VoicePermissionStatus {
			status: "unsupported".to_owned(),
		})
	}
}

#[tauri::command]
pub async fn voice_recorder_start(
	app: tauri::AppHandle,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "startRecording", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn voice_recorder_stop(
	app: tauri::AppHandle,
) -> Result<VoiceRecordingResult, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "stopRecording", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn voice_recorder_cancel(
	app: tauri::AppHandle,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "cancelRecording", ()).await;
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
	app.state::<AndroidVoiceRecorder>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|_| {
			AppError::Http("Android voice recorder bridge failed".to_owned())
		})
}

#[cfg(not(target_os = "android"))]
fn unsupported_error() -> AppError {
	AppError::Api {
		code: 400,
		message: "Voice recording is only supported on Android".to_owned(),
	}
}
