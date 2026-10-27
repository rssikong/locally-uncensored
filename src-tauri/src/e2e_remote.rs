//! Test hook for automated device tests against a real desktop (simulator,
//! emulator). Built only with `--features e2e-remote`, which no default and
//! no release build turns on, and active only when the environment asks for
//! it as well:
//!
//! * `LU_E2E_REMOTE_CODE`: the pairing code, six digits. Without it nothing
//!   here does anything.
//! * `LU_E2E_REMOTE_LINK_FILE`: where the v2 pairing link (`lu://remote?v=2...`)
//!   is written, renewed before its ticket runs out and after every pairing.
//! * `LU_E2E_REMOTE_TUNNEL=1`: also "reach this computer from anywhere": the
//!   window turns the setting on and starts the tunnel the way the real
//!   setting does, and the link carries the tunnel address as soon as it is
//!   up (and a new link when it changes).
//! * `LU_E2E_REMOTE_APPROVALS=ask`: the window sets its tool approvals to ask
//!   before shell commands and file writes, in Agent and in Code
//!   (lib/remote-e2e-approvals.ts), so a test can answer them on the phone.
//!
//! What it does: the window asks `remote_e2e_mode` at start and, when it is
//! on, starts Remote (Wi-Fi only, the tunnel only on request) the usual way. Once the server
//! runs, [`after_start`] turns every global permission on (`create`
//! included), fixes the code to the given one with the panel open, keeps the
//! QR panel and the old way in open, writes the link and answers every
//! pairing request with yes and all device rights.
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use crate::commands::remote_sealed::{DeviceRights, SealedHub};

/// The fixed code, when the environment names a valid one.
pub(crate) fn fixed_code() -> Option<String> {
    static CODE: OnceLock<Option<String>> = OnceLock::new();
    CODE.get_or_init(|| {
        std::env::var("LU_E2E_REMOTE_CODE")
            .ok()
            .map(|c| c.trim().to_string())
            .filter(|c| c.len() == 6 && c.bytes().all(|b| b.is_ascii_digit()))
    })
    .clone()
}

fn link_file() -> Option<std::path::PathBuf> {
    std::env::var_os("LU_E2E_REMOTE_LINK_FILE").filter(|p| !p.is_empty()).map(std::path::PathBuf::from)
}

pub(crate) fn active() -> bool {
    fixed_code().is_some()
}

/// Whether the test also wants the tunnel (`LU_E2E_REMOTE_TUNNEL=1`).
pub(crate) fn tunnel_wanted() -> bool {
    tunnel_wanted_from(std::env::var("LU_E2E_REMOTE_TUNNEL").ok().as_deref())
}

fn tunnel_wanted_from(value: Option<&str>) -> bool {
    value.map(str::trim) == Some("1")
}

/// Whether the test wants the desktop to ask before tools.
fn approvals_ask_from(value: Option<&str>) -> bool {
    value.map(str::trim) == Some("ask")
}

/// Every right a paired device can have.
fn all_rights() -> DeviceRights {
    DeviceRights { chat: true, agent: true, files: true, terminal: true, create: true }
}

/// Whether this build is in test mode. The window starts Remote by itself
/// only on `active: true`, and the tunnel as well on `tunnel: true`.
#[tauri::command]
pub fn remote_e2e_mode() -> serde_json::Value {
    let ask = approvals_ask_from(std::env::var("LU_E2E_REMOTE_APPROVALS").ok().as_deref());
    serde_json::json!({
        "active": active(),
        "tunnel": active() && tunnel_wanted(),
        "approvals": if active() && ask { "ask" } else { "default" },
    })
}

/// Writes the pairing link where the test reads it, replacing the file in
/// one step so a reader never sees half a link.
fn write_link(link: &str) {
    let Some(path) = link_file() else { return };
    let dir = path.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| std::path::PathBuf::from("."));
    let result = (|| -> std::io::Result<()> {
        let mut tmp = tempfile::NamedTempFile::new_in(&dir)?;
        std::io::Write::write_all(&mut tmp, link.as_bytes())?;
        tmp.persist(&path).map_err(|e| e.error)?;
        Ok(())
    })();
    match result {
        Ok(()) => tracing::info!("e2e remote: pairing link written"),
        Err(e) => tracing::warn!(error = %crate::os_error::english(&e), "e2e remote: pairing link not written"),
    }
}

/// The tunnel address while the tunnel runs.
async fn tunnel_now(app: &tauri::AppHandle) -> Option<String> {
    use tauri::Manager;
    let arc = app.try_state::<crate::state::AppState>()?.remote.lock().ok()?.tunnel_url.clone();
    let url = arc.lock().await.clone();
    url
}

fn renew_link(hub: &SealedHub, lan: &Option<String>, tunnel: Option<String>) {
    match hub.e2e_pairing_link(lan.clone(), tunnel) {
        Ok(link) => write_link(&link),
        Err(e) => tracing::warn!(error = %e, "e2e remote: no pairing link"),
    }
}

/// Yes to a pairing request, then all rights for every paired device.
fn accept(hub: &SealedHub, request_id: &str) {
    if let Err(e) = hub.decide(request_id, true) {
        tracing::warn!(error = %e, "e2e remote: pairing not accepted");
        return;
    }
    for d in hub.devices() {
        if d.rights != all_rights() {
            let _ = hub.set_rights(&d.device_id, all_rights());
        }
    }
}

