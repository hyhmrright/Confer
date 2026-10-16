mod message_cache;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(message_cache::CacheDb::default())
        .invoke_handler(tauri::generate_handler![message_cache::message_cache])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
