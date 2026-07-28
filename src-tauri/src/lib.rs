use tauri::Manager;
mod automation_api;

fn accounts_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let default_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    // Android sandboxes each application. Walking to the parent of the app
    // data directory can leave the writable sandbox, which meant the account
    // backup was never created and an updated WebView could lose every login.
    // app_data_dir itself is private, durable across normal app updates, and
    // removed only when the user clears app data or uninstalls the app.
    #[cfg(mobile)]
    return Ok(default_directory.join("FoxChat"));

    #[cfg(desktop)]
    Ok(default_directory
        .parent()
        .unwrap_or(&default_directory)
        .join("FoxChat"))
}

#[tauri::command]
fn save_matrix_accounts(app: tauri::AppHandle, data: String) -> Result<(), String> {
    let directory = accounts_directory(&app)?;
    std::fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    std::fs::write(directory.join("matrix-accounts.json"), data).map_err(|error| error.to_string())
}

#[tauri::command]
fn load_matrix_accounts(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = accounts_directory(&app)?.join("matrix-accounts.json");
    if path.exists() {
        return std::fs::read_to_string(path)
            .map(Some)
            .map_err(|error| error.to_string());
    }
    // Read backups created by the first persistence implementation once;
    // the next session write migrates them into the clean FoxChat folder.
    let app_data_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    for legacy_path in [
        app_data_directory.join("matrix-accounts.json"),
        app_data_directory
            .join("FoxChat")
            .join("matrix-accounts.json"),
    ] {
        if legacy_path.exists() {
            return std::fs::read_to_string(legacy_path)
                .map(Some)
                .map_err(|error| error.to_string());
        }
    }
    Ok(None)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(automation_api::AutomationApiState::default())
        .plugin(tauri_plugin_remote_push::init())
        .plugin(tauri_plugin_notification::init());
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build());
    builder
        .invoke_handler(tauri::generate_handler![
            save_matrix_accounts,
            load_matrix_accounts,
            automation_api::start_automation_api,
            automation_api::stop_automation_api,
            automation_api::automation_api_status,
            automation_api::publish_automation_event,
            automation_api::respond_automation_api
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                if let Some(icon) = app.default_window_icon() {
                    for window in app.webview_windows().values() {
                        let _ = window.set_icon(icon.clone());
                    }
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running FoxChat");
}
