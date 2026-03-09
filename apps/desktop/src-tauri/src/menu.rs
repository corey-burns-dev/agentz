//! Application menu (File, Help, etc.) and menu-action dispatch.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::AppHandle;

pub fn build_app_menu<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, Box<dyn std::error::Error + Send + Sync>> {
    let settings = MenuItem::with_id(app, "open-settings", "Settings...", true, Some("CmdOrCtrl+,"))?;
    let check_updates = MenuItem::with_id(app, "check-updates", "Check for Updates...", true, None::<&str>)?;
    let close = PredefinedMenuItem::close_window(app, None)?;

    let file_submenu = Submenu::with_items(
        app,
        "File",
        true,
        &[&settings, &PredefinedMenuItem::separator(app)?, &close],
    )?;

    let help_submenu =
        Submenu::with_items(app, "Help", true, &[&check_updates])?;

    let menu = Menu::with_items(app, &[&file_submenu, &help_submenu])?;
    Ok(menu)
}
