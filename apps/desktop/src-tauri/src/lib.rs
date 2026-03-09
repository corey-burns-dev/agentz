//! Agentz desktop application — Tauri entry and setup.
//! DesktopBridge commands, backend spawning, and window lifecycle are implemented here.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Emitter;

mod backend;
mod commands;
mod menu;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            commands::get_ws_url,
            commands::pick_folder,
            commands::confirm,
            commands::show_context_menu,
            commands::open_external,
            commands::get_update_state,
            commands::download_update,
            commands::install_update,
        ])
        .setup(|app| {
            backend::start_backend(app.handle()).map_err(|e| e.to_string())?;
            let handle = app.handle().clone();
            let menu = menu::build_app_menu(&handle).map_err(|e| e.to_string())?;
            handle.set_menu(menu).map_err(|e| e.to_string())?;
            handle.on_menu_event(move |app, event| {
                let action = event.id().0.clone();
                let _ = app.emit("menu-action", action);
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                backend::stop_backend(app_handle);
            }
        });
}
