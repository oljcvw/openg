use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};

#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::plugin::PluginHandle;
#[cfg(any(target_os = "android", target_os = "ios"))]
use tauri::{Manager, Wry};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_open_grind_media_capture);

use crate::{error::AppError, storage::AuthStorage};

#[derive(Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaCaptureAvailability {
	pub available: bool,
	pub reason: Option<String>,
}

fn availability(native_plugin_registered: bool) -> MediaCaptureAvailability {
	MediaCaptureAvailability {
		available: native_plugin_registered,
		reason: (!native_plugin_registered)
			.then(|| "unsupported-platform".to_owned()),
	}
}

static SHORT_VIDEO_CACHE_EPOCH: AtomicU64 = AtomicU64::new(0);
static SHORT_VIDEO_WRITE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn short_video_put_is_current(
	captured_epoch: u64,
	current_epoch: u64,
	account_is_active: bool,
) -> bool {
	captured_epoch == current_epoch && account_is_active
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ShortVideoCleanupResult {
	removed: bool,
	stale_write_absent: bool,
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn stale_cleanup_is_verified(cleanup: &ShortVideoCleanupResult) -> bool {
	matches!(
		(cleanup.removed, cleanup.stale_write_absent),
		(true, true) | (false, true)
	)
}

#[cfg(any(target_os = "android", target_os = "ios", test))]
fn require_verified_stale_cleanup(
	result: Result<ShortVideoCleanupResult, AppError>,
) -> Result<(), AppError> {
	let cleanup = result?;
	if stale_cleanup_is_verified(&cleanup) {
		Ok(())
	} else {
		Err(AppError::Http(
			"Native short-video cache could not verify stale-write cleanup"
				.to_owned(),
		))
	}
}

fn short_video_write_token(epoch: u64) -> String {
	let sequence = SHORT_VIDEO_WRITE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
	format!("{epoch}-{sequence}")
}

fn ensure_active_cache_account(account_id: &str) -> Result<(), AppError> {
	let session = AuthStorage::get_session()?.ok_or_else(|| AppError::Api {
		code: 401,
		message: "An active account is required".to_owned(),
	})?;
	if session.profile_id == account_id {
		Ok(())
	} else {
		Err(AppError::Api {
			code: 403,
			message: "The cache account is not active".to_owned(),
		})
	}
}

#[cfg(any(target_os = "android", target_os = "ios"))]
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

#[cfg(any(target_os = "android", target_os = "ios"))]
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

#[cfg(any(target_os = "android", target_os = "ios"))]
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

#[cfg(any(target_os = "android", target_os = "ios"))]
pub struct MobileMediaCapture {
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
				_app.manage(MobileMediaCapture { handle });
			}
			#[cfg(target_os = "ios")]
			{
				let handle = _api.register_ios_plugin(
					init_plugin_open_grind_media_capture,
				)?;
				_app.manage(MobileMediaCapture { handle });
			}
			Ok(())
		})
		.build()
}

#[tauri::command]
pub async fn media_capture_availability() -> MediaCaptureAvailability {
	availability(cfg!(any(target_os = "android", target_os = "ios")))
}

#[tauri::command]
pub async fn media_capture_photo(
	app: tauri::AppHandle,
) -> Result<CapturedPhoto, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		ensure_camera_permission(&app).await?;
		return run_mobile(&app, "capturePhoto", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Err(unsupported_error())
	}
}

#[tauri::command]
pub async fn media_capture_short_video(
	app: tauri::AppHandle,
) -> Result<CapturedShortVideo, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
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
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(
			&app,
			"deleteShortVideo",
			serde_json::json!({ "captureId": capture_id }),
		)
		.await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
	ensure_active_cache_account(&account_id)?;
	let captured_epoch = SHORT_VIDEO_CACHE_EPOCH.load(Ordering::Acquire);
	let write_token = short_video_write_token(captured_epoch);
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		let result = run_mobile(
			&app,
			"cacheShortVideo",
			serde_json::json!({
				"accountId": account_id,
				"mediaId": media_id,
				"dataBase64": data_base64,
				"maximumBytes": maximum_bytes,
				"writeToken": write_token,
				"cacheGeneration": captured_epoch,
			}),
		)
		.await?;
		if !short_video_put_is_current(
			captured_epoch,
			SHORT_VIDEO_CACHE_EPOCH.load(Ordering::Acquire),
			ensure_active_cache_account(&account_id).is_ok(),
		) {
			require_verified_stale_cleanup(
				run_mobile(
					&app,
					"removeCachedShortVideoIfToken",
					serde_json::json!({
						"accountId": account_id,
						"mediaId": media_id,
						"writeToken": write_token,
					}),
				)
				.await,
			)?;
			return Err(AppError::RequestCancelled);
		}
		return Ok(result);
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (
			app,
			account_id,
			media_id,
			data_base64,
			maximum_bytes,
			captured_epoch,
			write_token,
		);
		Ok(empty_cache_stats())
	}
}

