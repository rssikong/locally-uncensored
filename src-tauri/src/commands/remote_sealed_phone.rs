//! The phone end of the sealed remote channel (the desktop end is
//! remote_sealed.rs) (REMOTE-PROTOKOLL v2,
//! mobile-docs/remote/PROTOKOLL.md).
//!
//! This file is the one place where the app meets `crate::remote_seal`. The
//! module itself is pure (no network, no clock, no storage); what it needs
//! from the phone lives here:
//!
//!   * the device secret, created once and kept in the secure storage of the
//!     phone (Android Keystore, iOS Keychain) under an account that no
//!     `secret_*` command can read,
//!   * the sessions, in memory only, one per pinned desktop,
//!   * the HTTP round trips to `POST /remote-api/sealed`, over the Wi-Fi
//!     address or the tunnel address of the desktop,
//!   * the quiet second handshake after `session_unknown`, `session_expired`
//!     or `decrypt_failed` (once, never in a loop), the deferred answers
//!     (`202` with `x-lu-pending`) and the result pieces with their SHA-256.
//!
//! The core below takes its network as a [`Wire`], so the tests drive it
//! against a desktop in the same process that runs the real `remote_seal`
//! code. The Tauri commands at the end are built for Android and iOS only.
//!
//! What the commands hand back to JavaScript never contains a key: the
//! desktop's X25519 key and id are public (they are in the QR code), the
//! secret never leaves this file.

#![cfg_attr(not(mobile), allow(dead_code))]

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio_util::sync::CancellationToken;

use crate::remote_seal::{
    b64, b64_decode_exact, check_id, check_inner_path, check_signin_code, new_request_id, sign_signin, DesktopHello,
    DeviceSecret, InnerRequest, InnerResponse, PairState, PairingLink, PairingSecret, PhoneHandshake, PhoneHello,
    SealError, Session, FEATURE_SEALED, MAX_CHUNK, PENDING_HEADER, PENDING_PATH_PREFIX,
};

/// Every error of the sealed commands starts with this, then a code from
/// PROTOKOLL.md section 16 (or one of the local codes below), then an
/// optional detail after `: `. The TypeScript adapter reads the code.
pub(crate) const SEALED_ERROR_PREFIX: &str = "remote_sealed: ";

/// The one route of the channel.
pub const SEALED_PATH: &str = "/remote-api/sealed";
/// Polled while the desktop asks its user (PROTOKOLL 5.1).
pub const PAIR_STATUS_PATH: &str = "/remote-api/pair/status";
/// Code pairing: the phone opens its commitment here, first thing after the
/// handshake (PROTOKOLL 5.2 step 5). Only then may the comparison code show.
pub const PAIR_REVEAL_PATH: &str = "/remote-api/pair/reveal";
/// Asks the desktop to drop this phone from its list (PROTOKOLL 13).
pub const FORGET_SELF_PATH: &str = "/remote-api/devices/self/forget";
/// Result pieces of a create job (PROTOKOLL 9).
pub const RESULTS_PATH_PREFIX: &str = "/remote-api/create/results/";
/// "Sign in with my computer": the desktop asks its user, then hands over a
/// one time code bound to this phone's Ed25519 key (PROTOKOLL 15).
pub const SIGNIN_PATH: &str = "/remote-api/signin/request";
/// The desktop holds the question up to 2 minutes, after 30 s as a deferred
/// answer. The call gets that plus the way.
pub const SIGNIN_TIMEOUT_MS: u64 = 150_000;

/// Account of the device secret in the secure storage. Not in any list of
/// commands/secret.rs, so no `secret_get` from the webview can read it.
pub const DEVICE_SECRET_ACCOUNT: &str = "lu-remote-device-key";

/// A handshake gets this long.
const HANDSHAKE_TIMEOUT_MS: u64 = 20_000;
/// One sealed round trip: the desktop answers within 30 s (or 202), a poll
/// of a deferred answer is held up to 25 s. 45 s covers both plus the way.
const ROUND_TRIP_TIMEOUT_MS: u64 = 45_000;
/// The best effort calls on the way out (forget, cancel a deferred answer).
const SHORT_TIMEOUT_MS: u64 = 5_000;
/// Default and ceiling of a whole call, deferred answers included.
const DEFAULT_CALL_TIMEOUT_MS: u64 = 30_000;
const MAX_CALL_TIMEOUT_MS: u64 = 900_000;
/// Largest result the phone assembles in memory.
pub const MAX_RESULT_BYTES: u64 = 64 * 1024 * 1024;
/// A piece that fails is asked for again from the same offset this often.
const PIECE_RETRIES: u32 = 3;
/// Inner request headers the phone sends at all. The desktop keeps only
/// these anyway (`InnerRequest::for_router`); sending nothing else keeps an
/// `authorization` from ever entering the channel. `x-lu-filename` (A17,
/// CHATS-V1): the name of a document for a chat; the desktop keeps it once
/// its allowlist names it, until then it is dropped there.
const SENT_HEADERS: &[&str] = &["accept", "content-type", "x-lu-app-version", "x-lu-filename"];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// What went wrong, as the code the adapter maps to a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SealedError {
    /// A code of the channel (PROTOKOLL 16), from the desktop's outer answer
    /// or from the module on this side.
    Code(String),
    /// `rate_limited` with the seconds from `retry-after`.
    RateLimited(u64),
    /// No answer at all (network, DNS, timeout of one round trip).
    Transport(String),
    /// The address may not be used for this (code pairing over the
    /// internet, an address the QR code did not name, a public host).
    Address(&'static str),
    /// The desktop has no sealed route: older than 3.0.7.
    NotSupported,
    /// The device secret could not be read or stored.
    Vault(String),
    Cancelled,
    Timeout,
    /// The pieces of a result do not hash to what the job said.
    ResultCorrupt,
}

