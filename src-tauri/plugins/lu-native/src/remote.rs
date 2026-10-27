//! The Remote transport: a phone talking to a desktop LU.
//!
//! Why this goes through Rust and not through `fetch` in the webview
//! (mobile-docs/REMOTE-PROTOKOLL.md, section 8): the desktop server sends no
//! CORS headers, `http://192.168.x.y` is mixed content for the page, and the
//! app's CSP does not list a LAN address. A socket opened from here knows
//! none of the three.
//!
//! One round trip per call. A status that is not 2xx is an answer and not an
//! error, the client branches on 401, 403, 409 and 429 itself. `Err` means
//! the request never produced an answer.

use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::net::check_remote_url;

/// The server hands out a fresh token in this header when the old one is
/// close to its end. Without it every session dies 60 minutes after pairing.
pub const REFRESH_HEADER: &str = "x-lu-refreshed-token";
/// Set on the 409 a desktop answers with after its memory was changed.
pub const MEMORY_REVOKED_HEADER: &str = "x-lu-remote-memory-revoked";

/// A chat may take the desktop up to 600 s, the client waits 660 s.
const DEFAULT_TIMEOUT_MS: u64 = 20_000;
const MAX_TIMEOUT_MS: u64 = 900_000;
/// The largest body the desktop accepts is 100 MB, an answer is far smaller.
const MAX_RESPONSE_BYTES: usize = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRequest {
    pub method: Option<String>,
    pub url: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub cancel_id: Option<String>,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResponse {
    /// 0 when the call was cancelled before an answer arrived.
    pub status: u16,
    pub body: String,
    pub refreshed_token: Option<String>,
    pub memory_revoked: bool,
    /// The two protocol headers again, under their real names, so a caller
    /// can build a `Response` object without knowing this struct.
    pub headers: HashMap<String, String>,
    pub cancelled: bool,
}

impl RemoteResponse {
    fn cancelled() -> Self {
        Self {
            status: 0,
            body: String::new(),
            refreshed_token: None,
            memory_revoked: false,
            headers: HashMap::new(),
            cancelled: true,
        }
    }
}

/// Running calls by their cancel id, plus the ids that were cancelled before
/// their call registered (Stop pressed while the request was still on its way
/// through the bridge).
#[derive(Default)]
pub struct CancelBook {
    inner: Mutex<CancelInner>,
}

#[derive(Default)]
struct CancelInner {
    running: HashMap<String, CancellationToken>,
    early: HashSet<String>,
}

impl CancelBook {
    pub fn register(&self, id: &str) -> CancellationToken {
        let token = CancellationToken::new();
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if inner.early.remove(id) {
            token.cancel();
        }
        if let Some(old) = inner.running.insert(id.to_string(), token.clone()) {
            old.cancel();
        }
        token
    }

    pub fn finish(&self, id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        inner.running.remove(id);
    }

    /// True when a running call was hit, false when the id was noted for a
    /// call that has not registered yet.
    pub fn cancel(&self, id: &str) -> bool {
        let mut inner = self.inner.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(token) = inner.running.get(id) {
            token.cancel();
            true
        } else {
            // Bounded: an id nobody ever registers must not grow the set
            // forever.
            if inner.early.len() >= 256 {
                inner.early.clear();
            }
            inner.early.insert(id.to_string());
            false
        }
    }
}

/// Headers a caller may not set: they describe the connection, and reqwest
/// owns those.
fn header_allowed(name: &str) -> bool {
    !matches!(
        name.to_ascii_lowercase().as_str(),
        "host" | "content-length" | "connection" | "transfer-encoding" | "user-agent" | "upgrade"
    )
}

pub fn normalize_method(method: Option<&str>) -> Result<reqwest::Method, String> {
    match method.unwrap_or("GET").to_ascii_uppercase().as_str() {
        "GET" => Ok(reqwest::Method::GET),
        "POST" => Ok(reqwest::Method::POST),
        "PUT" => Ok(reqwest::Method::PUT),
        "DELETE" => Ok(reqwest::Method::DELETE),
        "PATCH" => Ok(reqwest::Method::PATCH),
        "HEAD" => Ok(reqwest::Method::HEAD),
        other => Err(format!("The method {other} is not supported.")),
    }
}

/// `LU-Mobile/3.0.5 (Android)`. The desktop shows this in its device list.
pub fn user_agent(app_version: &str) -> String {
    let platform = match std::env::consts::OS {
        "android" => "Android",
        "ios" => "iOS",
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    };
    format!("LU-Mobile/{app_version} ({platform})")
}

/// A transport failure in words. Never contains the address with its query,
/// and never a header: a token must not reach a log through an error text.
fn transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "The desktop did not answer in time.".to_string()
    } else if error.is_connect() {
        "The desktop could not be reached.".to_string()
    } else if error.is_body() || error.is_decode() {
        "The connection dropped while the answer was coming in.".to_string()
    } else {
        "The request to the desktop failed.".to_string()
    }
}

