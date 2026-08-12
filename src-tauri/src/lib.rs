pub mod api;
mod error;
#[cfg_attr(debug_assertions, allow(dead_code))]
mod logging;
mod state;
mod storage;

use crate::state::AppState;
use crate::storage::{
	account_storage_lock, AuthStorage, DeviceStorage, SigningKeyStorage,
};
use tauri::Emitter;
#[cfg(any(
	target_os = "linux",
	all(target_os = "macos", not(feature = "keychain"))
))]
use tauri::Manager;

// Mirrors MIN_SUPPORTED_WEBVIEW_MAJOR in gen/android/app/build.gradle.kts and the
// CSS feature floor in src/app.html (Tailwind v4: Chromium 111 / WebKitGTK 2.42 /
// Safari 16.4). Keep in sync.
#[cfg(target_os = "windows")]
const MIN_CHROMIUM_MAJOR: u32 = 111;
#[cfg(target_os = "linux")]
const MIN_WEBKITGTK: (u32, u32) = (2, 42);

const OPEN_GRIND_PLATFORM: &str = if cfg!(target_os = "android") {
	"android"
} else if cfg!(target_os = "ios") {
	"ios"
} else if cfg!(target_os = "windows") {
	"windows"
} else if cfg!(target_os = "macos") {
	"macos"
} else if cfg!(target_os = "linux") {
	"linux"
} else {
	"unknown"
};

fn open_grind_platform_plugin<R: tauri::Runtime>(
) -> tauri::plugin::TauriPlugin<R> {
	tauri::plugin::Builder::<R, ()>::new("open-grind-platform")
		.js_init_script(format!(
			r#"window.__OPEN_GRIND_PLATFORM = "{OPEN_GRIND_PLATFORM}";"#
		))
		.on_event(|_app, event| match event {
			tauri::RunEvent::Ready => api::ws::set_app_foreground(true),
			tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. } => {
				api::ws::set_app_foreground(false);
			}
			#[cfg(mobile)]
			tauri::RunEvent::WindowEvent { event, .. } => match event {
				tauri::WindowEvent::Resumed => {
					api::ws::set_app_foreground(true);
				}
				tauri::WindowEvent::Suspended => {
					api::ws::set_app_foreground(false);
				}
				_ => {}
			},
			_ => {}
		})
		.build()
}

fn is_app_url(url: &tauri::Url) -> bool {
	let host = url.host_str();
	match url.scheme() {
		"tauri" => host == Some("localhost"),
		"http" | "https" => {
			host == Some("tauri.localhost")
				|| (cfg!(debug_assertions)
					&& matches!(host, Some("localhost") | Some("127.0.0.1")))
		}
		_ => false,
	}
}

