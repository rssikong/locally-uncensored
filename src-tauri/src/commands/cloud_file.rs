//! Saving a file of the signed-in account from the hosted service to a place
//! the user picks.
//!
//! The service answers a request for such a file with a redirect to a
//! short-lived address of its storage. A WebView cannot follow that: it may
//! not read where a redirect leads, and it has no way to write a file of a
//! few hundred megabytes to a path. So the request is made here, the body is
//! streamed to disk as it arrives and never held in memory.
//!
//! The session token belongs to the service and to nobody else. The redirect
//! is therefore followed by hand: the first request carries the token and
//! follows nothing, the second goes to the address the service named and
//! carries no token.
//!
//! A download can be cancelled by the id it was started with. That drops the
//! connection, so the bytes stop coming, and removes what was written so far.

use crate::commands::download::download_client;
use crate::commands::proxy::validate_public_url;
use crate::os_error;
use futures_util::StreamExt;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Emitter;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

/// The event the window hears while a file comes in.
pub const PROGRESS_EVENT: &str = "cloud-file-progress";
const PROGRESS_EVERY: Duration = Duration::from_millis(250);

#[derive(Clone, Serialize)]
struct Progress<'a> {
    id: &'a str,
    received: u64,
    /// 0 when the storage states no size.
    total: u64,
}

/// How a download ended, short of a failure of the network or the disk.
#[derive(Debug, PartialEq)]
pub(crate) enum Outcome {
    Saved { bytes: u64 },
    /// The service said no. The window words it, it knows what was asked for.
    Refused { status: u16 },
    /// The user cancelled it. Nothing of the file is left on the disk.
    Cancelled,
}

/// How the writing of the body ended.
enum Written {
    All(u64),
    Cancelled,
}

/// The first request carries the session token, so it only goes where a token
/// may go: an encrypted address, or this machine (a developer's own server).
pub(crate) fn token_may_go_to(raw: &str) -> Result<reqwest::Url, String> {
    let url = reqwest::Url::parse(raw).map_err(|_| "The download address is not valid.".to_string())?;
    let host = url.host_str().unwrap_or("");
    let this_machine = matches!(host, "localhost" | "127.0.0.1" | "[::1]");
    match url.scheme() {
        "https" => Ok(url),
        "http" if this_machine => Ok(url),
        _ => Err("The download address is not valid.".to_string()),
    }
}

/// The file the bytes go to until all of them are there.
fn part_path(dest: &Path) -> PathBuf {
    let mut name = dest.file_name().map(|n| n.to_os_string()).unwrap_or_default();
    name.push(".part");
    dest.with_file_name(name)
}

/// Asks `url` for the file with the token, follows the one redirect of the
/// service without it, and streams the body to `dest`. `storage_ok` decides
/// whether the address the service named may be fetched.
///
/// `cancel` ends it at any point: before the first request, while a server is
/// asked, and between two pieces of the body. The connection is dropped with
/// the request, and the part file is removed.
pub(crate) async fn fetch_to_file(
    url: &str,
    token: &str,
    dest: &Path,
    storage_ok: fn(&str) -> Result<(), String>,
    cancel: &CancellationToken,
    mut on_progress: impl FnMut(u64, u64),
) -> Result<Outcome, String> {
    let first_url = token_may_go_to(url)?;
    // Checked first, so a download cancelled before it began asks nobody. The
    // races below would only usually pick the cancelled branch.
    if cancel.is_cancelled() {
        return Ok(Outcome::Cancelled);
    }
    let asking = reqwest::Client::builder()
        .user_agent(crate::app_identity::outgoing_agent!("1.5"))
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| os_error::english(&e))?;
    let first = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Ok(Outcome::Cancelled),
        answer = asking.get(first_url.clone()).bearer_auth(token).send() => answer,
    }
    .map_err(|e| format!("The download could not start: {}", os_error::english(&e)))?;

    let response = if first.status().is_redirection() {
        let location = first
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|v| v.to_str().ok())
            .ok_or_else(|| "The download could not start: the server named no file address.".to_string())?;
        let target = first_url
            .join(location)
            .map_err(|_| "The download could not start: the server named an address that is not valid.".to_string())?;
        storage_ok(target.as_str())?;
        // No token from here on. Further redirects are checked hop by hop.
        let storage = download_client(15, 60)?;
        tokio::select! {
            biased;
            _ = cancel.cancelled() => return Ok(Outcome::Cancelled),
            answer = storage.get(target).send() => answer,
        }
        .map_err(|e| format!("The download could not start: {}", os_error::english(&e)))?
    } else {
        first
    };

    let status = response.status();
    if !status.is_success() {
        return Ok(Outcome::Refused { status: status.as_u16() });
    }
    let total = response.content_length().unwrap_or(0);
    let part = part_path(dest);
    let written = write_stream(response, &part, total, cancel, &mut on_progress).await;
    let bytes = match written {
        Ok(Written::All(bytes)) => bytes,
        Ok(Written::Cancelled) => {
            return match tokio::fs::remove_file(&part).await {
                Ok(()) => Ok(Outcome::Cancelled),
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Outcome::Cancelled),
                Err(e) => Err(format!(
                    "The download was cancelled, but the unfinished file {} could not be removed: {}",
                    part.display(),
                    os_error::english(&e)
                )),
            };
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(e);
        }
    };
    if let Err(e) = tokio::fs::rename(&part, dest).await {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(format!("The file could not be saved: {}", os_error::english(&e)));
    }
    Ok(Outcome::Saved { bytes })
}