pub async fn request(
    book: &CancelBook,
    user_agent: &str,
    req: RemoteRequest,
) -> Result<RemoteResponse, String> {
    let url = check_remote_url(&req.url)?;
    perform(book, user_agent, url, req).await
}

/// The request itself, below the address gate. Separate so the tests can
/// drive it against a server on loopback, which the gate refuses.
async fn perform(
    book: &CancelBook,
    user_agent: &str,
    url: url::Url,
    req: RemoteRequest,
) -> Result<RemoteResponse, String> {
    let method = normalize_method(req.method.as_deref())?;
    let timeout = Duration::from_millis(req.timeout_ms.unwrap_or(DEFAULT_TIMEOUT_MS).clamp(1_000, MAX_TIMEOUT_MS));

    let client = reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(timeout)
        .connect_timeout(Duration::from_secs(15))
        // A desktop LU answers an unknown path with a 302 to /mobile. Passed
        // on as it is: following it would hide a protocol error, and a
        // redirect is also the one way a private host could send this
        // request, with its token, somewhere else.
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| "The network client could not be set up.".to_string())?;

    let mut builder = client.request(method, url);
    for (name, value) in &req.headers {
        if header_allowed(name) {
            builder = builder.header(name.as_str(), value.as_str());
        }
    }
    if let Some(body) = req.body {
        let has_type = req.headers.keys().any(|k| k.eq_ignore_ascii_case("content-type"));
        if !has_type {
            builder = builder.header("Content-Type", "application/json");
        }
        builder = builder.body(body);
    }

    let token = req.cancel_id.as_deref().map(|id| book.register(id));
    let cancelled = async {
        match &token {
            Some(t) => t.cancelled().await,
            None => std::future::pending::<()>().await,
        }
    };

    let run = async {
        let resp = builder.send().await.map_err(|e| transport_error(&e))?;
        let status = resp.status().as_u16();
        let refreshed_token = resp
            .headers()
            .get(REFRESH_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string)
            .filter(|v| !v.is_empty());
        let revoked_value = resp
            .headers()
            .get(MEMORY_REVOKED_HEADER)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let bytes = read_capped(resp, MAX_RESPONSE_BYTES).await?;
        let mut headers = HashMap::new();
        if let Some(t) = &refreshed_token {
            headers.insert(REFRESH_HEADER.to_string(), t.clone());
        }
        if let Some(v) = &revoked_value {
            headers.insert(MEMORY_REVOKED_HEADER.to_string(), v.clone());
        }
        Ok(RemoteResponse {
            status,
            body: String::from_utf8_lossy(&bytes).into_owned(),
            refreshed_token,
            memory_revoked: revoked_value.is_some(),
            headers,
            cancelled: false,
        })
    };

    // Dropping `run` on cancel closes the socket, also while the desktop is
    // still generating and has not sent a single header yet. That is the state
    // every Stop against a 3.0.5 desktop happens in.
    let result = tokio::select! {
        _ = cancelled => Ok(RemoteResponse::cancelled()),
        r = run => r,
    };
    if let Some(id) = req.cancel_id.as_deref() {
        book.finish(id);
    }
    result
}

const TOO_LARGE: &str = "The answer of the desktop is too large.";

