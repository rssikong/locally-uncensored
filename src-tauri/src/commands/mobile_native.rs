//! Where the app meets the native layer of the phones (plugins/lu-native).
//!
//! The three functions are compiled for Android and iOS only (the file is
//! part of every build so that its one pure helper is tested on the desktop).
//! Three things live here, each used by commands that
//! keep their desktop names:
//!
//!   * `setup`: tell the plugin where models live, and let the engine hear
//!     memory warnings without a webview in between,
//!   * `vault`: the secure storage behind the `secret_*` commands,
//!   * `save_with_picker`: what a "Save As" dialog is on a phone. The content
//!     goes into a temp file of the app and the system's own picker saves it
//!     (the document picker on Android, the Files sheet on iOS).

#[cfg(mobile)]
use std::path::Path;

#[cfg(mobile)]
use tauri::AppHandle;
#[cfg(mobile)]
use tauri_plugin_lu_native::{events, temp, LuNative, LuNativeExt};

/// Runs once in the app's setup, after the plugin is registered.
#[cfg(mobile)]
pub fn setup(app: &AppHandle) {
    let native = app.lu_native();
    if let Ok(dir) = crate::commands::engine::builtin_models_dir() {
        native.set_models_dir(dir);
    }
    let handle = app.clone();
    native.on_event(move |event, payload| {
        if event == events::MEMORY_WARNING {
            let level = payload.get("level").and_then(|l| l.as_str()).unwrap_or("critical").to_string();
            crate::commands::engine_inproc::on_memory_warning(&handle, &level);
        }
    });
}

/// One call into the secure storage, off the async runtime: the native side
/// answers from another thread and this one waits for it.
#[cfg(mobile)]
pub async fn vault<T, F>(app: AppHandle, op: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce(&LuNative<tauri::Wry>) -> tauri_plugin_lu_native::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(move || op(app.lu_native()).map_err(String::from))
        .await
        .map_err(|e| e.to_string())?
}

/// The name a saved file gets: the caller's, with the extension the caller
/// names if the name does not end in it already.
#[cfg_attr(not(mobile), allow(dead_code))]
pub(crate) fn file_name_for(default_name: Option<String>, extension: Option<&str>, fallback: &str) -> String {
    let name = default_name.map(|n| n.trim().to_string()).filter(|n| !n.is_empty()).unwrap_or_else(|| fallback.to_string());
    match extension.map(|e| e.trim().trim_start_matches('.')).filter(|e| !e.is_empty()) {
        Some(ext) if !name.to_ascii_lowercase().ends_with(&format!(".{}", ext.to_ascii_lowercase())) => {
            format!("{name}.{ext}")
        }
        _ => name,
    }
}

/// Write a file with `write`, then let the user pick where it is saved.
///
/// `Ok(None)` when the user closed the picker, which is what `None` means for
/// the desktop dialog commands too. Otherwise where the file went (a content
/// address on Android, a file address on iOS) and what `write` returned. The
/// temp file is removed either way.
#[cfg(mobile)]
pub async fn save_with_picker<T, W>(
    app: &AppHandle,
    file_name: &str,
    mime: Option<&str>,
    write: W,
) -> Result<Option<(String, T)>, String>
where
    T: Send + 'static,
    W: FnOnce(&Path) -> Result<T, String> + Send + 'static,
{
    let native = app.lu_native();
    let temp_dir = native.temp_dir().map_err(String::from)?;
    let file = temp::new_temp_path(&temp_dir, file_name)?;
    let target = file.clone();
    let written = tauri::async_runtime::spawn_blocking(move || write(&target))
        .await
        .map_err(|e| e.to_string())?;
    let result = match written {
        Ok(value) => native
            .save_to_files(&file, file_name, mime)
            .await
            .map(|saved| saved.map(|uri| (uri, value)))
            .map_err(String::from),
        Err(e) => Err(e),
    };
    let _ = temp::delete(&temp_dir, &file.to_string_lossy());
    result
}

// ── Remote: the phone talks to a desktop LU ─────────────────────────────

/// Every error of `remote_client_request` starts with this, so the frontend
/// can tell "the request failed" from "this build has no such command".
pub(crate) const REMOTE_ERROR_PREFIX: &str = "remote_client_request: ";

