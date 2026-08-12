use serde::{Deserialize, Serialize};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{Manager, Wry};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_open_grind_voice_recorder);

use crate::error::AppError;

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VoiceRecorderAvailability {
	pub available: bool,
	pub reason: Option<String>,
}

fn availability(native_plugin_registered: bool) -> VoiceRecorderAvailability {
	VoiceRecorderAvailability {
		available: native_plugin_registered,
		reason: (!native_plugin_registered)
			.then(|| "unsupported-platform".to_owned()),
	}
}

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

#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct MobileVoiceRecorder {
	handle: PluginHandle<Wry>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-voice-recorder")
		.setup(|_app, _api| {
			#[cfg(target_os = "android")]
			{
				let handle = _api.register_android_plugin(
					"doctor.andrewcox.opengrind.voicerecorder",
					"VoiceRecorderPlugin",
				)?;
				_app.manage(MobileVoiceRecorder { handle });
			}
			#[cfg(target_os = "ios")]
			{
				let handle = _api.register_ios_plugin(
					init_plugin_open_grind_voice_recorder,
				)?;
				_app.manage(MobileVoiceRecorder { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn voice_recorder_availability() -> VoiceRecorderAvailability {
	availability(cfg!(any(target_os = "android", target_os = "ios")))
}

#[cfg(test)]
mod tests {
	use super::*;

	#[test]
	fn availability_reports_registered_native_support() {
		assert_eq!(
			availability(true),
			VoiceRecorderAvailability {
				available: true,
				reason: None,
			}
		);
	}

	#[test]
	fn availability_reports_unsupported_platform() {
		assert_eq!(
			availability(false),
			VoiceRecorderAvailability {
				available: false,
				reason: Some("unsupported-platform".to_owned()),
			}
		);
	}
}

#[tauri::command]
pub async fn voice_recorder_permission_status(
	app: tauri::AppHandle,
) -> Result<VoicePermissionStatus, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "getPermissionStatus", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "requestPermission", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "startRecording", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn voice_recorder_stop(
	app: tauri::AppHandle,
) -> Result<VoiceRecordingResult, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "stopRecording", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn voice_recorder_cancel(
	app: tauri::AppHandle,
) -> Result<(), AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "cancelRecording", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Ok(())
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
	app.state::<MobileVoiceRecorder>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|error| {
			AppError::Http(format!(
				"Native voice recorder bridge failed: {error}"
			))
		})
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn unsupported_error() -> AppError {
	AppError::Api {
		code: 400,
		message: "Voice recording is only supported on Android".to_owned(),
	}
}