/// Writes the body to `part`. The file is closed when this returns, whatever
/// the outcome, so the caller can rename or remove it on every system.
async fn write_stream(
    response: reqwest::Response,
    part: &Path,
    total: u64,
    cancel: &CancellationToken,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<Written, String> {
    let mut file = tokio::fs::File::create(part)
        .await
        .map_err(|e| format!("The file could not be saved: {}", os_error::english(&e)))?;
    let pumped = pump_body(response, &mut file, total, cancel, on_progress).await;
    // A write may still be on its way to the disk and would hold the file
    // open. Waiting for it here is what lets the file be removed afterwards.
    let flushed = file.flush().await;
    drop(file);
    let received = match pumped? {
        Written::All(received) => received,
        Written::Cancelled => return Ok(Written::Cancelled),
    };
    flushed.map_err(|e| format!("The file could not be saved: {}", os_error::english(&e)))?;
    // A connection that closes early ends the stream without an error.
    if total > 0 && received != total {
        return Err("The download broke off before the file was complete. Try again.".to_string());
    }
    on_progress(received, total);
    Ok(Written::All(received))
}

async fn pump_body(
    response: reqwest::Response,
    file: &mut tokio::fs::File,
    total: u64,
    cancel: &CancellationToken,
    on_progress: &mut impl FnMut(u64, u64),
) -> Result<Written, String> {
    let mut stream = response.bytes_stream();
    let mut received: u64 = 0;
    let mut last = Instant::now();
    on_progress(0, total);
    loop {
        // Returning drops the stream, and with it the connection: the storage
        // stops sending. Cancel is looked at first, so a piece that arrives at
        // the same moment is not written any more.
        let piece = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Ok(Written::Cancelled),
            piece = stream.next() => piece,
        };
        let Some(chunk) = piece else { break };
        let bytes = chunk.map_err(|e| format!("The download broke off: {}", os_error::english(&e)))?;
        file.write_all(&bytes)
            .await
            .map_err(|e| format!("The file could not be saved: {}", os_error::english(&e)))?;
        received += bytes.len() as u64;
        if last.elapsed() >= PROGRESS_EVERY {
            last = Instant::now();
            on_progress(received, total);
        }
    }
    Ok(Written::All(received))
}