impl SealedError {
    pub fn code(&self) -> &str {
        match self {
            SealedError::Code(c) => c,
            SealedError::RateLimited(_) => "rate_limited",
            SealedError::Transport(_) => "unreachable",
            SealedError::Address(_) => "address_refused",
            SealedError::NotSupported => "not_supported",
            SealedError::Vault(_) => "vault",
            SealedError::Cancelled => "cancelled",
            SealedError::Timeout => "timeout",
            SealedError::ResultCorrupt => "result_corrupt",
        }
    }

    /// Text for the command result. Never contains a key, a ticket, a code
    /// or a body.
    pub fn message(&self) -> String {
        match self {
            SealedError::RateLimited(s) => format!("{SEALED_ERROR_PREFIX}rate_limited: {s}"),
            SealedError::Transport(t) => format!("{SEALED_ERROR_PREFIX}unreachable: {t}"),
            SealedError::Address(why) => format!("{SEALED_ERROR_PREFIX}address_refused: {why}"),
            SealedError::Vault(t) => format!("{SEALED_ERROR_PREFIX}vault: {t}"),
            other => format!("{SEALED_ERROR_PREFIX}{}", other.code()),
        }
    }

    /// The desktop did not run the request: a new handshake and one more
    /// try is safe (PROTOKOLL 16, last paragraph).
    fn retry_with_new_session(&self) -> bool {
        matches!(self.code(), "session_unknown" | "session_expired" | "decrypt_failed")
    }
}

impl From<SealError> for SealedError {
    fn from(e: SealError) -> Self {
        SealedError::Code(e.code().to_string())
    }
}

pub type SealedResult<T> = Result<T, SealedError>;

// ---------------------------------------------------------------------------
// The network, as the core sees it
// ---------------------------------------------------------------------------

/// The outer HTTP answer of `POST /remote-api/sealed`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Outer {
    pub status: u16,
    pub body: Vec<u8>,
    pub retry_after: Option<u64>,
}

pub type WireFuture<'a> = Pin<Box<dyn Future<Output = Result<Outer, String>> + Send + 'a>>;

/// One POST of a sealed body. `Err` is "no answer"; any status is an answer.
pub trait Wire: Send + Sync {
    fn post(&self, url: String, body: Vec<u8>, timeout_ms: u64) -> WireFuture<'_>;
}

/// Unix seconds, from the caller (the module takes no clock).
pub type Clock = dyn Fn() -> u64 + Send + Sync;

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/// Origin of a desktop, checked: http(s), a host, no user, no path. Same
/// shape the plain transport accepts (`mobile_native::remote_target`).
fn origin_of(base_url: &str) -> SealedResult<url::Url> {
    let u = url::Url::parse(base_url.trim()).map_err(|_| SealedError::Address("the address is not valid"))?;
    let plain = matches!(u.scheme(), "http" | "https")
        && u.host_str().is_some_and(|h| !h.is_empty())
        && u.username().is_empty()
        && u.password().is_none()
        && matches!(u.path(), "" | "/")
        && u.query().is_none()
        && u.fragment().is_none();
    if !plain {
        return Err(SealedError::Address("the address is not valid"));
    }
    Ok(u)
}

/// `true` for a Wi-Fi address (private range or a local name), the only
/// place the six digit code may be used (decision E2).
pub fn is_lan_address(base_url: &str) -> bool {
    use tauri_plugin_lu_native::net::{classify_host, HostKind};
    let Ok(u) = origin_of(base_url) else { return false };
    match u.host() {
        Some(h) => matches!(classify_host(&h), HostKind::Private | HostKind::LocalName),
        None => false,
    }
}

fn sealed_url(base_url: &str) -> SealedResult<String> {
    let u = origin_of(base_url)?;
    let joined = u.join(SEALED_PATH).map_err(|_| SealedError::Address("the address is not valid"))?;
    Ok(joined.to_string())
}

