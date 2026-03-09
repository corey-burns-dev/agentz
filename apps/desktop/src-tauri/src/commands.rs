//! Tauri commands implementing the DesktopBridge contract for the webview.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_opener::OpenerExt;

pub struct WsUrlState(pub Mutex<Option<String>>);

#[derive(Clone, Serialize, Deserialize)]
pub struct ContextMenuItem {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub destructive: bool,
}

#[derive(Clone, Serialize, Deserialize, Default)]
pub struct DesktopUpdateState {
    pub enabled: bool,
    pub status: String,
    pub current_version: String,
    pub available_version: Option<String>,
    pub downloaded_version: Option<String>,
    pub download_percent: Option<f64>,
    pub checked_at: Option<String>,
    pub message: Option<String>,
    pub error_context: Option<String>,
    pub can_retry: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DesktopUpdateActionResult {
    pub accepted: bool,
    pub completed: bool,
    pub state: DesktopUpdateState,
}

#[tauri::command]
pub fn get_ws_url(state: State<WsUrlState>) -> Option<String> {
    state.0.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn pick_folder() -> Result<Option<String>, String> {
    let path = rfd::FileDialog::new().pick_folder();
    Ok(path.map(|p| p.display().to_string()))
}

#[tauri::command]
pub async fn confirm(app: AppHandle, message: String) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let msg = message.trim();
    if msg.is_empty() {
        return Ok(false);
    }
    let result = app
        .dialog()
        .message(msg)
        .title("Agentz")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::YesNo)
        .blocking_show();
    Ok(result)
}

#[derive(Deserialize)]
pub struct MenuPosition {
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub async fn show_context_menu(
    app: AppHandle,
    items: Vec<ContextMenuItem>,
    position: Option<MenuPosition>,
) -> Result<Option<String>, String> {
    if items.is_empty() {
        return Ok(None);
    }
    use tauri::menu::{IsMenuItem, Menu, MenuItem};
    let mut menu_items: Vec<MenuItem<tauri::Wry>> = Vec::new();
    for item in &items {
        let label = item.label.clone();
        let item_id = item.id.clone();
        let mi = MenuItem::with_id(&app, item_id, label, true, None::<&str>).map_err(|e| e.to_string())?;
        menu_items.push(mi);
    }
    let refs: Vec<&dyn IsMenuItem<tauri::Wry>> = menu_items.iter().map(|m| m as &dyn IsMenuItem<tauri::Wry>).collect();
    let menu = Menu::with_items(&app, &refs).map_err(|e| e.to_string())?;

    let window = app.get_webview_window("main").ok_or("main window not found")?;

    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    let menu_clone = menu.clone();
    let window_clone = window.clone();
    let _id = app.on_menu_event(move |_app, event: tauri::menu::MenuEvent| {
        let _ = tx.send(Some(event.id().0.clone()));
    });

    if let Some(pos) = position {
        let phys = tauri::PhysicalPosition::new(pos.x, pos.y);
        window_clone
            .popup_menu_at(&menu_clone, phys)
            .map_err(|e: tauri::Error| e.to_string())?;
    } else {
        window_clone.popup_menu(&menu_clone).map_err(|e: tauri::Error| e.to_string())?;
    }

    let selected = rx.recv().ok().flatten();
    Ok(selected)
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<bool, String> {
    if url.is_empty() {
        return Ok(false);
    }
    if !url.starts_with("https://") && !url.starts_with("http://") {
        return Ok(false);
    }
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e: tauri_plugin_opener::Error| e.to_string())?;
    Ok(true)
}

#[tauri::command]
pub fn get_update_state(app: AppHandle) -> DesktopUpdateState {
    let version = app.package_info().version.to_string();
    DesktopUpdateState {
        enabled: false,
        status: "disabled".to_string(),
        current_version: version,
        available_version: None,
        downloaded_version: None,
        download_percent: None,
        checked_at: None,
        message: None,
        error_context: None,
        can_retry: false,
    }
}

#[tauri::command]
pub async fn download_update(app: AppHandle) -> DesktopUpdateActionResult {
    let state = get_update_state(app.clone());
    DesktopUpdateActionResult {
        accepted: false,
        completed: false,
        state,
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle) -> DesktopUpdateActionResult {
    let state = get_update_state(app.clone());
    DesktopUpdateActionResult {
        accepted: false,
        completed: false,
        state,
    }
}