#[tauri::command]
pub async fn short_video_cache_get(
	app: tauri::AppHandle,
	account_id: String,
	media_id: String,
) -> Result<CachedShortVideo, AppError> {
	ensure_active_cache_account(&account_id)?;
	#[cfg(any(target_os = "android", target_os = "ios"))]
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
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
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
	let clear_generation =
		SHORT_VIDEO_CACHE_EPOCH.fetch_add(1, Ordering::AcqRel) + 1;
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		let input = account_id.map_or_else(
			|| serde_json::json!({ "cacheGeneration": clear_generation }),
			|account_id| {
				serde_json::json!({
					"accountId": account_id,
					"cacheGeneration": clear_generation,
				})
			},
		);
		return run_mobile(&app, "clearShortVideoCache", input).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (app, account_id, clear_generation);
		Ok(empty_cache_stats())
	}
}

#[cfg(test)]
mod tests {
	use super::{
		require_verified_stale_cleanup, short_video_put_is_current,
		stale_cleanup_is_verified, ShortVideoCleanupResult,
	};
	use crate::error::AppError;

	#[test]
	fn clear_or_account_change_fences_late_short_video_puts() {
		assert!(short_video_put_is_current(4, 4, true));
		assert!(!short_video_put_is_current(4, 5, true));
		assert!(!short_video_put_is_current(4, 4, false));
	}

	#[test]
	fn stale_cleanup_requires_verified_absence() {
		assert!(stale_cleanup_is_verified(&ShortVideoCleanupResult {
			removed: true,
			stale_write_absent: true,
		}));
		assert!(stale_cleanup_is_verified(&ShortVideoCleanupResult {
			removed: false,
			stale_write_absent: true,
		}));
		assert!(!stale_cleanup_is_verified(&ShortVideoCleanupResult {
			removed: false,
			stale_write_absent: false,
		}));
	}

	#[test]
	fn stale_cleanup_propagates_invocation_failure_and_false_deletion() {
		assert!(require_verified_stale_cleanup(Err(
			AppError::RequestCancelled
		))
		.is_err());
		assert!(require_verified_stale_cleanup(Ok(ShortVideoCleanupResult {
			removed: false,
			stale_write_absent: false,
		}))
		.is_err());
	}
}

#[tauri::command]
pub async fn short_video_cache_remove(
	app: tauri::AppHandle,
	account_id: String,
	media_id: String,
) -> Result<bool, AppError> {
	ensure_active_cache_account(&account_id)?;
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		#[derive(serde::Deserialize)]
		struct Removed {
			removed: bool,
		}
		let result: Removed = run_mobile(
			&app,
			"removeCachedShortVideo",
			serde_json::json!({
				"accountId": account_id,
				"mediaId": media_id,
			}),
		)
		.await?;
		return Ok(result.removed);
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (app, account_id, media_id);
		Ok(false)
	}
}

#[tauri::command]
pub async fn short_video_cache_trim(
	app: tauri::AppHandle,
	maximum_bytes: u64,
) -> Result<ShortVideoCacheStats, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(
			&app,
			"trimShortVideoCache",
			serde_json::json!({ "maximumBytes": maximum_bytes }),
		)
		.await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = (app, maximum_bytes);
		Ok(empty_cache_stats())
	}
}

#[tauri::command]
pub async fn short_video_cache_stats(
	app: tauri::AppHandle,
) -> Result<ShortVideoCacheStats, AppError> {
	#[cfg(any(target_os = "android", target_os = "ios"))]
	{
		return run_mobile(&app, "getShortVideoCacheStats", ()).await;
	}
	#[cfg(not(any(target_os = "android", target_os = "ios")))]
	{
		let _ = app;
		Ok(empty_cache_stats())
	}
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn empty_cache_stats() -> ShortVideoCacheStats {
	ShortVideoCacheStats {
		byte_length: 0,
		entry_count: 0,
	}
}

#[cfg(any(target_os = "android", target_os = "ios"))]
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
	app.state::<MobileMediaCapture>()
		.handle
		.run_mobile_plugin_async(command, input)
		.await
		.map_err(|error| {
			AppError::Http(format!(
				"Native media capture bridge failed: {error}"
			))
		})
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn unsupported_error() -> AppError {
	AppError::Api {
		code: 400,
		message: "Camera media capture is only supported on mobile".to_owned(),
	}
}

#[cfg(test)]
mod availability_tests {
	use super::*;

	#[test]
	fn availability_reports_registered_native_support() {
		assert_eq!(
			availability(true),
			MediaCaptureAvailability {
				available: true,
				reason: None,
			}
		);
	}

	#[test]
	fn availability_reports_unsupported_platform() {
		assert_eq!(
			availability(false),
			MediaCaptureAvailability {
				available: false,
				reason: Some("unsupported-platform".to_owned()),
			}
		);
	}
}