/// `http://192.168.1.20:11435` plus `/remote-api/status?x=1` as one address.
///
/// The base is an origin and nothing else, the path starts with exactly one
/// slash. That keeps a path like `//evil.example/x` or `@evil.example` from
/// moving the request, and its token, to another host. Whether the host may
/// be called at all (private addresses and `*.trycloudflare.com` only) is
/// decided below this, in the plugin.
#[cfg_attr(not(mobile), allow(dead_code))]
pub(crate) fn remote_target(base_url: &str, path: &str) -> Result<String, String> {
    let bad_base = || format!("{REMOTE_ERROR_PREFIX}the address of the desktop is not valid");
    let base = url::Url::parse(base_url.trim()).map_err(|_| bad_base())?;
    let plain_origin = matches!(base.scheme(), "http" | "https")
        && base.host_str().is_some_and(|h| !h.is_empty())
        && base.username().is_empty()
        && base.password().is_none()
        && matches!(base.path(), "" | "/")
        && base.query().is_none()
        && base.fragment().is_none();
    if !plain_origin {
        return Err(bad_base());
    }
    if !path.starts_with('/') || path.starts_with("//") || path.contains('\\') || path.chars().any(|c| c.is_control()) {
        return Err(format!("{REMOTE_ERROR_PREFIX}the path is not valid"));
    }
    let joined = base.join(path).map_err(|_| format!("{REMOTE_ERROR_PREFIX}the path is not valid"))?;
    if joined.origin() != base.origin() {
        return Err(format!("{REMOTE_ERROR_PREFIX}the path is not valid"));
    }
    Ok(joined.to_string())
}

/// Decision E1 (REMOTE-PROTOKOLL v2): over the internet only the sealed
/// channel. The plain transport reaches a tunnel address for one thing, the
/// bare `GET /remote-api/status` without a token, which tells the app
/// whether the desktop speaks the sealed channel (`features`). Everything
/// else to an address outside the Wi-Fi is refused here, before any byte
/// leaves the phone, whatever the webview asks for.
#[cfg_attr(not(mobile), allow(dead_code))]
pub(crate) fn plain_route_allowed(base_url: &str, path: &str, method: Option<&str>, token: Option<&str>) -> Result<(), String> {
    if crate::commands::remote_sealed_phone::is_lan_address(base_url) {
        return Ok(());
    }
    let bare_status = path == "/remote-api/status"
        && method.map(|m| m.trim().eq_ignore_ascii_case("GET")).unwrap_or(true)
        && token.map(str::trim).unwrap_or("").is_empty();
    if bare_status {
        Ok(())
    } else {
        Err(format!("{REMOTE_ERROR_PREFIX}sealed_only: over the internet this desktop is reached through the sealed channel only"))
    }
}

/// The headers of one Remote call: the session token, and the body type.
#[cfg_attr(not(mobile), allow(dead_code))]
pub(crate) fn remote_headers(token: Option<&str>, has_body: bool) -> std::collections::HashMap<String, String> {
    let mut headers = std::collections::HashMap::new();
    if let Some(token) = token.map(str::trim).filter(|t| !t.is_empty()) {
        headers.insert("Authorization".to_string(), format!("Bearer {token}"));
    }
    if has_body {
        headers.insert("Content-Type".to_string(), "application/json".to_string());
    }
    headers
}

/// One round trip to a desktop LU: status, body, and the two protocol
/// headers as `refreshedToken` (x-lu-refreshed-token) and `memoryRevoked`
/// (x-lu-remote-memory-revoked). A status that is not 2xx is an answer, not
/// an error. `callId` makes the call cancellable with `remote_client_cancel`.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_client_request(
    app: AppHandle,
    baseUrl: String,
    path: String,
    method: Option<String>,
    token: Option<String>,
    body: Option<String>,
    timeoutMs: Option<u64>,
    callId: Option<String>,
) -> Result<tauri_plugin_lu_native::remote::RemoteResponse, String> {
    let url = remote_target(&baseUrl, &path)?;
    plain_route_allowed(&baseUrl, &path, method.as_deref(), token.as_deref())?;
    let request = tauri_plugin_lu_native::remote::RemoteRequest {
        method,
        url,
        headers: remote_headers(token.as_deref(), body.is_some()),
        body,
        cancel_id: callId,
        timeout_ms: timeoutMs,
    };
    let answer = app.lu_native().remote_request(request).await.map_err(|e| format!("{REMOTE_ERROR_PREFIX}{e}"))?;
    if answer.cancelled {
        return Err(format!("{REMOTE_ERROR_PREFIX}cancelled"));
    }
    Ok(answer)
}

/// Close the connection of the running `remote_client_request` with this
/// `callId`. True when there was one.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case)]
pub fn remote_client_cancel(app: AppHandle, callId: String) -> bool {
    app.lu_native().remote_cancel(&callId)
}

/// The page of this app in the system settings, where a refused permission
/// (camera, photos, notifications, local network) is switched back on.
#[cfg(mobile)]
#[tauri::command]
pub async fn open_system_settings(app: AppHandle) -> Result<(), String> {
    app.lu_native().open_system_settings().await.map_err(String::from)
}