fn same_origin(a: &str, b: &str) -> bool {
    match (origin_of(a), origin_of(b)) {
        (Ok(x), Ok(y)) => x.origin() == y.origin(),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Inputs and outputs (the JSON of the commands)
// ---------------------------------------------------------------------------

/// A pinned desktop, as the app stores it next to its chats.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPin {
    pub desktop_id: String,
    /// X25519 key, base64url (43 characters).
    pub x25519: String,
}

impl DesktopPin {
    fn key(&self) -> SealedResult<[u8; 32]> {
        check_id(&self.desktop_id).map_err(|_| SealedError::Code("bad_encoding".into()))?;
        b64_decode_exact::<32>(&self.x25519).map_err(|_| SealedError::Code("bad_encoding".into()))
    }
}

/// How the phone was introduced to the desktop.
#[derive(Debug, Clone)]
pub enum Introduction {
    /// The QR code (`lu://remote?v=2&...`). Wi-Fi and internet.
    Link(String),
    /// The six digit code, with the key the Wi-Fi status showed. Wi-Fi only.
    Code { code: String, pin: DesktopPin },
}

/// The phone as the desktop will list it.
#[derive(Debug, Clone)]
pub struct PhoneInfo {
    pub name: String,
    pub platform: String,
    pub app_version: String,
}

impl PhoneInfo {
    fn hello(&self, secret: &DeviceSecret) -> PhoneHello {
        PhoneHello::new(secret, &self.name, &self.platform, &self.app_version)
    }
}

/// A device name for the desktop's list: printable, 1 to 64 characters.
/// Format characters (zero width, bidi controls) are dropped, controls and
/// line or paragraph separators become spaces, so the desktop's name check
/// in `remote_seal` never refuses what this hands over.
pub fn clean_device_name(raw: Option<&str>, platform: &str) -> String {
    let text: String = raw
        .unwrap_or("")
        .chars()
        .filter(|&c| !crate::remote_seal::is_format_char(c))
        .map(|c| if crate::remote_seal::is_forbidden_name_char(c) { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let text: String = text.chars().take(64).collect();
    if text.is_empty() {
        match platform {
            "ios" => "iPhone".to_string(),
            _ => "Android phone".to_string(),
        }
    } else {
        text
    }
}

/// What a pairing hands back.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PairOutcome {
    pub desktop_id: String,
    pub x25519: String,
    pub name: String,
    /// `paired` or `pending` (the desktop asks its user).
    pub state: String,
    pub features: Vec<String>,
    /// Comparison code, six digits, the same on both screens. On the code
    /// way only after the desktop took the reveal.
    pub sas: Option<String>,
    /// The addresses the QR code named, for finding the desktop again.
    pub lan: Option<String>,
    pub tunnel: Option<String>,
    /// This phone's id at the desktop (public).
    pub device_id: String,
}

/// One inner request.
#[derive(Debug, Clone, Default)]
pub struct SealedCall {
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
    pub timeout_ms: Option<u64>,
}

/// The inner answer, for the command result.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SealedAnswer {
    pub status: u16,
    pub headers: HashMap<String, String>,
    /// The body as base64 (standard alphabet), it may be binary.
    pub body_base64: String,
}

impl From<InnerResponse> for SealedAnswer {
    fn from(r: InnerResponse) -> Self {
        use base64::Engine as _;
        Self {
            status: r.status,
            headers: r.headers.into_iter().collect(),
            body_base64: base64::engine::general_purpose::STANDARD.encode(&r.body),
        }
    }
}

/// The phone's proof for `POST https://lu-labs.ai/api/device-signin/redeem`
/// (PROTOKOLL 15): the code the desktop handed over, the time and the
/// Ed25519 signature over `lu-remote-v1/signin\n<code>\n<time>`. Made only
/// for a code that just came out of the channel, never for one the WebView
/// names, so this phone signs nothing it was not given by its own desktop.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SigninProof {
    pub code: String,
    pub expires: Option<u64>,
    pub time: u64,
    pub signature: String,
}

/// What `remote_sealed_signin` hands back: the desktop's inner answer
/// (status and body, so every refusal can be named) and, on 200 with a
/// well formed code, the proof.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SigninOutcome {
    pub answer: SealedAnswer,
    pub proof: Option<SigninProof>,
}

