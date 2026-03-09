//! Spawn and manage the Node server subprocess; provide WS URL to the frontend.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

fn env_or_legacy(primary: &str, legacy: &str) -> Option<String> {
    std::env::var(primary).ok().or_else(|| std::env::var(legacy).ok())
}

/// Start the backend server subprocess and set the WebSocket URL in app state.
/// In dev, AGENTZ_DESKTOP_WS_URL (or T3CODE_DESKTOP_WS_URL) may already be set by dev-runner; then we don't spawn.
pub fn start_backend(app: &AppHandle) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    if let Some(ws_url) = env_or_legacy("AGENTZ_DESKTOP_WS_URL", "T3CODE_DESKTOP_WS_URL") {
        // Dev: server is started by dev-runner; URL is already in env.
        app.manage(crate::commands::WsUrlState(Mutex::new(Some(ws_url))));
        return Ok(());
    }

    // Production: reserve port, generate token, spawn server, store URL
    let port = reserve_port()?;
    let token = generate_auth_token();
    let ws_url = format!("ws://127.0.0.1:{}/?token={}", port, token);

    let state_dir = env_or_legacy("AGENTZ_STATE_DIR", "T3CODE_STATE_DIR").unwrap_or_else(|| {
        dirs::home_dir()
            .map(|p| p.join(".agentz").join("userdata").display().to_string())
            .unwrap_or_else(|| "/tmp/agentz".to_string())
    });

    let (server_entry, cwd) = find_server_entry_and_cwd(app)?;

    let node = get_node_or_bun();
    let child = Command::new(&node)
        .arg(&server_entry)
        .current_dir(&cwd)
        .env("AGENTZ_MODE", "desktop")
        .env("T3CODE_MODE", "desktop")
        .env("AGENTZ_NO_BROWSER", "1")
        .env("T3CODE_NO_BROWSER", "1")
        .env("AGENTZ_PORT", port.to_string())
        .env("T3CODE_PORT", port.to_string())
        .env("AGENTZ_STATE_DIR", &state_dir)
        .env("T3CODE_STATE_DIR", &state_dir)
        .env("AGENTZ_AUTH_TOKEN", &token)
        .env("T3CODE_AUTH_TOKEN", &token)
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()?;

    app.manage(BackendChild(Mutex::new(Some(child))));
    app.manage(crate::commands::WsUrlState(Mutex::new(Some(ws_url))));
    Ok(())
}

pub fn stop_backend(app: &AppHandle) {
    if let Some(child) = app.try_state::<BackendChild>() {
        if let Ok(mut guard) = child.0.lock() {
            if let Some(mut c) = guard.take() {
                let _ = c.kill();
            }
        }
    }
}

fn reserve_port() -> Result<u16, Box<dyn std::error::Error + Send + Sync>> {
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn generate_auth_token() -> String {
    use rand::Rng;
    let mut bytes = [0u8; 24];
    rand::thread_rng().fill(&mut bytes[..]);
    hex::encode(bytes)
}

fn get_node_or_bun() -> String {
    env_or_legacy("AGENTZ_DESKTOP_NODE", "T3CODE_DESKTOP_NODE").unwrap_or_else(|| {
        if which::which("bun").is_ok() {
            "bun".to_string()
        } else {
            "node".to_string()
        }
    })
}

fn find_server_entry_and_cwd(
    app: &AppHandle,
) -> Result<(std::path::PathBuf, std::path::PathBuf), Box<dyn std::error::Error + Send + Sync>> {
    // Bundled: resources dir may contain server (staged by build script)
    if let Ok(resource_dir) = app.path().resource_dir() {
        let candidate = resource_dir.join("apps").join("server").join("dist").join("index.mjs");
        if candidate.exists() {
            let cwd = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
            return Ok((candidate, cwd));
        }
    }

    // Dev / monorepo: walk up from exe (e.g. .../apps/desktop/src-tauri/target/debug/agentz) to find apps/server/dist
    let exe = std::env::current_exe()?;
    let mut dir = exe.parent();
    while let Some(d) = dir {
        let server_dist = d.join("server").join("dist").join("index.mjs");
        if server_dist.exists() {
            return Ok((server_dist, d.to_path_buf()));
        }
        let apps_server = d.join("apps").join("server").join("dist").join("index.mjs");
        if apps_server.exists() {
            return Ok((apps_server, d.to_path_buf()));
        }
        dir = d.parent();
    }

    Err("server entry index.mjs not found".into())
}

pub struct BackendChild(pub Mutex<Option<Child>>);
