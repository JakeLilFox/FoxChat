use tauri::Manager;
mod automation_api;

#[cfg(desktop)]
fn open_notification_room(app: &tauri::AppHandle, room_id: &str) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let room_id = serde_json::to_string(room_id).unwrap_or_else(|_| "\"\"".to_string());
    let script = format!(
        "window.__foxchatPendingNotificationRoom={room_id};\
         window.dispatchEvent(new CustomEvent('foxchat-notification-open',{{detail:{room_id}}}));"
    );
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = window.eval(script);
}

#[tauri::command]
#[cfg(desktop)]
fn show_desktop_notification(
    app: tauri::AppHandle,
    title: String,
    body: String,
    room_id: String,
) -> Result<(), String> {
    if let Ok(path) = std::env::var("FOXCHAT_E2E_NOTIFICATION_FILE") {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        std::fs::write(
            &path,
            serde_json::to_vec_pretty(&serde_json::json!({
                "title": &title,
                "body": &body,
                "room_id": &room_id,
            }))
            .map_err(|error| error.to_string())?,
        )
        .map_err(|error| error.to_string())?;
        if std::env::var("FOXCHAT_E2E_NOTIFICATION_AUTO_OPEN").as_deref() == Ok("1") {
            open_notification_room(&app, &room_id);
        }
        return Ok(());
    }

    let mut notification = notify_rust::Notification::new();
    notification
        .appname("FoxChat")
        .summary(&title)
        .body(&body)
        .action("default", "Open");
    #[cfg(target_os = "windows")]
    notification.app_id(&app.config().identifier);
    let handle = notification.show().map_err(|error| error.to_string())?;
    std::thread::spawn(move || {
        let activated = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let activated_in_handler = activated.clone();
        let _ = handle.wait_for_response(move |response: &notify_rust::NotificationResponse| {
            activated_in_handler.store(
                matches!(
                    response,
                    notify_rust::NotificationResponse::Default
                        | notify_rust::NotificationResponse::Action(_)
                ),
                std::sync::atomic::Ordering::Relaxed,
            );
        });
        if activated.load(std::sync::atomic::Ordering::Relaxed) {
            open_notification_room(&app, &room_id);
        }
    });
    Ok(())
}

fn accounts_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let default_directory = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;

    #[cfg(mobile)]
    return Ok(default_directory.join("FoxChat"));

    #[cfg(desktop)]
    Ok(default_directory
        .parent()
        .unwrap_or(&default_directory)
        .join("FoxChat"))
}

#[cfg(target_os = "linux")]
fn install_linux_microphone_permission_handler<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> tauri::Result<()> {
    window.with_webview(|platform_webview| {
        use gtk::prelude::{DialogExtManual, GtkWindowExt, WidgetExt};
        use std::{cell::Cell, rc::Rc};
        use webkit2gtk::{
            glib::prelude::{Cast, ObjectExt},
            PermissionRequestExt, UserMediaPermissionRequestExt, WebViewExt,
        };

        let webview = platform_webview.inner();
        let parent = webview
            .toplevel()
            .and_then(|widget| widget.downcast::<gtk::Window>().ok());
        let microphone_allowed = Rc::new(Cell::new(false));

        webview.connect_permission_request(move |_, request| {
            if request.is::<webkit2gtk::DeviceInfoPermissionRequest>() {
                if microphone_allowed.get() {
                    request.allow();
                } else {
                    request.deny();
                }
                return true;
            }

            let Some(media_request) =
                request.downcast_ref::<webkit2gtk::UserMediaPermissionRequest>()
            else {
                return false;
            };
            if !media_request.is_for_audio_device() {
                return false;
            }
            if microphone_allowed.get() {
                request.allow();
                return true;
            }

            let dialog = gtk::MessageDialog::new(
                parent.as_ref(),
                gtk::DialogFlags::MODAL | gtk::DialogFlags::DESTROY_WITH_PARENT,
                gtk::MessageType::Question,
                gtk::ButtonsType::YesNo,
                "Allow FoxChat to use your microphone?",
            );
            dialog.set_title("Microphone access");

            let pending_request = request.clone();
            let microphone_allowed = microphone_allowed.clone();
            webkit2gtk::glib::MainContext::default().spawn_local(async move {
                let response = dialog.run_future().await;
                if response == gtk::ResponseType::Yes {
                    microphone_allowed.set(true);
                    pending_request.allow();
                } else {
                    pending_request.deny();
                }
                dialog.close();
            });
            true
        });
    })
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
            #[cfg(desktop)]
            show_desktop_notification,
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
            #[cfg(target_os = "linux")]
            {
                for window in app.webview_windows().values() {
                    install_linux_microphone_permission_handler(window)?;
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running FoxChat");
}
