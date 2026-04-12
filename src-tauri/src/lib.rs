mod api;
mod storage;

use api::client::GrindrClient;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    storage::init_keyring();

    let client = GrindrClient::new().expect("failed to create API client");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(client)
        .invoke_handler(tauri::generate_handler![
            api::auth::login,
            api::auth::refresh_token,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