/// Asks where to save, then fetches `url` with the session token to that
/// place. `id` names the download in the progress events.
///
/// Answers `{status: "cancelled"}` when the dialog was closed,
/// `{status: "saved", path, bytes}`, `{status: "refused", code}` with the
/// HTTP status the service answered, or `{status: "stopped"}` when
/// `cancel_cloud_file` ended it. A failure of the network or the disk is an
/// error in English.
#[tauri::command]
#[allow(non_snake_case, clippy::too_many_arguments)]
pub async fn save_cloud_file_dialog(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    id: String,
    url: String,
    authToken: String,
    defaultName: String,
    extension: String,
    extLabel: String,
) -> Result<serde_json::Value, String> {
    token_may_go_to(&url)?;
    let Some(handle) = rfd::AsyncFileDialog::new()
        .set_file_name(&defaultName)
        .add_filter(&extLabel, &[extension.as_str()])
        .save_file()
        .await
    else {
        return Ok(serde_json::json!({ "status": "cancelled" }));
    };
    let dest = handle.path().to_path_buf();
    // Held until the answer is out, so the id can be cancelled for exactly as
    // long as there is something to cancel.
    let (cancel, _registered) = state.cloud_file_tokens.register(id.clone());
    // The place is picked and the download begins: the window hears it before
    // the first byte, and can offer to cancel from here on.
    let _ = app.emit(PROGRESS_EVENT, Progress { id: &id, received: 0, total: 0 });
    let outcome = fetch_to_file(&url, &authToken, &dest, validate_public_url, &cancel, |received, total| {
        let _ = app.emit(PROGRESS_EVENT, Progress { id: &id, received, total });
    })
    .await?;
    Ok(match outcome {
        Outcome::Saved { bytes } => serde_json::json!({
            "status": "saved",
            "path": dest.to_string_lossy(),
            "bytes": bytes,
        }),
        Outcome::Refused { status } => serde_json::json!({ "status": "refused", "code": status }),
        Outcome::Cancelled => serde_json::json!({ "status": "stopped" }),
    })
}