#[cfg(test)]
mod tests {
    use super::{file_name_for, plain_route_allowed, remote_headers, remote_target};

    #[test]
    fn over_the_internet_the_plain_transport_reaches_the_bare_status_only() {
        let net = "https://calm-river.trycloudflare.com";
        assert!(plain_route_allowed(net, "/remote-api/status", Some("GET"), None).is_ok());
        assert!(plain_route_allowed(net, "/remote-api/status", None, Some("  ")).is_ok());
        for (path, method, token) in [
            ("/remote-api/status", Some("GET"), Some("jwt")),
            ("/remote-api/status", Some("POST"), None),
            ("/remote-api/status?x=1", Some("GET"), None),
            ("/remote-api/status/full", Some("GET"), None),
            ("/remote-api/auth", Some("POST"), None),
            ("/api/chat", Some("POST"), Some("jwt")),
            ("/remote-api/sealed", Some("POST"), None),
        ] {
            let e = plain_route_allowed(net, path, method, token).unwrap_err();
            assert!(e.starts_with("remote_client_request: sealed_only"), "{path}: {e}");
        }
        // A public address is the internet too.
        assert!(plain_route_allowed("http://203.0.113.5:11435", "/api/chat", Some("POST"), Some("jwt")).is_err());
        // In the Wi-Fi the plain way stays for desktops up to 3.0.6.
        assert!(plain_route_allowed("http://192.168.1.20:11435", "/api/chat", Some("POST"), Some("jwt")).is_ok());
        assert!(plain_route_allowed("http://192.168.1.20:11435", "/remote-api/auth", Some("POST"), None).is_ok());
    }

    #[test]
    fn a_remote_call_goes_to_the_desktop_it_names_and_nowhere_else() {
        assert_eq!(
            remote_target("http://192.168.1.20:11435", "/remote-api/status?x=1").unwrap(),
            "http://192.168.1.20:11435/remote-api/status?x=1"
        );
        assert_eq!(remote_target("http://192.168.1.20:11435/", "/api/chat").unwrap(), "http://192.168.1.20:11435/api/chat");
        assert_eq!(
            remote_target("https://calm-river.trycloudflare.com", "/remote-api/auth").unwrap(),
            "https://calm-river.trycloudflare.com/remote-api/auth"
        );
        for (base, path) in [
            ("http://192.168.1.20:11435", "//evil.example/x"),
            ("http://192.168.1.20:11435", "remote-api/status"),
            ("http://192.168.1.20:11435", "@evil.example/x"),
            ("http://192.168.1.20:11435", "/\\evil.example/x"),
            ("http://192.168.1.20:11435", "http://evil.example/x"),
            ("http://192.168.1.20:11435/remote-api", "/status"),
            ("http://192.168.1.20:11435?x=1", "/status"),
            ("http://user:pw@192.168.1.20:11435", "/status"),
            ("ftp://192.168.1.20", "/status"),
            ("192.168.1.20:11435", "/status"),
            ("", "/status"),
        ] {
            let got = remote_target(base, path);
            assert!(got.is_err(), "{base} + {path} gave {got:?}");
            assert!(got.unwrap_err().starts_with("remote_client_request: "));
        }
    }

    #[test]
    fn the_token_travels_as_a_bearer_header_and_only_when_there_is_one() {
        let with = remote_headers(Some(" abc.def "), true);
        assert_eq!(with.get("Authorization").map(String::as_str), Some("Bearer abc.def"));
        assert_eq!(with.get("Content-Type").map(String::as_str), Some("application/json"));
        assert!(remote_headers(None, false).is_empty());
        assert!(remote_headers(Some("  "), false).is_empty());
    }

    #[test]
    fn the_extension_is_added_once() {
        assert_eq!(file_name_for(Some("chat".into()), Some("md"), "export.txt"), "chat.md");
        assert_eq!(file_name_for(Some("chat.md".into()), Some("md"), "export.txt"), "chat.md");
        assert_eq!(file_name_for(Some("chat.MD".into()), Some("md"), "export.txt"), "chat.MD");
        assert_eq!(file_name_for(Some("chat".into()), Some(".json"), "export.txt"), "chat.json");
    }

    #[test]
    fn a_missing_name_gets_the_fallback() {
        assert_eq!(file_name_for(None, None, "export.txt"), "export.txt");
        assert_eq!(file_name_for(Some("   ".into()), Some("txt"), "export.txt"), "export.txt");
        assert_eq!(file_name_for(None, Some("png"), "download.bin"), "download.bin.png");
    }
}