/// Read `{"code","expires"}` of a 200 and sign the code.
pub fn signin_proof(secret: &DeviceSecret, answer: &InnerResponse, now: u64) -> SealedResult<Option<SigninProof>> {
    if answer.status != 200 {
        return Ok(None);
    }
    #[derive(Deserialize)]
    struct Body {
        code: String,
        #[serde(default)]
        expires: Option<u64>,
    }
    let body: Body = serde_json::from_slice(&answer.body).map_err(|_| SealedError::Code("bad_inner".into()))?;
    check_signin_code(&body.code).map_err(|_| SealedError::Code("bad_inner".into()))?;
    let signature = sign_signin(secret, &body.code, now)?;
    Ok(Some(SigninProof { code: body.code, expires: body.expires, time: now, signature }))
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

struct Channel {
    session: Arc<Session>,
    x25519: [u8; 32],
    state: PairState,
    features: Vec<String>,
}

/// Sessions per pinned desktop, in memory only.
#[derive(Default)]
pub struct SealedClient {
    channels: Mutex<HashMap<String, Arc<Channel>>>,
    /// One handshake at a time per app: parallel calls after a restart of
    /// the desktop wait for the first one instead of each making their own.
    handshake: tokio::sync::Mutex<()>,
}

fn parse_outer_error(outer: &Outer) -> SealedError {
    #[derive(Deserialize)]
    struct E {
        error: String,
    }
    if let Ok(e) = serde_json::from_slice::<E>(&outer.body) {
        let code = e.error;
        let shaped = !code.is_empty() && code.len() <= 40 && code.bytes().all(|b| b.is_ascii_lowercase() || b == b'_');
        if shaped {
            if code == "rate_limited" {
                return SealedError::RateLimited(outer.retry_after.unwrap_or(60));
            }
            return SealedError::Code(code);
        }
    }
    match outer.status {
        // No such route: a desktop older than 3.0.7 (it redirects unknown
        // paths to its /mobile page) or something that is not LU at all.
        300..=399 | 404 | 405 => SealedError::NotSupported,
        429 => SealedError::RateLimited(outer.retry_after.unwrap_or(60)),
        // The tunnel gave up (Cloudflare 52x) or the desktop broke.
        _ => SealedError::Transport(format!("HTTP {}", outer.status)),
    }
}

/// `{"error":"<code>"}` of an inner answer, if it has that shape.
fn inner_error(body: &[u8]) -> Option<SealedError> {
    let outer = Outer { status: 400, body: body.to_vec(), retry_after: None };
    match parse_outer_error(&outer) {
        e @ SealedError::Code(_) => Some(e),
        _ => None,
    }
}

fn clamp_timeout(ms: Option<u64>) -> u64 {
    ms.unwrap_or(DEFAULT_CALL_TIMEOUT_MS).clamp(1_000, MAX_CALL_TIMEOUT_MS)
}

/// Race `fut` against the cancel token and a deadline.
async fn bounded<T>(
    fut: impl Future<Output = SealedResult<T>>,
    cancel: &CancellationToken,
    deadline: tokio::time::Instant,
) -> SealedResult<T> {
    tokio::select! {
        _ = cancel.cancelled() => Err(SealedError::Cancelled),
        _ = tokio::time::sleep_until(deadline) => Err(SealedError::Timeout),
        r = fut => r,
    }
}

impl SealedClient {
    pub fn new() -> Self {
        Self::default()
    }

    fn channel(&self, desktop_id: &str) -> Option<Arc<Channel>> {
        self.channels.lock().unwrap_or_else(|p| p.into_inner()).get(desktop_id).cloned()
    }

    fn put(&self, desktop_id: &str, ch: Channel) -> Arc<Channel> {
        let ch = Arc::new(ch);
        self.channels
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .insert(desktop_id.to_string(), ch.clone());
        ch
    }

    /// Drop the session of a desktop (only if it is still `old`, when given).
    fn drop_channel(&self, desktop_id: &str, old: Option<&Arc<Channel>>) {
        let mut map = self.channels.lock().unwrap_or_else(|p| p.into_inner());
        match (map.get(desktop_id), old) {
            (Some(cur), Some(old)) if !Arc::ptr_eq(cur, old) => {}
            _ => {
                map.remove(desktop_id);
            }
        }
    }

    /// True while a session to this desktop is held (tests and status).
    pub fn has_session(&self, desktop_id: &str) -> bool {
        self.channel(desktop_id).is_some()
    }

    /// Forget every session (the app's memory after a restart, in tests).
    pub fn clear(&self) {
        self.channels.lock().unwrap_or_else(|p| p.into_inner()).clear();
    }

    #[allow(clippy::too_many_arguments)]
    async fn handshake(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        desktop_id: &str,
        x25519: &[u8; 32],
        pairing: Option<&PairingSecret>,
        phone: &PhoneInfo,
        now: &Clock,
    ) -> SealedResult<(Arc<Channel>, DesktopHello)> {
        let url = sealed_url(base_url)?;
        let (hs, body) = PhoneHandshake::start(secret, desktop_id, x25519, pairing, &phone.hello(secret))?;
        let outer = wire.post(url, body, HANDSHAKE_TIMEOUT_MS).await.map_err(SealedError::Transport)?;
        if outer.status != 200 {
            return Err(parse_outer_error(&outer));
        }
        let (session, hello) = hs.finish(&outer.body, now())?;
        let ch = self.put(
            desktop_id,
            Channel {
                session: Arc::new(session),
                x25519: *x25519,
                state: hello.state,
                features: hello.features.clone(),
            },
        );
        Ok((ch, hello))
    }

    /// The session to a pinned desktop, with a new `IK` handshake when there
    /// is none, it is too old, or it belongs to another key.
    async fn ensure(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        now: &Clock,
    ) -> SealedResult<Arc<Channel>> {
        let key = pin.key()?;
        let usable = |ch: &Arc<Channel>| ch.x25519 == key && !ch.session.is_expired(now());
        if let Some(ch) = self.channel(&pin.desktop_id).filter(usable) {
            return Ok(ch);
        }
        let _one = self.handshake.lock().await;
        // Another call may have made it while this one waited.
        if let Some(ch) = self.channel(&pin.desktop_id).filter(usable) {
            return Ok(ch);
        }
        self.drop_channel(&pin.desktop_id, None);
        let (ch, _) = self.handshake(wire, secret, base_url, &pin.desktop_id, &key, None, phone, now).await?;
        Ok(ch)
    }

    /// Pair with a desktop: `IKpsk1` with the ticket of the QR code, or with
    /// the six digit code in the Wi-Fi. The session is kept; while the
    /// desktop asks its user (`pending`) the app polls
    /// [`PAIR_STATUS_PATH`] through [`SealedClient::request`].
    pub async fn pair(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        intro: Introduction,
        phone: &PhoneInfo,
        now: &Clock,
    ) -> SealedResult<PairOutcome> {
        origin_of(base_url)?;
        let (desktop_id, key, pairing, lan, tunnel) = match intro {
            Introduction::Link(uri) => {
                let link = PairingLink::parse(uri.trim())?;
                // Only to an address the QR code itself named: a link cannot
                // send the ticket anywhere else.
                let named = link.lan.as_deref().is_some_and(|a| same_origin(a, base_url))
                    || link.tunnel.as_deref().is_some_and(|a| same_origin(a, base_url));
                if !named {
                    return Err(SealedError::Address("the code does not name this address"));
                }
                let secret_of_link = PairingSecret::Ticket(link.ticket.clone());
                (link.desktop_id, link.desktop_x25519, secret_of_link, link.lan, link.tunnel)
            }
            Introduction::Code { code, pin } => {
                // Decision E2: six digits never over the internet.
                if !is_lan_address(base_url) {
                    return Err(SealedError::Address("the code works on Wi-Fi only"));
                }
                let key = pin.key()?;
                let secret_of_code = PairingSecret::code(code.trim())?;
                (pin.desktop_id, key, secret_of_code, Some(base_url.trim().trim_end_matches('/').to_string()), None)
            }
        };
        let by_code = matches!(pairing, PairingSecret::Code(_));
        let (ch, hello) = {
            let _one = self.handshake.lock().await;
            self.drop_channel(&desktop_id, None);
            self.handshake(wire, secret, base_url, &desktop_id, &key, Some(&pairing), phone, now).await?
        };
        if by_code {
            // Open the commitment before anything else, else the desktop
            // never asks its user and the code on this screen means nothing.
            let pin = DesktopPin { desktop_id: desktop_id.clone(), x25519: b64(&key) };
            let reveal = ch.session.sas_reveal().ok_or(SealedError::Code("bad_reveal".into()))?;
            let body = serde_json::to_vec(&serde_json::json!({ "n": reveal })).map_err(|_| SealedError::Code("bad_inner".into()))?;
            let inner = Self::inner("POST", PAIR_REVEAL_PATH, &[("content-type".into(), "application/json".into())], body)?;
            let answer = self.round_trip(wire, secret, base_url, &pin, phone, &inner, now).await;
            match answer {
                Ok(r) if (200..300).contains(&r.status) => {}
                Ok(r) => {
                    self.drop_channel(&desktop_id, Some(&ch));
                    return Err(inner_error(&r.body).unwrap_or(SealedError::Code("bad_reveal".into())));
                }
                Err(e) => {
                    self.drop_channel(&desktop_id, Some(&ch));
                    return Err(e);
                }
            }
        }
        Ok(PairOutcome {
            desktop_id,
            x25519: b64(&key),
            name: hello.name,
            state: match hello.state {
                PairState::Paired => "paired".into(),
                PairState::Pending => "pending".into(),
            },
            features: hello.features,
            sas: ch.session.sas().map(str::to_string),
            lan,
            tunnel,
            device_id: secret.device_id(),
        })
    }

    /// One sealed round trip, with one quiet new handshake when the desktop
    /// lost the session. Never more than one: a second `session_unknown`
    /// goes to the caller.
    #[allow(clippy::too_many_arguments)]
    async fn round_trip(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        inner: &InnerRequest,
        now: &Clock,
    ) -> SealedResult<InnerResponse> {
        let url = sealed_url(base_url)?;
        let message = inner.encode()?;
        let mut retried = false;
        loop {
            let ch = self.ensure(wire, secret, base_url, pin, phone, now).await?;
            let body = match ch.session.seal(&message, now()) {
                Ok(b) => b,
                Err(SealError::SessionExpired | SealError::SessionExhausted) if !retried => {
                    retried = true;
                    self.drop_channel(&pin.desktop_id, Some(&ch));
                    continue;
                }
                Err(e) => return Err(e.into()),
            };
            let outer = wire.post(url.clone(), body, ROUND_TRIP_TIMEOUT_MS).await.map_err(SealedError::Transport)?;
            if outer.status == 200 {
                // A broken answer is not retried: the desktop has run the
                // request, a second one could run it twice.
                let opened = ch.session.open(&outer.body, now()).map_err(|e| {
                    if matches!(e, SealError::Decrypt | SealError::SessionMismatch) {
                        self.drop_channel(&pin.desktop_id, Some(&ch));
                    }
                    SealedError::from(e)
                })?;
                return Ok(InnerResponse::decode_for(&opened, &inner.id)?);
            }
            let err = parse_outer_error(&outer);
            if err.retry_with_new_session() || err.code() == "unknown_device" {
                self.drop_channel(&pin.desktop_id, Some(&ch));
            }
            if err.retry_with_new_session() && !retried {
                retried = true;
                continue;
            }
            return Err(err);
        }
    }

    fn inner(method: &str, path: &str, headers: &[(String, String)], body: Vec<u8>) -> SealedResult<InnerRequest> {
        check_inner_path(path)?;
        let headers = headers
            .iter()
            .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.clone()))
            .filter(|(k, _)| SENT_HEADERS.contains(&k.as_str()))
            .collect();
        Ok(InnerRequest {
            id: new_request_id()?,
            method: method.trim().to_ascii_uppercase(),
            path: path.to_string(),
            headers,
            body,
        })
    }

    /// A request through the channel. Follows a deferred answer (`202` with
    /// `x-lu-pending`) until it is there, the time is up, or the caller
    /// cancels; a cancelled or timed out deferred answer is cancelled at the
    /// desktop too (best effort).
    #[allow(clippy::too_many_arguments)]
    pub async fn request(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        call: SealedCall,
        now: &Clock,
        cancel: &CancellationToken,
    ) -> SealedResult<InnerResponse> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(clamp_timeout(call.timeout_ms));
        let first = Self::inner(&call.method, &call.path, &call.headers, call.body)?;
        let mut answer = bounded(self.round_trip(wire, secret, base_url, pin, phone, &first, now), cancel, deadline).await?;
        loop {
            let token = match (answer.status, answer.header(PENDING_HEADER)) {
                (202, Some(t)) => t.to_string(),
                _ => return Ok(answer),
            };
            check_id(&token).map_err(|_| SealedError::Code("bad_inner".into()))?;
            let poll = Self::inner("GET", &format!("{PENDING_PATH_PREFIX}{token}"), &[], Vec::new())?;
            match bounded(self.round_trip(wire, secret, base_url, pin, phone, &poll, now), cancel, deadline).await {
                Ok(next) => answer = next,
                Err(e @ (SealedError::Cancelled | SealedError::Timeout)) => {
                    self.cancel_pending(wire, secret, base_url, pin, phone, &token, now).await;
                    return Err(e);
                }
                Err(e) => return Err(e),
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn cancel_pending(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        token: &str,
        now: &Clock,
    ) {
        let Ok(del) = Self::inner("DELETE", &format!("{PENDING_PATH_PREFIX}{token}"), &[], Vec::new()) else {
            return;
        };
        let _ = tokio::time::timeout(
            Duration::from_millis(SHORT_TIMEOUT_MS),
            self.round_trip(wire, secret, base_url, pin, phone, &del, now),
        )
        .await;
    }

    /// A finished result of the desktop, piece by piece (at most 4 MiB
    /// each), checked against the SHA-256 the job named. A piece that fails
    /// is asked for again from the last good offset. Corrupt in the end
    /// means: load it again.
    #[allow(clippy::too_many_arguments)]
    pub async fn fetch_result(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        result_id: &str,
        size: u64,
        sha256_hex: &str,
        now: &Clock,
        cancel: &CancellationToken,
    ) -> SealedResult<Vec<u8>> {
        let id_ok = !result_id.is_empty()
            && result_id.len() <= 64
            && result_id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
        let want = sha256_hex.trim().to_ascii_lowercase();
        if !id_ok || want.len() != 64 || !want.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(SealedError::Code("bad_inner".into()));
        }
        if size > MAX_RESULT_BYTES {
            return Err(SealedError::Code("too_large".into()));
        }
        let mut out: Vec<u8> = Vec::with_capacity(size as usize);
        let mut failures = 0u32;
        while (out.len() as u64) < size {
            if cancel.is_cancelled() {
                return Err(SealedError::Cancelled);
            }
            let offset = out.len() as u64;
            let length = (size - offset).min(MAX_CHUNK as u64);
            let path = format!("{RESULTS_PATH_PREFIX}{result_id}?offset={offset}&length={length}");
            let call = SealedCall { method: "GET".into(), path, timeout_ms: Some(ROUND_TRIP_TIMEOUT_MS), ..Default::default() };
            let got = self.request(wire, secret, base_url, pin, phone, call, now, cancel).await;
            match got {
                // The desktop names the piece (x-lu-offset, x-lu-total-bytes,
                // x-lu-sha256). A piece of another offset or another file is
                // never put together with this one.
                Ok(r) if r.status == 200 && !piece_matches(&r, offset, size, &want) => {
                    return Err(SealedError::ResultCorrupt);
                }
                Ok(r) if r.status == 200 && !r.body.is_empty() && r.body.len() as u64 <= length => {
                    out.extend_from_slice(&r.body);
                    failures = 0;
                }
                Ok(r) if r.status != 200 => return Err(SealedError::Code(format!("http_{}", r.status))),
                Err(e @ (SealedError::Cancelled | SealedError::Code(_) | SealedError::NotSupported)) => return Err(e),
                _ => {
                    failures += 1;
                    if failures > PIECE_RETRIES {
                        return Err(SealedError::Transport("the result could not be loaded".into()));
                    }
                }
            }
        }
        let got = hex(&Sha256::digest(&out));
        if got != want {
            return Err(SealedError::ResultCorrupt);
        }
        Ok(out)
    }

    /// Unpair on this side: if the desktop can be reached, ask it to drop
    /// this phone first (best effort, short), then forget the session.
    /// True when the desktop confirmed.
    pub async fn forget(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: Option<&str>,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        now: &Clock,
    ) -> bool {
        let mut confirmed = false;
        if let Some(base) = base_url {
            let call = SealedCall {
                method: "POST".into(),
                path: FORGET_SELF_PATH.into(),
                timeout_ms: Some(SHORT_TIMEOUT_MS),
                ..Default::default()
            };
            let cancel = CancellationToken::new();
            let run = self.request(wire, secret, base, pin, phone, call, now, &cancel);
            if let Ok(Ok(r)) = tokio::time::timeout(Duration::from_millis(SHORT_TIMEOUT_MS + 1_000), run).await {
                confirmed = (200..300).contains(&r.status);
            }
        }
        self.drop_channel(&pin.desktop_id, None);
        confirmed
    }

    /// "Sign in with my computer": ask the desktop (it asks its user, up to 2
    /// minutes), then sign the code it handed over with this phone's key.
    #[allow(clippy::too_many_arguments)]
    pub async fn signin(
        &self,
        wire: &dyn Wire,
        secret: &DeviceSecret,
        base_url: &str,
        pin: &DesktopPin,
        phone: &PhoneInfo,
        now: &Clock,
        cancel: &CancellationToken,
    ) -> SealedResult<SigninOutcome> {
        let call = SealedCall {
            method: "POST".into(),
            path: SIGNIN_PATH.into(),
            headers: vec![("content-type".into(), "application/json".into())],
            body: b"{}".to_vec(),
            timeout_ms: Some(SIGNIN_TIMEOUT_MS),
        };
        let answer = self.request(wire, secret, base_url, pin, phone, call, now, cancel).await?;
        let proof = signin_proof(secret, &answer, now())?;
        Ok(SigninOutcome { answer: answer.into(), proof })
    }

    /// Features the desktop named in the last handshake, if a session is held.
    pub fn features(&self, desktop_id: &str) -> Option<Vec<String>> {
        self.channel(desktop_id).map(|c| c.features.clone())
    }
}