/// Ends the download that was started under `id`. Its command answers
/// `{status: "stopped"}` once the connection is dropped and the part file is
/// gone. An id that is not running is no error.
#[tauri::command]
pub fn cancel_cloud_file(state: tauri::State<'_, crate::state::AppState>, id: String) -> Result<(), String> {
    state.cloud_file_tokens.cancel(&id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::os_paths::test_dir;
    use axum::extract::State;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::response::IntoResponse;
    use axum::routing::get;
    use std::sync::{Arc, Mutex};

    #[test]
    fn the_token_only_goes_to_an_encrypted_address_or_this_machine() {
        assert!(token_may_go_to("https://example.com/api/loras/1/file").is_ok());
        assert!(token_may_go_to("http://localhost:3000/api/loras/1/file").is_ok());
        assert!(token_may_go_to("http://127.0.0.1:3000/x").is_ok());
        assert!(token_may_go_to("http://example.com/api/loras/1/file").is_err());
        assert!(token_may_go_to("file:///etc/passwd").is_err());
        assert!(token_may_go_to("not an address").is_err());
    }

    #[test]
    fn the_part_file_stands_next_to_the_file_and_keeps_its_name() {
        assert_eq!(part_path(Path::new("/a/b/anna.safetensors")), Path::new("/a/b/anna.safetensors.part"));
    }

    /// What the two servers saw: the Authorization header of each request.
    #[derive(Clone, Default)]
    struct Seen {
        service: Arc<Mutex<Vec<Option<String>>>>,
        storage: Arc<Mutex<Vec<Option<String>>>>,
    }

    fn auth_of(headers: &HeaderMap) -> Option<String> {
        headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).map(str::to_string)
    }

    async fn serve(router: axum::Router) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        format!("http://127.0.0.1:{}", addr.port())
    }

    const BODY_LEN: usize = 3 * 1024 * 1024 + 17;

    /// A storage that hands out the file, and a service that redirects to it.
    async fn two_servers(seen: Seen, storage_route: axum::routing::MethodRouter<Seen>) -> String {
        let storage = serve(axum::Router::new().route("/object/file", storage_route).with_state(seen.clone())).await;
        let target = format!("{}/object/file?token=signed", storage);
        let service = axum::Router::new()
            .route(
                "/api/loras/one/file",
                get(move |State(seen): State<Seen>, headers: HeaderMap| {
                    let target = target.clone();
                    async move {
                        seen.service.lock().unwrap().push(auth_of(&headers));
                        (StatusCode::FOUND, [(header::LOCATION, target)]).into_response()
                    }
                }),
            )
            .route(
                "/api/loras/gone/file",
                get(|| async { (StatusCode::NOT_FOUND, "{\"error\":\"not found\"}").into_response() }),
            )
            .with_state(seen);
        serve(service).await
    }

    fn any_storage(_: &str) -> Result<(), String> {
        Ok(())
    }

    #[tokio::test]
    async fn the_file_is_streamed_to_disk_and_the_token_stays_with_the_service() {
        let seen = Seen::default();
        let service = two_servers(
            seen.clone(),
            get(|State(seen): State<Seen>, headers: HeaderMap| async move {
                seen.storage.lock().unwrap().push(auth_of(&headers));
                vec![7u8; BODY_LEN]
            }),
        )
        .await;
        let dir = test_dir("cloud-file-saved");
        let dest = dir.join("anna.safetensors");
        let mut ticks: Vec<(u64, u64)> = Vec::new();
        let outcome = fetch_to_file(
            &format!("{}/api/loras/one/file", service),
            "session-token",
            &dest,
            any_storage,
            &CancellationToken::new(),
            |received, total| ticks.push((received, total)),
        )
        .await
        .unwrap();

        assert_eq!(outcome, Outcome::Saved { bytes: BODY_LEN as u64 });
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), BODY_LEN as u64);
        assert!(std::fs::read(&dest).unwrap().iter().all(|b| *b == 7));
        assert!(!part_path(&dest).exists());
        // The service got the token, the storage did not.
        assert_eq!(*seen.service.lock().unwrap(), vec![Some("Bearer session-token".to_string())]);
        assert_eq!(*seen.storage.lock().unwrap(), vec![None]);
        assert_eq!(ticks.first(), Some(&(0, BODY_LEN as u64)));
        assert_eq!(ticks.last(), Some(&(BODY_LEN as u64, BODY_LEN as u64)));
    }

    #[tokio::test]
    async fn a_refusal_of_the_service_writes_nothing() {
        let service = two_servers(Seen::default(), get(|| async { "unused" })).await;
        let dir = test_dir("cloud-file-refused");
        let dest = dir.join("anna.safetensors");
        let outcome = fetch_to_file(&format!("{}/api/loras/gone/file", service), "t", &dest, any_storage, &CancellationToken::new(), |_, _| {})
            .await
            .unwrap();
        assert_eq!(outcome, Outcome::Refused { status: 404 });
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists());
    }

    #[tokio::test]
    async fn a_storage_that_refuses_is_a_refusal_too() {
        let service = two_servers(Seen::default(), get(|| async { (StatusCode::BAD_REQUEST, "expired").into_response() })).await;
        let dir = test_dir("cloud-file-expired");
        let dest = dir.join("anna.safetensors");
        let outcome = fetch_to_file(&format!("{}/api/loras/one/file", service), "t", &dest, any_storage, &CancellationToken::new(), |_, _| {})
            .await
            .unwrap();
        assert_eq!(outcome, Outcome::Refused { status: 400 });
        assert!(!dest.exists());
    }

    #[tokio::test]
    async fn an_address_the_gate_refuses_is_never_fetched() {
        let seen = Seen::default();
        let service = two_servers(
            seen.clone(),
            get(|State(seen): State<Seen>, headers: HeaderMap| async move {
                seen.storage.lock().unwrap().push(auth_of(&headers));
                "never"
            }),
        )
        .await;
        let dir = test_dir("cloud-file-gate");
        let dest = dir.join("anna.safetensors");
        // The real gate: the storage of this test is on this machine, which
        // is exactly what a redirect must not reach.
        let err = fetch_to_file(&format!("{}/api/loras/one/file", service), "t", &dest, validate_public_url, &CancellationToken::new(), |_, _| {})
            .await
            .unwrap_err();
        assert!(err.starts_with("Blocked"), "{err}");
        assert!(seen.storage.lock().unwrap().is_empty());
        assert!(!dest.exists());
    }

    #[tokio::test]
    async fn a_file_that_ends_early_is_an_error_and_leaves_no_half_file() {
        // States more bytes than it sends, then closes.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            loop {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut buf = [0u8; 2048];
                let _ = socket.read(&mut buf).await;
                let _ = socket
                    .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 1000\r\nconnection: close\r\n\r\nonly a part")
                    .await;
                let _ = socket.shutdown().await;
            }
        });
        let dir = test_dir("cloud-file-early");
        let dest = dir.join("anna.safetensors");
        let err = fetch_to_file(&format!("http://127.0.0.1:{}/file", port), "t", &dest, any_storage, &CancellationToken::new(), |_, _| {})
            .await
            .unwrap_err();
        assert!(err.starts_with("The download broke off"), "{err}");
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists());
    }

    /// A storage that states a large file and sends it slowly, piece by
    /// piece, for as long as somebody reads. Answers how many bytes it sent
    /// before the other side was gone, or None if it sent all of them.
    async fn slow_storage(len: usize) -> (String, tokio::task::JoinHandle<Option<usize>>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://127.0.0.1:{}/file", listener.local_addr().unwrap().port());
        let task = tokio::spawn(async move {
            use tokio::io::AsyncReadExt;
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = [0u8; 2048];
            let _ = socket.read(&mut buf).await;
            let head = format!("HTTP/1.1 200 OK\r\ncontent-length: {len}\r\nconnection: close\r\n\r\n");
            socket.write_all(head.as_bytes()).await.ok()?;
            let piece = [7u8; 8 * 1024];
            let mut sent = 0usize;
            while sent < len {
                if socket.write_all(&piece).await.is_err() {
                    return Some(sent);
                }
                sent += piece.len();
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            None
        });
        (url, task)
    }

    #[tokio::test]
    async fn a_cancelled_download_drops_the_connection_and_leaves_no_file() {
        // Two gigabytes at this pace would take twenty minutes.
        let (url, storage) = slow_storage(2_000_000_000).await;
        let dir = test_dir("cloud-file-cancelled");
        let dest = dir.join("weights.safetensors");
        let part = part_path(&dest);
        let cancel = CancellationToken::new();
        let mut on_disk_at_cancel = false;
        let outcome = fetch_to_file(&url, "t", &dest, any_storage, &cancel, |received, _| {
            // Cancelled in the middle: bytes have arrived and the part file is there.
            if received > 0 && !cancel.is_cancelled() {
                on_disk_at_cancel = part.exists();
                cancel.cancel();
            }
        })
        .await
        .unwrap();

        assert_eq!(outcome, Outcome::Cancelled);
        assert!(on_disk_at_cancel, "the download was cancelled before it wrote anything");
        assert!(!part.exists(), "the part file is still there");
        assert!(!dest.exists());
        // The storage notices that nobody reads any more, long before the end.
        let sent = tokio::time::timeout(Duration::from_secs(10), storage)
            .await
            .expect("the storage is still sending: the connection was not dropped")
            .unwrap();
        assert!(matches!(sent, Some(n) if n < 100_000_000), "{sent:?}");
    }

    #[tokio::test]
    async fn a_download_cancelled_before_it_began_asks_nobody() {
        let seen = Seen::default();
        let service = two_servers(seen.clone(), get(|| async { "unused" })).await;
        let dir = test_dir("cloud-file-cancelled-early");
        let dest = dir.join("weights.safetensors");
        let cancel = CancellationToken::new();
        cancel.cancel();
        let outcome = fetch_to_file(&format!("{}/api/loras/one/file", service), "t", &dest, any_storage, &cancel, |_, _| {})
            .await
            .unwrap();
        assert_eq!(outcome, Outcome::Cancelled);
        assert!(seen.service.lock().unwrap().is_empty());
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists());
    }

    #[tokio::test]
    async fn cancel_ends_the_wait_for_a_server_that_does_not_answer() {
        // Takes the connection and says nothing.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://127.0.0.1:{}/file", listener.local_addr().unwrap().port());
        tokio::spawn(async move {
            let (socket, _) = listener.accept().await.unwrap();
            tokio::time::sleep(Duration::from_secs(120)).await;
            drop(socket);
        });
        let dir = test_dir("cloud-file-cancelled-silent");
        let dest = dir.join("weights.safetensors");
        let cancel = CancellationToken::new();
        let later = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(200)).await;
            later.cancel();
        });
        let started = Instant::now();
        let outcome = fetch_to_file(&url, "t", &dest, any_storage, &cancel, |_, _| {}).await.unwrap();
        assert_eq!(outcome, Outcome::Cancelled);
        // Far below the 60 s the read would have waited on its own.
        assert!(started.elapsed() < Duration::from_secs(10), "{:?}", started.elapsed());
        assert!(!dest.exists());
        assert!(!part_path(&dest).exists());
    }
}