// macOS reports a WebKit build number that doesn't track Safari versions
#[cfg(desktop)]
fn outdated_webview_notice() -> Option<String> {
	#[cfg(target_os = "windows")]
	{
		let version = tauri::webview_version().ok()?;
		if version.split('.').next()?.parse::<u32>().ok()? < MIN_CHROMIUM_MAJOR
		{
			return Some(format!(
                "Open Grind needs Microsoft Edge WebView2 {MIN_CHROMIUM_MAJOR} or newer to \
                 display correctly (found {version}).\n\nUpdate the WebView2 Runtime, then \
                 restart the app."
            ));
		}
	}

	#[cfg(target_os = "linux")]
	{
		let version = tauri::webview_version().ok()?;
		let mut parts = version.split('.');
		let major = parts.next()?.parse::<u32>().ok()?;
		let minor = parts
			.next()
			.and_then(|p| p.parse::<u32>().ok())
			.unwrap_or(0);
		if (major, minor) < MIN_WEBKITGTK {
			let (min_major, min_minor) = MIN_WEBKITGTK;
			return Some(format!(
                "Open Grind needs WebKitGTK {min_major}.{min_minor} or newer to display \
                 correctly (found {version}).\n\nUpdate webkit2gtk / your distribution, \
                 then restart the app."
            ));
		}
	}

	None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
	#[cfg(not(debug_assertions))]
	logging::init();

	#[cfg(debug_assertions)]
	let devtools = tauri_plugin_devtools::init();

	let builder = tauri::Builder::default();

	#[cfg(debug_assertions)]
	let builder = builder.plugin(devtools);

	#[cfg(target_os = "android")]
	let builder = builder.plugin(tauri_plugin_android_fs::init());

	builder
        .plugin(open_grind_platform_plugin())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_geolocation::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(api::google_oauth::plugin())
		.plugin(api::media_capture::plugin())
        .plugin(api::notifications::plugin())
        .plugin(api::voice_recorder::plugin())
		.plugin(api::video_call::plugin())
		.plugin(api::album_cache::plugin())
		.plugin(api::direct_media_cache::plugin())
        .manage(AppState)
        .invoke_handler(tauri::generate_handler![
            api::account::validate_password_complexity,
            api::account::update_account_password,
            api::account::update_account_email,
            api::account::delete_account,
			api::album_cache::album_cache_store,
			api::album_cache::album_cache_lookup,
			api::album_cache::album_cache_bind_legacy_owner,
			api::album_cache::album_cache_record_store,
			api::album_cache::album_cache_record_read,
			api::album_cache::album_cache_records_page,
			api::album_cache::album_cache_records_reconcile_membership,
			api::album_cache::album_cache_membership_snapshot_store,
			api::album_cache::album_cache_membership_snapshot_read,
			api::album_cache::album_cache_stats,
			api::album_cache::album_cache_trim,
			api::album_cache::album_cache_clear,
			api::album_presets::album_preset_import,
			api::album_presets::album_preset_import_remote,
			api::album_presets::album_preset_list,
			api::album_presets::album_preset_read_item,
			api::album_presets::album_preset_delete,
			api::album_presets::album_preset_stats,
			api::album_presets::album_preset_clear,
			api::album_presets::album_activation_journal_save,
			api::album_presets::album_activation_journal_read,
			api::direct_media_cache::direct_media_cache_upsert,
			api::direct_media_cache::direct_media_cache_upsert_batch,
			api::direct_media_cache::direct_media_cache_set_scope,
			api::direct_media_cache::direct_media_cache_store,
			api::direct_media_cache::direct_media_cache_import_legacy,
			api::direct_media_cache::direct_media_cache_lookup,
			api::direct_media_cache::direct_media_cache_presence,
			api::direct_media_cache::direct_media_cache_list,
			api::direct_media_cache::direct_media_cache_stats,
			api::direct_media_cache::direct_media_cache_trim,
			api::direct_media_cache::direct_media_cache_clear,
            api::auth::login,
            api::auth::login_with_google,
            api::auth::google_sign_in,
            api::auth::refresh_token,
            api::auth::logout,
            api::auth::auth_state,
            api::auth::account_restriction,
			api::auth::recaptcha_first_party_enabled,
			api::runtime::api_runtime_configure,
            api::rest::request,
            api::rest::cancel_request,
            api::media_upload::upload_album_media,
            api::media_upload::upload_chat_media,
            api::media_upload::upload_expiring_chat_video,
			api::media_capture::media_capture_photo,
			api::media_capture::media_capture_short_video,
			api::media_capture::media_capture_delete_short_video,
			api::media_capture::short_video_cache_put,
			api::media_capture::short_video_cache_get,
			api::media_capture::short_video_cache_clear,
			api::media_capture::short_video_cache_remove,
			api::media_capture::short_video_cache_trim,
			api::media_capture::short_video_cache_stats,
            api::notifications::notification_get_settings,
            api::notifications::notification_set_settings,
            api::notifications::notification_test,
            api::notifications::notification_sync,
            api::notifications::notification_cancel,
            api::notifications::notification_clear_account,
			api::notifications::set_logcat_enabled,
            api::voice_recorder::voice_recorder_permission_status,
            api::voice_recorder::voice_recorder_request_permission,
            api::voice_recorder::voice_recorder_start,
            api::voice_recorder::voice_recorder_stop,
            api::voice_recorder::voice_recorder_cancel,
			api::video_call::video_call_availability,
			api::video_call::video_call_start,
			api::video_call::video_call_renew_token,
			api::video_call::video_call_stop,
            api::ws::ws_connect,
            api::ws::ws_send,
            api::diagnostics::report_media_origin,
			api::diagnostics::report_client_diagnostic,
			api::diagnostics::report_viewer_diagnostic,
        ])
        .setup(|app| {
            let user_agent = format!(
                "open-grind/{} (+https://opengrind.org/; contact: admin@opengrind.org)",
                app.package_info().version
            );
            let deferred: Vec<_> = app
                .config()
                .app
                .windows
                .iter()
                .filter(|window| !window.create)
                .cloned()
                .collect();
            for window in deferred {
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window)?
                    .user_agent(&user_agent)
                    .on_navigation(is_app_url)
                    .build()?;
            }

            #[cfg(desktop)]
            if let Some(message) = outdated_webview_notice() {
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                app.dialog()
                    .message(message)
                    .title("WebView may be too old")
                    .kind(MessageDialogKind::Warning)
                    .show(|_| {});
            }

            #[cfg(any(
                target_os = "linux",
                all(target_os = "macos", not(feature = "keychain"))
            ))]
            storage::init_file_store(app.path().app_data_dir()?);

            storage::init_keyring();

            let mut device = match DeviceStorage::load() {
                Ok(Some(d)) => d,
                Ok(None) => {
                    let d = grindr::DeviceInfo::generate();
                    if let Err(e) = DeviceStorage::save(&d) {
                        tracing::error!("[setup] could not persist device info: {e}");
                    }
                    d
                }
                Err(e) => {
                    tracing::warn!("[setup] could not load device info, regenerating: {e}");
                    grindr::DeviceInfo::generate()
                }
            };

			if let Err(error) = api::identity::align_device(&mut device) {
				tracing::warn!(target: "open_grind_lib::api::identity", "[api-identity] physical field alignment failed: {error}");
			} else if let Err(error) = DeviceStorage::save(&device) {
				tracing::error!(target: "open_grind_lib::api::identity", "[api-identity] aligned identity persist failed: {error}");
			} else {
				tracing::info!(
					target: "open_grind_lib::api::identity",
					"[api-identity] physical fields aligned"
				);
			}

            let session = match AuthStorage::get_session() {
                Ok(s) => s,
                Err(e) => {
                    tracing::warn!("[setup] could not load session: {e}");
                    None
                }
            };

            let candidate =
                grindr::GrindrClient::new(device, session).expect("failed to build GrindrClient");
            let runtime = api::runtime::ApiRuntime::install(candidate);
			let mitigation_handle = app.handle().clone();
			runtime.set_event_sink(std::sync::Arc::new(
				move |event: &api::runtime::ApiMitigationEvent| {
					if let Err(error) =
						mitigation_handle.emit("api:runtime-status", event)
					{
						tracing::warn!(error = %error, "[api-mitigation] frontend_event_failed");
					}
				},
			));
            let client = runtime.client().clone();
			api::ws::install_realtime_controller(client.clone());
			tracing::info!(target: "open_grind_lib::api::runtime", runtime_id = runtime.id(), "[api-runtime] initialized");

            {
                let mut session_rx = client.session_receiver();
                tauri::async_runtime::spawn(async move {
                    while session_rx.changed().await.is_ok() {
                        let _storage_guard = account_storage_lock().lock().await;
                        match session_rx.borrow().as_ref() {
                            Some(s) => {
                                if let Err(e) = AuthStorage::set_session(s) {
                                    tracing::error!("[session] persist failed: {e}");
                                }
                            }
                            None => AuthStorage::delete_session(),
                        }
                    }
                });
            }

            {
                let saved_key = SigningKeyStorage::load().unwrap_or(None);
                let client = client.clone();
                let mut key_rx = client.signing_key_receiver();
                tauri::async_runtime::spawn(async move {
                    if let Some(k) = saved_key {
                        client.restore_signing_key(k).await;
                    }
                    while key_rx.changed().await.is_ok() {
                        let _storage_guard = account_storage_lock().lock().await;
                        match key_rx.borrow().clone() {
                            Some(k) => {
                                if let Err(e) = SigningKeyStorage::save(&k) {
                                    tracing::error!("[signing] persist failed: {e}");
                                }
                            }
                            None => SigningKeyStorage::delete(),
                        }
                    }
                });
            }

            api::ws::spawn_ws_task(app.handle().clone());

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
	use super::*;

	fn allows(url: &str) -> bool {
		is_app_url(&tauri::Url::parse(url).unwrap())
	}

	#[test]
	fn admits_the_bundled_asset_origins() {
		assert!(allows("tauri://localhost/"));
		assert!(allows("tauri://localhost/chat/1"));
		assert!(allows("http://tauri.localhost/"));
		assert!(allows("https://tauri.localhost/"));
	}

	#[test]
	fn refuses_navigation_away_from_the_app() {
		for url in [
			"https://example.org/",
			"tauri://example.org/",
			"http://tauri.localhost.example.org/",
			"file:///etc/passwd",
			"javascript:alert(1)",
			"data:text/html,<script>1</script>",
		] {
			assert!(!allows(url), "{url} must not load in the main webview");
		}
	}
}