/// Headers of a result piece (PROTOKOLL 9): `x-lu-offset`, `x-lu-total-bytes`
/// and `x-lu-sha256` are required on every 200 and must name this offset,
/// this size and this file. A piece without one of them, or with one that
/// cannot be read, is never put together with the others (F2 of
/// ZUSAMMENSPIEL.md): the call ends with `result_corrupt`.
fn piece_matches(r: &InnerResponse, offset: u64, size: u64, sha256_hex: &str) -> bool {
    let num = |name: &str| r.header(name).and_then(|v| v.trim().parse::<u64>().ok());
    let sum_ok = r
        .header("x-lu-sha256")
        .is_some_and(|sum| sum.trim().eq_ignore_ascii_case(sha256_hex));
    num("x-lu-offset") == Some(offset) && num("x-lu-total-bytes") == Some(size) && sum_ok
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The body of an inner request: text, or bytes as base64 (an upload). Not
/// both. The size is checked by the module (`MAX_MESSAGE`).
pub fn request_body(text: Option<String>, base64_body: Option<String>) -> SealedResult<Vec<u8>> {
    use base64::Engine as _;
    match (text, base64_body) {
        (Some(_), Some(_)) => Err(SealedError::Code("bad_inner".into())),
        (Some(t), None) => Ok(t.into_bytes()),
        (None, Some(b)) => base64::engine::general_purpose::STANDARD
            .decode(b.trim())
            .map_err(|_| SealedError::Code("bad_encoding".into())),
        (None, None) => Ok(Vec::new()),
    }
}

/// `true` when the status of a desktop names the sealed channel.
pub fn has_sealed_feature(features: &[String]) -> bool {
    features.iter().any(|f| f == FEATURE_SEALED)
}

// ---------------------------------------------------------------------------
// The device secret
// ---------------------------------------------------------------------------

/// Read the secret, or make one and store it. `get` and `set` are the secure
/// storage. After a write it is read back, so a storage that silently drops
/// values does not hand out a key that is gone at the next start.
pub fn load_or_create_secret(
    get: impl Fn() -> Result<Option<String>, String>,
    set: impl Fn(&str) -> Result<(), String>,
) -> SealedResult<DeviceSecret> {
    if let Some(text) = get().map_err(SealedError::Vault)? {
        return DeviceSecret::from_b64(text.trim()).map_err(|_| SealedError::Vault("the stored device key is not readable".into()));
    }
    let fresh = DeviceSecret::generate()?;
    set(&fresh.to_b64()).map_err(SealedError::Vault)?;
    match get().map_err(SealedError::Vault)? {
        Some(text) if text.trim() == fresh.to_b64().as_str() => Ok(fresh),
        _ => Err(SealedError::Vault("the device key could not be stored".into())),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands (Android and iOS)
// ---------------------------------------------------------------------------

#[cfg(mobile)]
mod device {
    use super::*;
    use std::sync::OnceLock;
    use tauri::AppHandle;
    use tauri_plugin_lu_native::remote::CancelBook;
    use tauri_plugin_lu_native::LuNativeExt;

    pub(super) fn client() -> &'static SealedClient {
        static CLIENT: OnceLock<SealedClient> = OnceLock::new();
        CLIENT.get_or_init(SealedClient::new)
    }

    pub(super) fn cancel_book() -> &'static CancelBook {
        static BOOK: OnceLock<CancelBook> = OnceLock::new();
        BOOK.get_or_init(CancelBook::default)
    }

    pub(super) fn now() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0)
    }

    pub(super) fn platform() -> &'static str {
        if cfg!(target_os = "ios") {
            "ios"
        } else {
            "android"
        }
    }

    pub(super) fn phone(_app: &AppHandle, name: Option<&str>) -> PhoneInfo {
        PhoneInfo {
            name: clean_device_name(name, platform()),
            platform: platform().to_string(),
            app_version: crate::app_identity::APP_VERSION.to_string(),
        }
    }

    /// The secret, read once per app run.
    pub(super) async fn secret(app: &AppHandle) -> SealedResult<Arc<DeviceSecret>> {
        static CACHE: OnceLock<tokio::sync::Mutex<Option<Arc<DeviceSecret>>>> = OnceLock::new();
        let lock = CACHE.get_or_init(|| tokio::sync::Mutex::new(None));
        let mut slot = lock.lock().await;
        if let Some(s) = slot.as_ref() {
            return Ok(s.clone());
        }
        let handle = app.clone();
        let made = tauri::async_runtime::spawn_blocking(move || {
            let native = handle.lu_native();
            load_or_create_secret(
                || native.secret_get(DEVICE_SECRET_ACCOUNT).map_err(String::from),
                |v| native.secret_set(DEVICE_SECRET_ACCOUNT, v).map_err(String::from),
            )
        })
        .await
        .map_err(|e| SealedError::Vault(e.to_string()))??;
        let made = Arc::new(made);
        *slot = Some(made.clone());
        Ok(made)
    }

    /// reqwest, behind the same address gate as the plain transport:
    /// private addresses and `https://*.trycloudflare.com` only.
    pub(super) struct HttpWire {
        pub user_agent: String,
    }

    const MAX_OUTER: usize = crate::remote_seal::MAX_BODY + 64 * 1024;

    impl Wire for HttpWire {
        fn post(&self, url: String, body: Vec<u8>, timeout_ms: u64) -> WireFuture<'_> {
            Box::pin(async move {
                let target = tauri_plugin_lu_native::net::check_remote_url(&url)?;
                let client = reqwest::Client::builder()
                    .user_agent(self.user_agent.as_str())
                    .timeout(Duration::from_millis(timeout_ms))
                    .connect_timeout(Duration::from_secs(15))
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .map_err(|_| "The network client could not be set up.".to_string())?;
                let resp = client
                    .post(target)
                    .header("content-type", "application/octet-stream")
                    .body(body)
                    .send()
                    .await
                    .map_err(|e| words(&e))?;
                let status = resp.status().as_u16();
                let retry_after = resp
                    .headers()
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.trim().parse::<u64>().ok());
                if resp.content_length().is_some_and(|n| n > MAX_OUTER as u64) {
                    return Err("The answer of the desktop is too large.".to_string());
                }
                let mut resp = resp;
                let mut out = Vec::new();
                while let Some(piece) = resp.chunk().await.map_err(|e| words(&e))? {
                    if out.len() + piece.len() > MAX_OUTER {
                        return Err("The answer of the desktop is too large.".to_string());
                    }
                    out.extend_from_slice(&piece);
                }
                Ok(Outer { status, body: out, retry_after })
            })
        }
    }

    /// Never the address, never a header.
    fn words(e: &reqwest::Error) -> String {
        if e.is_timeout() {
            "The desktop did not answer in time.".into()
        } else if e.is_connect() {
            "The desktop could not be reached.".into()
        } else {
            "The request to the desktop failed.".into()
        }
    }

    pub(super) fn wire(app: &AppHandle) -> HttpWire {
        HttpWire { user_agent: app.lu_native().user_agent() }
    }
}