/// The body, read piece by piece, given up the moment it passes `max`.
///
/// A desktop that is broken or hostile can answer without a length and never
/// stop. Read in one go, such an answer filled the memory of the phone until
/// the system ended the app, and the check for the size came after it
/// (review N1). Now nothing beyond `max` plus one piece is ever held.
async fn read_capped(mut resp: reqwest::Response, max: usize) -> Result<Vec<u8>, String> {
    if resp.content_length().map(|n| n > max as u64).unwrap_or(false) {
        return Err(TOO_LARGE.to_string());
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(piece) = resp.chunk().await.map_err(|e| transport_error(&e))? {
        if body.len() + piece.len() > max {
            return Err(TOO_LARGE.to_string());
        }
        body.extend_from_slice(&piece);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn user_agent_names_product_version_and_platform() {
        let ua = user_agent("3.0.5");
        assert!(ua.starts_with("LU-Mobile/3.0.5 ("), "{ua}");
        assert!(ua.ends_with(')'));
    }

    #[test]
    fn connection_headers_are_not_taken_from_the_caller() {
        assert!(header_allowed("Authorization"));
        assert!(header_allowed("Content-Type"));
        for h in ["Host", "content-length", "User-Agent", "Transfer-Encoding"] {
            assert!(!header_allowed(h), "{h}");
        }
    }

    #[test]
    fn unknown_methods_are_refused() {
        assert!(normalize_method(Some("post")).is_ok());
        assert!(normalize_method(None).is_ok());
        assert!(normalize_method(Some("CONNECT")).is_err());
        assert!(normalize_method(Some("TRACE")).is_err());
    }

    #[test]
    fn a_cancel_that_arrives_first_still_cancels() {
        let book = CancelBook::default();
        assert!(!book.cancel("a"));
        let token = book.register("a");
        assert!(token.is_cancelled());
        // Used up: the next call under the same id runs.
        book.finish("a");
        assert!(!book.register("a").is_cancelled());
    }

    #[test]
    fn a_cancel_hits_the_running_call() {
        let book = CancelBook::default();
        let token = book.register("b");
        assert!(book.cancel("b"));
        assert!(token.is_cancelled());
    }

    #[tokio::test]
    async fn a_public_address_never_leaves_the_device() {
        let book = CancelBook::default();
        let r = request(
            &book,
            "LU-Mobile/test",
            RemoteRequest {
                method: None,
                url: "https://example.com/remote-api/status".into(),
                headers: HashMap::new(),
                body: None,
                cancel_id: None,
                timeout_ms: None,
            },
        )
        .await;
        assert!(r.unwrap_err().contains("own network"));
    }

    fn req(url: String, cancel_id: Option<&str>) -> RemoteRequest {
        let mut headers = HashMap::new();
        headers.insert("Authorization".to_string(), "Bearer old.jwt.token".to_string());
        headers.insert("User-Agent".to_string(), "spoofed".to_string());
        RemoteRequest {
            method: Some("POST".into()),
            url,
            headers,
            body: Some("{\"x\":1}".into()),
            cancel_id: cancel_id.map(str::to_string),
            timeout_ms: Some(5_000),
        }
    }

    /// One connection, one canned answer. Returns what the client sent.
    async fn serve_once(answer: String, delay_ms: u64) -> (u16, tokio::task::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let n = sock.read(&mut buf).await.unwrap();
            let head = String::from_utf8_lossy(&buf[..n]).to_string();
            tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            let _ = sock.write_all(answer.as_bytes()).await;
            head
        });
        (port, handle)
    }

    /// N1: an answer without a length that never ends. The read stops at
    /// the limit instead of holding everything the server cares to send.
    #[tokio::test]
    async fn an_endless_answer_without_a_length_is_given_up_at_the_limit() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let sent = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counter = sent.clone();
        let server = tokio::spawn(async move {
            let (mut sock, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 8192];
            let _ = sock.read(&mut buf).await.unwrap();
            // No Content-Length, the body ends when the connection does.
            sock.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n").await.unwrap();
            let block = vec![b'x'; 16 * 1024];
            // Far more than the limit of the test; stops when the client hangs up.
            for _ in 0..4096 {
                if sock.write_all(&block).await.is_err() {
                    break;
                }
                counter.fetch_add(block.len(), std::sync::atomic::Ordering::Relaxed);
            }
        });
        let resp = reqwest::Client::new().get(format!("http://127.0.0.1:{port}/x")).send().await.unwrap();
        assert_eq!(resp.content_length(), None);
        let limit = 256 * 1024;
        let e = read_capped(resp, limit).await.unwrap_err();
        assert_eq!(e, TOO_LARGE);
        let _ = server.await;
        // The server could not push its 64 MB: the client hung up near the limit.
        let pushed = sent.load(std::sync::atomic::Ordering::Relaxed);
        assert!(pushed < 16 * 1024 * 4096, "the client stopped reading, {pushed} bytes were taken");
    }

    #[tokio::test]
    async fn a_declared_length_over_the_limit_is_refused_before_reading_and_a_small_answer_passes() {
        let answer = "HTTP/1.1 200 OK\r\nContent-Length: 5000\r\nConnection: close\r\n\r\n".to_string() + &"y".repeat(5000);
        let (port, _server) = serve_once(answer.clone(), 0).await;
        let resp = reqwest::Client::new().get(format!("http://127.0.0.1:{port}/x")).send().await.unwrap();
        assert_eq!(read_capped(resp, 4999).await.unwrap_err(), TOO_LARGE);

        let (port, _server) = serve_once(answer, 0).await;
        let resp = reqwest::Client::new().get(format!("http://127.0.0.1:{port}/x")).send().await.unwrap();
        assert_eq!(read_capped(resp, 5000).await.unwrap().len(), 5000);
    }

    // The gate refuses loopback, and a test machine has nothing else. These
    // tests therefore enter below the gate (`perform`); the gate has its own
    // tests in net.rs and one above.
    #[tokio::test]
    async fn both_protocol_headers_come_back_with_a_status_that_is_not_an_error() {
        let body = "Remote memory context was revoked.";
        let answer = format!(
            "HTTP/1.1 409 Conflict\r\nx-lu-refreshed-token: new.jwt.token\r\nx-lu-remote-memory-revoked: 1\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let (port, server) = serve_once(answer, 0).await;
        let book = CancelBook::default();
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/api/chat")).unwrap();
        let r = perform(&book, &user_agent("3.0.5"), url.clone(), req(url.to_string(), None)).await.unwrap();
        assert_eq!(r.status, 409);
        assert_eq!(r.body, body);
        assert_eq!(r.refreshed_token.as_deref(), Some("new.jwt.token"));
        assert!(r.memory_revoked);
        assert_eq!(r.headers.get(REFRESH_HEADER).map(String::as_str), Some("new.jwt.token"));
        assert_eq!(r.headers.get(MEMORY_REVOKED_HEADER).map(String::as_str), Some("1"));
        assert!(!r.cancelled);

        let head = server.await.unwrap().to_ascii_lowercase();
        assert!(head.starts_with("post /api/chat"), "{head}");
        assert!(head.contains("user-agent: lu-mobile/3.0.5"), "{head}");
        assert!(!head.contains("spoofed"), "{head}");
        assert!(head.contains("authorization: bearer old.jwt.token"), "{head}");
        assert!(head.contains("content-type: application/json"), "{head}");
    }

    #[tokio::test]
    async fn an_answer_without_the_headers_reports_none() {
        let answer = "HTTP/1.1 200 OK\r\nContent-Length: 15\r\nConnection: close\r\n\r\n{\"status\":\"ok\"}".to_string();
        let (port, _server) = serve_once(answer, 0).await;
        let book = CancelBook::default();
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/remote-api/status")).unwrap();
        let r = perform(&book, "LU-Mobile/test", url.clone(), req(url.to_string(), None)).await.unwrap();
        assert_eq!(r.status, 200);
        assert_eq!(r.refreshed_token, None);
        assert!(!r.memory_revoked);
        assert!(r.headers.is_empty());
    }

    #[tokio::test]
    async fn a_redirect_is_passed_on_and_not_followed() {
        let answer = "HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/mobile\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string();
        let (port, _server) = serve_once(answer, 0).await;
        let book = CancelBook::default();
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/nothing")).unwrap();
        let r = perform(&book, "LU-Mobile/test", url.clone(), req(url.to_string(), None)).await.unwrap();
        assert_eq!(r.status, 302);
    }

    #[tokio::test]
    async fn cancel_ends_a_call_that_waits_for_headers() {
        let answer = "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".to_string();
        let (port, _server) = serve_once(answer, 4_000).await;
        let book = std::sync::Arc::new(CancelBook::default());
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/api/chat")).unwrap();
        let book2 = book.clone();
        let started = std::time::Instant::now();
        let call = tokio::spawn(async move {
            perform(&book2, "LU-Mobile/test", url.clone(), req(url.to_string(), Some("chat-1"))).await
        });
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(book.cancel("chat-1"));
        let r = call.await.unwrap().unwrap();
        assert!(r.cancelled);
        assert_eq!(r.status, 0);
        assert!(started.elapsed() < Duration::from_millis(2_500));
    }

    #[tokio::test]
    async fn a_dead_port_is_an_error_in_words() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let book = CancelBook::default();
        let url = url::Url::parse(&format!("http://127.0.0.1:{port}/x")).unwrap();
        let e = perform(&book, "LU-Mobile/test", url.clone(), req(url.to_string(), None)).await.unwrap_err();
        assert_eq!(e, "The desktop could not be reached.");
        assert!(!e.contains("127.0.0.1"));
    }
}