/// Called once the server listens (`start_remote_server`). Does nothing
/// unless [`active`].
pub(crate) async fn after_start(
    app: &tauri::AppHandle,
    permissions: &tokio::sync::Mutex<crate::commands::remote::RemotePermissions>,
    passcode: Arc<tokio::sync::Mutex<crate::commands::remote::PasscodeState>>,
    create: &crate::commands::remote_create::CreateHub,
    port: u16,
) {
    if !active() {
        return;
    }
    {
        let mut p = permissions.lock().await;
        p.filesystem = true;
        p.downloads = true;
        p.process_control = true;
        p.shell = true;
        p.create = true;
    }
    create.set_enabled(true, crate::commands::remote_create::now_secs());
    let hub = match crate::commands::remote_sealed::shared_hub(app).await {
        Ok(h) => h,
        Err(e) => {
            tracing::warn!(error = %e, "e2e remote: no sealed channel");
            return;
        }
    };
    // Every pairing request is answered with yes; after each one the link
    // gets a fresh ticket (a ticket is good for one pairing).
    let lan = crate::commands::lan_address::lan_ip().map(|ip| format!("http://{ip}:{port}"));
    {
        use tauri::Emitter;
        let emitter = app.clone();
        let weak = Arc::downgrade(&hub);
        let lan_for_events = lan.clone();
        hub.set_notifier(Arc::new(move |event: &str, payload: serde_json::Value| {
            let _ = emitter.emit(event, payload.clone());
            let Some(hub) = weak.upgrade() else { return };
            match event {
                "remote-pair-request" => {
                    if let Some(id) = payload.get("requestId").and_then(|v| v.as_str()).map(str::to_string) {
                        // Not inside the hub's own call: it may still hold its locks.
                        tauri::async_runtime::spawn(async move { accept(&hub, &id) });
                    }
                }
                "remote-pair-resolved" => {
                    let lan = lan_for_events.clone();
                    let app = emitter.clone();
                    tauri::async_runtime::spawn(async move {
                        let tunnel = tunnel_now(&app).await;
                        renew_link(&hub, &lan, tunnel)
                    });
                }
                _ => {}
            }
        }));
    }
    hub.set_legacy_access(true);
    hub.set_pairing_window(true);
    {
        let mut pc = passcode.lock().await;
        pc.open_window(crate::commands::remote::chrono_now_secs());
    }
    let mut tunnel = tunnel_now(app).await;
    renew_link(&hub, &lan, tunnel.clone());
    // Keep it all open while this server runs: the code (a closed panel
    // clears it), the QR panel, the old way in, and a link whose ticket has
    // not run out. A restart starts a new keeper, a stop ends it.
    static RUN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let run = RUN.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
    let weak = Arc::downgrade(&hub);
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri::Manager;
        let mut since_link = 0u64;
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            let running = app
                .try_state::<crate::state::AppState>()
                .and_then(|s| s.remote.lock().ok().map(|r| r.handle.is_some()))
                .unwrap_or(false);
            if RUN.load(std::sync::atomic::Ordering::SeqCst) != run {
                return;
            }
            // Starting the tunnel restarts the server for a moment. Skip that
            // moment instead of ending the loop, or the link never gets the
            // tunnel address.
            if !running {
                continue;
            }
            let Some(hub) = weak.upgrade() else { return };
            hub.set_pairing_window(true);
            hub.set_legacy_access(true);
            {
                let mut pc = passcode.lock().await;
                pc.open_window(crate::commands::remote::chrono_now_secs());
            }
            since_link += 5;
            // A tunnel that came up (or got a new address) goes into the link.
            let tunnel_seen = tunnel_now(&app).await;
            if tunnel_seen != tunnel || since_link + 60 >= crate::remote_seal::TICKET_TTL_SECS {
                since_link = 0;
                tunnel = tunnel_seen;
                renew_link(&hub, &lan, tunnel.clone());
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_hook_stays_off_without_a_valid_code() {
        // The test process sets no LU_E2E_REMOTE_CODE.
        if std::env::var_os("LU_E2E_REMOTE_CODE").is_none() {
            assert!(!super::active());
            assert_eq!(super::remote_e2e_mode()["active"], false);
            assert_eq!(super::remote_e2e_mode()["tunnel"], false);
        }
    }

    #[test]
    fn the_desktop_asks_before_tools_only_on_ask() {
        assert!(super::approvals_ask_from(Some("ask")));
        assert!(super::approvals_ask_from(Some(" ask\n")));
        for v in [None, Some(""), Some("1"), Some("allow"), Some("ASK"), Some("asks")] {
            assert!(!super::approvals_ask_from(v), "{v:?}");
        }
        if std::env::var_os("LU_E2E_REMOTE_CODE").is_none() {
            assert_eq!(super::remote_e2e_mode()["approvals"], "default");
        }
    }

    #[test]
    fn the_tunnel_is_wanted_only_on_exactly_one() {
        assert!(super::tunnel_wanted_from(Some("1")));
        assert!(super::tunnel_wanted_from(Some(" 1\n")));
        for v in [None, Some(""), Some("0"), Some("true"), Some("yes"), Some("11")] {
            assert!(!super::tunnel_wanted_from(v), "{v:?}");
        }
    }
}