/// Pair this phone with a desktop. `link` is the QR code
/// (`lu://remote?v=2&...`); or `code` plus `desktopId` and `x25519` from the
/// Wi-Fi status. `baseUrl` is the address to use: one the link names, or a
/// Wi-Fi address for the code.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_sealed_pair(
    app: tauri::AppHandle,
    baseUrl: String,
    link: Option<String>,
    code: Option<String>,
    desktopId: Option<String>,
    x25519: Option<String>,
    deviceName: Option<String>,
) -> Result<PairOutcome, String> {
    let intro = match (link, code, desktopId, x25519) {
        (Some(l), None, _, _) => Introduction::Link(l),
        (None, Some(c), Some(id), Some(k)) => Introduction::Code { code: c, pin: DesktopPin { desktop_id: id, x25519: k } },
        _ => return Err(SealedError::Code("bad_inner".into()).message()),
    };
    let secret = device::secret(&app).await.map_err(|e| e.message())?;
    let phone = device::phone(&app, deviceName.as_deref());
    device::client()
        .pair(&device::wire(&app), &secret, &baseUrl, intro, &phone, &device::now)
        .await
        .map_err(|e| e.message())
}

/// One request through the channel to a pinned desktop. Every inner status
/// is an answer; `Err` means no answer (with a code, see SEALED_ERROR_PREFIX).
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case, clippy::too_many_arguments)]
pub async fn remote_sealed_request(
    app: tauri::AppHandle,
    baseUrl: String,
    desktopId: String,
    x25519: String,
    path: String,
    method: Option<String>,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    bodyBase64: Option<String>,
    timeoutMs: Option<u64>,
    callId: Option<String>,
    deviceName: Option<String>,
) -> Result<SealedAnswer, String> {
    let body = request_body(body, bodyBase64).map_err(|e| e.message())?;
    let secret = device::secret(&app).await.map_err(|e| e.message())?;
    let phone = device::phone(&app, deviceName.as_deref());
    let pin = DesktopPin { desktop_id: desktopId, x25519 };
    let call = SealedCall {
        method: method.unwrap_or_else(|| "GET".into()),
        path,
        headers: headers.unwrap_or_default().into_iter().collect(),
        body,
        timeout_ms: timeoutMs,
    };
    let cancel = match callId.as_deref() {
        Some(id) => device::cancel_book().register(id),
        None => CancellationToken::new(),
    };
    let result = device::client()
        .request(&device::wire(&app), &secret, &baseUrl, &pin, &phone, call, &device::now, &cancel)
        .await;
    if let Some(id) = callId.as_deref() {
        device::cancel_book().finish(id);
    }
    result.map(SealedAnswer::from).map_err(|e| e.message())
}

