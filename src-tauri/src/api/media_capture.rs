use serde::{Deserialize, Serialize};

#[cfg(target_os = "android")]
use tauri::plugin::PluginHandle;
#[cfg(target_os = "android")]
use tauri::{Manager, Wry};

use crate::error::AppError;

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize, Serialize)]
pub struct CameraPermissionStatus {
	pub status: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedPhoto {
	pub status: String,
	pub data_base64: String,
	pub content_type: String,
	pub byte_length: u64,
	pub width: u32,
	pub height: u32,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeShortVideo {
	capture_id: String,
	content_type: String,
	duration_ms: u64,
	byte_length: u64,
	width: u32,
	height: u32,
	has_audio: bool,
}

#[cfg(target_os = "android")]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NativeShortVideoBytes {
	data_base64: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedShortVideo {
	pub status: String,
	pub data_base64: String,
	pub file_cache_key: String,
	pub content_type: String,
	pub duration_ms: u64,
	pub byte_length: u64,
	pub width: u32,
	pub height: u32,
	pub has_audio: bool,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShortVideoCacheStats {
	pub byte_length: u64,
	pub entry_count: u64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedShortVideo {
	pub found: bool,
	pub data_base64: Option<String>,
	pub content_type: Option<String>,
	pub byte_length: Option<u64>,
}

#[cfg(target_os = "android")]
pub struct AndroidMediaCapture {
	handle: PluginHandle<Wry>,
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
	tauri::plugin::Builder::new("open-grind-media-capture")
		.setup(|_app, _api| {
			#[cfg(target_os = "android")]
			{
				let handle = _api.register_android_plugin(
					"org.opengrind.media",
					"MediaCapturePlugin",
				)?;
				_app.manage(AndroidMediaCapture { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn media_capture_photo(
	app: tauri::AppHandle,
) -> Result<CapturedPhoto, AppError> {
	#[cfg(target_os = "android")]
	{
		ensure_camera_permission(&app).await?;
		return run_mobile(&app, "capturePhoto", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn media_capture_short_video(
	app: tauri::AppHandle,
) -> Result<CapturedShortVideo, AppError> {
	#[cfg(target_os = "android")]
	{
		ensure_camera_permission(&app).await?;
		let captured: NativeShortVideo =
			run_mobile(&app, "captureShortVideo", ()).await?;
		let bytes: NativeShortVideoBytes = run_mobile(
			&app,
			"readShortVideo",
			serde_json::json!({ "captureId": captured.capture_id }),
		)
		.await?;
		return Ok(CapturedShortVideo {
			status: "ready".to_owned(),
			data_base64: bytes.data_base64,
			file_cache_key: captured.capture_id,
			content_type: captured.content_type,
			duration_ms: captured.duration_ms,
			byte_length: captured.byte_length,
			width: captured.width,
			height: captured.height,
			has_audio: captured.has_audio,
		});
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn media_capture_delete_short_video(
	app: tauri::AppHandle,
	capture_id: String,
) -> Result<(), AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(
			&app,
			"deleteShortVideo",
			serde_json::json!({ "captureId": capture_id }),
		)
		.await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, capture_id);
		Ok(())
	}
}

#[tauri::command]
pub async fn short_video_cache_put(
	app: tauri::AppHandle,
	account_id: String,
	media_id: String,
	data_base64: String,
	maximum_bytes: u64,
) -> Result<ShortVideoCacheStats, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(
			&app,
			"cacheShortVideo",
			serde_json::json!({
				"accountId": account_id,
				"mediaId": media_id,
				"dataBase64": data_base64,
				"maximumBytes": maximum_bytes,
			}),
		)
		.await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, account_id, media_id, data_base64, maximum_bytes);
		Ok(empty_cache_stats())
	}
}

#[tauri::command]
pub async fn short_video_cache_get(
	app: tauri::AppHandle,
	account_id: String,
	media_id: String,
) -> Result<CachedShortVideo, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(
			&app,
			"getCachedShortVideo",
			serde_json::json!({
				"accountId": account_id,
				"mediaId": media_id,
			}),
		)
		.await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, account_id, media_id);
		Ok(CachedShortVideo {
			found: false,
			data_base64: None,
			content_type: None,
			byte_length: None,
		})
	}
}

#[tauri::command]
pub async fn short_video_cache_clear(
	app: tauri::AppHandle,
	account_id: Option<String>,
) -> Result<ShortVideoCacheStats, AppError> {
	#[cfg(target_os = "android")]
	{
		let input = account_id.map_or_else(
			|| serde_json::json!({}),
			|account_id| serde_json::json!({ "accountId": account_id }),
		);
		return run_mobile(&app, "clearShortVideoCache", input).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, account_id);
		Ok(empty_cache_stats())
	}
}

#[tauri::command]
pub async fn short_video_cache_trim(
	app: tauri::AppHandle,
	maximum_bytes: u64,
) -> Result<ShortVideoCacheStats, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(
			&app,
			"trimShortVideoCache",
			serde_json::json!({ "maximumBytes": maximum_bytes }),
		)
		.await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = (app, maximum_bytes);
		Ok(empty_cache_stats())
	}
}

#[tauri::command]
pub async fn short_video_cache_stats(
	app: tauri::AppHandle,
) -> Result<ShortVideoCacheStats, AppError> {
	#[cfg(target_os = "android")]
	{
		return run_mobile(&app, "getShortVideoCacheStats", ()).await;
	}
	#[cfg(not(target_os = "android"))]
	{
		let _ = app;
		Ok(empty_cache_stats())
	}
}

#[cfg(not(target_os = "android"))]
fn empty_cache_stats() -> ShortVideoCacheStats {
	ShortVideoCacheStats {
		byte_length: 0,
		entry_count: 0,
	}
}

#[cfg(target_os = "android")]
async fn ensure_camera_permission(
	app: &tauri::AppHandle,
) -> Result<(), AppError> {
	let mut permission: CameraPermissionStatus =
		run_mobile(app, "getCameraPermissionStatus", ()).await?;
	if permission.status == "prompt" || permission.status == "denied" {
		permission = run_mobile(app, "requestCameraPermission", ()).await?;
	}
	if permission.status == "granted" {
		Ok(())
	} else {
		Err(AppError::Api {
			code: 403,
			message: "Camera permission is required".to_owned(),
		})
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
	app.state::<AndroidMediaCapture>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|error| {
			AppError::Http(format!(
				"Android media capture bridge failed: {error}"
			))
		})
}

#[cfg(not(target_os = "android"))]
fn unsupported_error() -> AppError {
	AppError::Api {
		code: 400,
		message: "Camera media capture is only supported on Android".to_owned(),
	}
}