/// A result of the desktop in pieces, checked against its SHA-256. The
/// bytes come back as base64.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case, clippy::too_many_arguments)]
pub async fn remote_sealed_fetch_result(
    app: tauri::AppHandle,
    baseUrl: String,
    desktopId: String,
    x25519: String,
    resultId: String,
    size: u64,
    sha256: String,
    callId: Option<String>,
) -> Result<String, String> {
    use base64::Engine as _;
    let secret = device::secret(&app).await.map_err(|e| e.message())?;
    let phone = device::phone(&app, None);
    let pin = DesktopPin { desktop_id: desktopId, x25519 };
    let cancel = match callId.as_deref() {
        Some(id) => device::cancel_book().register(id),
        None => CancellationToken::new(),
    };
    let result = device::client()
        .fetch_result(&device::wire(&app), &secret, &baseUrl, &pin, &phone, &resultId, size, &sha256, &device::now, &cancel)
        .await;
    if let Some(id) = callId.as_deref() {
        device::cancel_book().finish(id);
    }
    result
        .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
        .map_err(|e| e.message())
}

/// "Sign in with my computer" (PROTOKOLL 15): the desktop asks its user and
/// hands over a code; this phone signs it. The WebView redeems the proof at
/// lu-labs.ai. Nothing is signed for a code the WebView names.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_sealed_signin(
    app: tauri::AppHandle,
    baseUrl: String,
    desktopId: String,
    x25519: String,
    callId: Option<String>,
) -> Result<SigninOutcome, String> {
    let secret = device::secret(&app).await.map_err(|e| e.message())?;
    let phone = device::phone(&app, None);
    let pin = DesktopPin { desktop_id: desktopId, x25519 };
    let cancel = match callId.as_deref() {
        Some(id) => device::cancel_book().register(id),
        None => CancellationToken::new(),
    };
    let result = device::client()
        .signin(&device::wire(&app), &secret, &baseUrl, &pin, &phone, &device::now, &cancel)
        .await;
    if let Some(id) = callId.as_deref() {
        device::cancel_book().finish(id);
    }
    result.map_err(|e| e.message())
}

/// Stop the running sealed call with this `callId`. True when one ran.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case)]
pub fn remote_sealed_cancel(callId: String) -> bool {
    device::cancel_book().cancel(&callId)
}

/// Unpair from a desktop: ask it to drop this phone (if `baseUrl` is given
/// and it answers), then forget the session. The pin itself lives in the
/// app's state and is removed there. True when the desktop confirmed.
#[cfg(mobile)]
#[tauri::command]
#[allow(non_snake_case)]
pub async fn remote_sealed_forget(
    app: tauri::AppHandle,
    desktopId: String,
    x25519: String,
    baseUrl: Option<String>,
) -> Result<bool, String> {
    let pin = DesktopPin { desktop_id: desktopId, x25519 };
    pin.key().map_err(|e| e.message())?;
    let secret = device::secret(&app).await.map_err(|e| e.message())?;
    let phone = device::phone(&app, None);
    Ok(device::client()
        .forget(&device::wire(&app), &secret, baseUrl.as_deref(), &pin, &phone, &device::now)
        .await)
}

#[cfg(test)]
#[path = "remote_sealed_tests.rs"]
mod tests;
