//! The phone end against a desktop in the same process. The desktop side
//! here runs the real `remote_seal` code (DesktopHandshake, Session,
//! InnerRequest), the way the desktop server of 3.0.7 is meant to; only the
//! HTTP hop is replaced by a function call.

use super::*;
use crate::remote_seal::{
    frame_kind, peek_session_id, DesktopHandshake, PairingRef, Ticket, KIND_DATA_TO_DESKTOP, KIND_HS_INIT,
};
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};

const LAN: &str = "http://192.168.1.20:11435";
const NET: &str = "https://quiet-river-lamp.trycloudflare.com";
const NOW: u64 = 1_790_000_000;
/// The deferred answer of the sign-in question in the stand in.
const SIGNIN_TOKEN: &str = "BBBBBBBBBBBBBBBBBBBBBA";

fn phone_secret() -> DeviceSecret {
    DeviceSecret::from_bytes([0x11; 32])
}

fn desk_secret() -> DeviceSecret {
    DeviceSecret::from_bytes([0x22; 32])
}

fn phone() -> PhoneInfo {
    PhoneInfo { name: "Pixel 8".into(), platform: "android".into(), app_version: "3.0.7".into() }
}

fn pin() -> DesktopPin {
    let d = desk_secret();
    DesktopPin { desktop_id: d.desktop_id(), x25519: b64(&d.x25519_public()) }
}

fn clock() -> impl Fn() -> u64 + Send + Sync {
    || NOW
}

/// (device id, method, path, headers) of a request the router saw.
type Seen = (String, String, String, Vec<(String, String)>);

/// What the stand in for the desktop does with a request.
#[derive(Default)]
struct DeskState {
    sessions: HashMap<[u8; 16], (Arc<Session>, String)>,
    known: HashSet<String>,
    tickets: Vec<Ticket>,
    code: Option<String>,
    /// Device ids waiting for the user at the desktop.
    pending: HashSet<String>,
    deny: bool,
    /// Requests the router saw: (device id, method, path, headers).
    seen: Vec<Seen>,
    /// Outer bodies seen, for "no plain text on the wire".
    bodies: Vec<Vec<u8>>,
    /// Paths the deferred answer: polls left until the answer is ready.
    defer_polls: usize,
    deferred_cancelled: Vec<String>,
    /// A result to hand out in pieces.
    result: Vec<u8>,
    /// Break the piece at this offset once (a dropped connection).
    drop_piece_at: Option<u64>,
    /// Answer every data frame with session_unknown (a desktop that keeps losing it).
    always_unknown: bool,
    handshakes: usize,
    rate_limited: bool,
    /// The desktop answers the reveal as if it did not match.
    bad_reveal: bool,
    /// Result pieces name the wrong offset.
    wrong_piece_offset: bool,
    /// Result pieces come without one of the three x-lu headers: 0 none, 1 offset, 2 total, 3 sha256, 4 all.
    drop_piece_header: u8,
    /// Answer of `POST /remote-api/signin/request`: (status, body), deferred
    /// once (202) before it comes.
    signin: Option<(u16, String)>,
}

struct FakeDesk {
    secret: DeviceSecret,
    state: Mutex<DeskState>,
    urls: Mutex<Vec<String>>,
    down: std::sync::atomic::AtomicBool,
}

impl FakeDesk {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            secret: desk_secret(),
            state: Mutex::new(DeskState::default()),
            urls: Mutex::new(Vec::new()),
            down: false.into(),
        })
    }

    fn st(&self) -> std::sync::MutexGuard<'_, DeskState> {
        self.state.lock().unwrap()
    }

    fn link(&self, lan: Option<&str>, net: Option<&str>) -> String {
        let t = Ticket::generate().unwrap();
        self.st().tickets.push(t.clone());
        PairingLink {
            desktop_id: self.secret.desktop_id(),
            desktop_x25519: self.secret.x25519_public(),
            ticket: t,
            name: "Studio PC".into(),
            lan: lan.map(str::to_string),
            tunnel: net.map(str::to_string),
        }
        .to_uri()
        .unwrap()
    }

    /// A restart of the desktop: every session is gone.
    fn restart(&self) {
        self.st().sessions.clear();
    }

    fn err(status: u16, code: &str) -> Outer {
        Outer { status, body: format!("{{\"error\":\"{code}\"}}").into_bytes(), retry_after: None }
    }

    fn handle(&self, body: &[u8]) -> Outer {
        self.st().bodies.push(body.to_vec());
        if self.st().rate_limited {
            return Outer { status: 429, body: b"{\"error\":\"rate_limited\"}".to_vec(), retry_after: Some(42) };
        }
        let kind = match frame_kind(body) {
            Ok(k) => k,
            Err(e) => return Self::err(400, e.code()),
        };
        if kind == KIND_HS_INIT {
            return self.handshake(body);
        }
        if kind != KIND_DATA_TO_DESKTOP {
            return Self::err(400, "wrong_kind");
        }
        let sid = match peek_session_id(body) {
            Ok(s) => s,
            Err(e) => return Self::err(400, e.code()),
        };
        if self.st().always_unknown {
            return Self::err(404, "session_unknown");
        }
        let Some((session, device)) = self.st().sessions.get(&sid).cloned() else {
            return Self::err(404, "session_unknown");
        };
        let opened = match session.open(body, NOW) {
            Ok(m) => m,
            Err(e) => return Self::err(400, e.code()),
        };
        let req = match InnerRequest::decode(&opened).and_then(|r| r.for_router(&device)) {
            Ok(r) => r,
            Err(e) => return Self::err(400, e.code()),
        };
        let (status, headers, out) = self.route(&device, &req, &session);
        let resp = InnerResponse { id: req.id.clone(), status, headers, body: out };
        let sealed = session.seal(&resp.encode().unwrap(), NOW).unwrap();
        Outer { status: 200, body: sealed, retry_after: None }
    }

    fn handshake(&self, body: &[u8]) -> Outer {
        let mut st = self.st();
        st.handshakes += 1;
        let tickets = st.tickets.clone();
        let code = st.code.clone();
        let mut used: Option<[u8; 8]> = None;
        let read = DesktopHandshake::read_init(&self.secret, body, |r| match r {
            PairingRef::Ticket(id) => {
                let t = tickets.iter().find(|t| t.id() == id)?;
                used = Some(id);
                Some(PairingSecret::Ticket(t.clone()))
            }
            PairingRef::Code => code.as_deref().and_then(|c| PairingSecret::code(c).ok()),
        });
        // A ticket works once, even when the rest fails.
        if let Some(id) = used {
            st.tickets.retain(|t| t.id() != id);
        }
        let hs = match read {
            Ok(h) => h,
            Err(e) => return Self::err(401, e.code()),
        };
        let device = hs.phone_device_id();
        let state = if hs.is_pairing() {
            st.pending.insert(device.clone());
            PairState::Pending
        } else if st.known.contains(&device) {
            PairState::Paired
        } else if st.pending.contains(&device) {
            PairState::Pending
        } else {
            return Self::err(401, "unknown_device");
        };
        let hello = DesktopHello::new(&self.secret, "Studio PC", state, vec!["sealed".into(), "pending".into()], NOW);
        let (session, out) = hs.respond(&hello, NOW).unwrap();
        st.sessions.insert(session.id(), (Arc::new(session), device));
        Outer { status: 200, body: out, retry_after: None }
    }

    fn route(&self, device: &str, req: &InnerRequest, session: &Session) -> (u16, Vec<(String, String)>, Vec<u8>) {
        let mut st = self.st();
        st.seen.push((device.to_string(), req.method.clone(), req.path.clone(), req.headers.clone()));
        let json = |_: &str| vec![("content-type".to_string(), "application/json".to_string())];
        if req.path == PAIR_REVEAL_PATH {
            let n = serde_json::from_slice::<serde_json::Value>(&req.body).ok().and_then(|v| v["n"].as_str().map(str::to_string)).unwrap_or_default();
            let n = if st.bad_reveal { "A".repeat(43) } else { n };
            return match session.accept_sas_reveal(&n) {
                Ok(_) => (200, json("x"), b"{\"ok\":true}".to_vec()),
                Err(e) => (400, json("x"), format!("{{\"error\":\"{}\"}}", e.code()).into_bytes()),
            };
        }
        if req.path == PAIR_STATUS_PATH {
            let state = if st.known.contains(device) {
                "paired"
            } else if st.deny {
                "denied"
            } else {
                "pending"
            };
            return (200, json(state), format!("{{\"state\":\"{state}\"}}").into_bytes());
        }
        if st.pending.contains(device) && !st.known.contains(device) {
            return (403, json("x"), b"{\"error\":\"pairing_pending\"}".to_vec());
        }
        if req.path == FORGET_SELF_PATH {
            st.known.remove(device);
            return (200, json("x"), b"{\"ok\":true}".to_vec());
        }
        if req.path == SIGNIN_PATH {
            assert_eq!(req.method, "POST");
            let (status, body) = st.signin.clone().unwrap_or((403, "{\"error\":\"signin_denied\"}".into()));
            if st.defer_polls == 0 {
                return (status, json("x"), body.into_bytes());
            }
            return (202, vec![(PENDING_HEADER.to_string(), SIGNIN_TOKEN.to_string())], Vec::new());
        }
        if req.path == "/api/slow" {
            return (202, vec![(PENDING_HEADER.to_string(), "AAAAAAAAAAAAAAAAAAAAAA".to_string())], Vec::new());
        }
        if let Some(token) = req.path.strip_prefix(PENDING_PATH_PREFIX) {
            if req.method == "DELETE" {
                st.deferred_cancelled.push(token.to_string());
                return (204, Vec::new(), Vec::new());
            }
            if st.defer_polls > 0 {
                st.defer_polls -= 1;
                return (202, vec![(PENDING_HEADER.to_string(), token.to_string())], Vec::new());
            }
            if token == SIGNIN_TOKEN {
                let (status, body) = st.signin.clone().unwrap_or((403, "{\"error\":\"signin_denied\"}".into()));
                return (status, json("x"), body.into_bytes());
            }
            return (200, json("x"), b"{\"done\":true}".to_vec());
        }
        if let Some(rest) = req.path.strip_prefix(RESULTS_PATH_PREFIX) {
            let q: HashMap<String, String> = url::form_urlencoded::parse(rest.split_once('?').unwrap().1.as_bytes()).into_owned().collect();
            let offset: u64 = q["offset"].parse().unwrap();
            let length: u64 = q["length"].parse().unwrap();
            assert!(length as usize <= MAX_CHUNK);
            if st.drop_piece_at == Some(offset) {
                st.drop_piece_at = None;
                return (503, Vec::new(), Vec::new());
            }
            let end = (offset + length).min(st.result.len() as u64) as usize;
            let sum = hex(&Sha256::digest(&st.result));
            let total = st.result.len().to_string();
            let named_offset = if st.wrong_piece_offset { offset + 1 } else { offset };
            let drop = st.drop_piece_header;
            let headers: Vec<(String, String)> = vec![
                ("x-lu-offset".to_string(), named_offset.to_string()),
                ("x-lu-total-bytes".to_string(), total),
                ("x-lu-sha256".to_string(), sum),
            ]
            .into_iter()
            .enumerate()
            .filter(|(i, _)| drop == 0 || (drop != 4 && *i as u8 + 1 != drop))
            .map(|(_, h)| h)
            .collect();
            return (200, headers, st.result[offset as usize..end].to_vec());
        }
        (200, json("x"), format!("{{\"path\":\"{}\"}}", req.path).into_bytes())
    }
}

struct DeskWire(Arc<FakeDesk>);

impl Wire for DeskWire {
    fn post(&self, url: String, body: Vec<u8>, _timeout_ms: u64) -> WireFuture<'_> {
        Box::pin(async move {
            // A real network always waits a little; without this the deferred loop would never let the timer run.
            tokio::task::yield_now().await;
            self.0.urls.lock().unwrap().push(url.clone());
            if self.0.down.load(Ordering::SeqCst) {
                return Err("The desktop could not be reached.".to_string());
            }
            assert!(url.ends_with(SEALED_PATH), "only the sealed route is used: {url}");
            Ok(self.0.handle(&body))
        })
    }
}

fn get(path: &str) -> SealedCall {
    SealedCall { method: "GET".into(), path: path.into(), ..Default::default() }
}

/// Pair over the QR code and let the user at the desktop say yes.
async fn paired(desk: &Arc<FakeDesk>, client: &SealedClient, base: &str) -> PairOutcome {
    let wire = DeskWire(desk.clone());
    let link = desk.link(Some(LAN), Some(NET));
    let out = client.pair(&wire, &phone_secret(), base, Introduction::Link(link), &phone(), &clock()).await.unwrap();
    let device = phone_secret().device_id();
    desk.st().known.insert(device);
    out
}

#[tokio::test]
async fn qr_pairing_goes_pending_then_paired_through_the_status_poll() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    let link = desk.link(Some(LAN), Some(NET));
    let out = client.pair(&wire, &phone_secret(), NET, Introduction::Link(link), &phone(), &clock()).await.unwrap();
    assert_eq!(out.state, "pending");
    assert_eq!(out.name, "Studio PC");
    assert_eq!(out.desktop_id, desk_secret().desktop_id());
    assert_eq!(out.x25519, b64(&desk_secret().x25519_public()));
    assert_eq!(out.lan.as_deref(), Some(LAN));
    assert_eq!(out.tunnel.as_deref(), Some(NET));
    assert_eq!(out.sas.as_deref().map(str::len), Some(6));
    assert!(desk.st().seen.iter().all(|s| s.2 != PAIR_REVEAL_PATH), "no reveal on the QR way");
    assert_eq!(out.device_id, phone_secret().device_id());
    let cancel = CancellationToken::new();
    // While pending, everything but the status poll is refused by the desktop.
    let r = client.request(&wire, &phone_secret(), NET, &pin(), &phone(), get("/api/tags"), &clock(), &cancel).await.unwrap();
    assert_eq!(r.status, 403);
    let s = client.request(&wire, &phone_secret(), NET, &pin(), &phone(), get(PAIR_STATUS_PATH), &clock(), &cancel).await.unwrap();
    assert_eq!(s.body, b"{\"state\":\"pending\"}");
    desk.st().known.insert(phone_secret().device_id());
    let s = client.request(&wire, &phone_secret(), NET, &pin(), &phone(), get(PAIR_STATUS_PATH), &clock(), &cancel).await.unwrap();
    assert_eq!(s.body, b"{\"state\":\"paired\"}");
    let r = client.request(&wire, &phone_secret(), NET, &pin(), &phone(), get("/api/tags"), &clock(), &cancel).await.unwrap();
    assert_eq!(r.status, 200);
    // One handshake for all of it: the pairing session is kept.
    assert_eq!(desk.st().handshakes, 1);
}

#[tokio::test]
async fn a_ticket_works_once() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    let link = desk.link(Some(LAN), None);
    client.pair(&wire, &phone_secret(), LAN, Introduction::Link(link.clone()), &phone(), &clock()).await.unwrap();
    let again = client.pair(&wire, &phone_secret(), LAN, Introduction::Link(link), &phone(), &clock()).await;
    assert_eq!(again.unwrap_err(), SealedError::Code("unknown_ticket".into()));
}

#[tokio::test]
async fn the_link_goes_only_to_an_address_it_names() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    let link = desk.link(Some(LAN), None);
    for other in ["http://192.168.1.99:11435", NET, "https://evil.example"] {
        let r = client.pair(&wire, &phone_secret(), other, Introduction::Link(link.clone()), &phone(), &clock()).await;
        assert!(matches!(r, Err(SealedError::Address(_))), "{other}");
    }
    assert!(desk.urls.lock().unwrap().is_empty(), "nothing left the phone");
}

#[tokio::test]
async fn the_code_works_on_wifi_only_and_shows_the_comparison_code() {
    let desk = FakeDesk::new();
    desk.st().code = Some("482913".into());
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    for base in [NET, "https://lu.example.com", "http://203.0.113.5:11435"] {
        let r = client
            .pair(&wire, &phone_secret(), base, Introduction::Code { code: "482913".into(), pin: pin() }, &phone(), &clock())
            .await;
        assert_eq!(r.unwrap_err().code(), "address_refused", "{base}");
    }
    assert!(desk.urls.lock().unwrap().is_empty());
    let out = client
        .pair(&wire, &phone_secret(), LAN, Introduction::Code { code: "482913".into(), pin: pin() }, &phone(), &clock())
        .await
        .unwrap();
    assert_eq!(out.state, "pending");
    let sas = out.sas.clone().unwrap();
    assert!(sas.len() == 6 && sas.bytes().all(|b| b.is_ascii_digit()));
    // The desktop took the reveal and computes the same six digits from its side.
    let (desk_session, _) = desk.st().sessions.values().next().cloned().unwrap();
    assert_eq!(desk_session.sas(), Some(sas.as_str()));
    let reveals = desk.st().seen.iter().filter(|s| s.2 == PAIR_REVEAL_PATH).count();
    assert_eq!(reveals, 1, "the reveal is the first inner request");
    assert_eq!(desk.st().seen[0].2, PAIR_REVEAL_PATH);
}

#[tokio::test]
async fn a_refused_reveal_ends_the_code_pairing_without_a_comparison_code() {
    let desk = FakeDesk::new();
    {
        let mut st = desk.st();
        st.code = Some("482913".into());
        st.bad_reveal = true;
    }
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    let r = client
        .pair(&wire, &phone_secret(), LAN, Introduction::Code { code: "482913".into(), pin: pin() }, &phone(), &clock())
        .await;
    assert_eq!(r.unwrap_err().code(), "bad_reveal");
    assert!(!client.has_session(&pin().desktop_id));
}

#[tokio::test]
async fn a_wrong_code_fails_the_handshake() {
    let desk = FakeDesk::new();
    desk.st().code = Some("482913".into());
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    let r = client
        .pair(&wire, &phone_secret(), LAN, Introduction::Code { code: "111111".into(), pin: pin() }, &phone(), &clock())
        .await;
    assert_eq!(r.unwrap_err().code(), "handshake_failed");
    assert!(!client.has_session(&pin().desktop_id));
}

#[tokio::test]
async fn after_a_desktop_restart_one_quiet_handshake_and_one_retry() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let wire = DeskWire(desk.clone());
    let cancel = CancellationToken::new();
    desk.restart();
    let r = client.request(&wire, &phone_secret(), LAN, &pin(), &phone(), get("/api/tags"), &clock(), &cancel).await.unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(desk.st().handshakes, 2, "pairing plus one IK");
    // The router saw the request once, with the device id the channel proves.
    let seen: Vec<_> = desk.st().seen.iter().filter(|s| s.2 == "/api/tags").cloned().collect();
    assert_eq!(seen.len(), 1);
    assert_eq!(seen[0].0, phone_secret().device_id());
}

#[tokio::test]
async fn a_desktop_that_keeps_losing_the_session_is_not_asked_in_a_loop() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    desk.st().always_unknown = true;
    let wire = DeskWire(desk.clone());
    let before = desk.urls.lock().unwrap().len();
    let r = client
        .request(&wire, &phone_secret(), LAN, &pin(), &phone(), get("/api/tags"), &clock(), &CancellationToken::new())
        .await;
    assert_eq!(r.unwrap_err().code(), "session_unknown");
    // data, handshake, data: three posts and no more.
    assert_eq!(desk.urls.lock().unwrap().len() - before, 3);
}

#[tokio::test]
async fn an_unpaired_phone_hears_unknown_device() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    desk.st().known.clear();
    desk.st().pending.clear();
    desk.restart();
    let wire = DeskWire(desk.clone());
    let r = client
        .request(&wire, &phone_secret(), LAN, &pin(), &phone(), get("/api/tags"), &clock(), &CancellationToken::new())
        .await;
    assert_eq!(r.unwrap_err().code(), "unknown_device");
}

#[tokio::test]
async fn a_new_desktop_key_fails_the_handshake() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    client.clear();
    let wire = DeskWire(desk.clone());
    let wrong = DesktopPin { desktop_id: pin().desktop_id, x25519: b64(&DeviceSecret::from_bytes([0x23; 32]).x25519_public()) };
    let r = client
        .request(&wire, &phone_secret(), LAN, &wrong, &phone(), get("/api/tags"), &clock(), &CancellationToken::new())
        .await;
    assert_eq!(r.unwrap_err().code(), "handshake_failed");
}

#[tokio::test]
async fn the_session_moves_with_the_desktop_to_a_new_address() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let wire = DeskWire(desk.clone());
    let cancel = CancellationToken::new();
    let r = client.request(&wire, &phone_secret(), NET, &pin(), &phone(), get("/api/tags"), &clock(), &cancel).await.unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(desk.st().handshakes, 1);
}

#[tokio::test]
async fn only_safe_headers_enter_the_channel_and_no_plain_text_leaves_the_phone() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, NET).await;
    let wire = DeskWire(desk.clone());
    let call = SealedCall {
        method: "post".into(),
        path: "/api/chat".into(),
        headers: vec![
            ("Authorization".into(), "Bearer secret.jwt".into()),
            ("Content-Type".into(), "application/json".into()),
            ("x-lu-device".into(), "spoofed".into()),
            ("Cookie".into(), "a=b".into()),
        ],
        body: br#"{"messages":[{"role":"user","content":"the secret question"}]}"#.to_vec(),
        timeout_ms: None,
    };
    let r = client.request(&wire, &phone_secret(), NET, &pin(), &phone(), call, &clock(), &CancellationToken::new()).await.unwrap();
    assert_eq!(r.status, 200);
    let seen = desk.st().seen.last().cloned().unwrap();
    assert_eq!(seen.1, "POST");
    assert_eq!(
        seen.3,
        vec![
            ("content-type".to_string(), "application/json".to_string()),
            ("x-lu-device".to_string(), phone_secret().device_id())
        ]
    );
    for body in &desk.st().bodies {
        let text = String::from_utf8_lossy(body);
        for word in ["secret question", "/api/chat", "Bearer", "Pixel 8", "application/json"] {
            assert!(!text.contains(word), "{word} went over the wire in the clear");
        }
    }
}

#[tokio::test]
async fn forbidden_inner_paths_never_leave_the_phone() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let wire = DeskWire(desk.clone());
    let before = desk.urls.lock().unwrap().len();
    for p in ["/remote-api/sealed", "/remote-api/auth", "/remote-api/AUTH/", "//x", "/a/../b", "relative"] {
        let r = client
            .request(&wire, &phone_secret(), LAN, &pin(), &phone(), get(p), &clock(), &CancellationToken::new())
            .await;
        assert_eq!(r.unwrap_err().code(), "forbidden_path", "{p}");
    }
    assert_eq!(desk.urls.lock().unwrap().len(), before);
}

#[tokio::test]
async fn a_deferred_answer_is_polled_until_it_is_there() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    desk.st().defer_polls = 2;
    let wire = DeskWire(desk.clone());
    let r = client
        .request(&wire, &phone_secret(), LAN, &pin(), &phone(), get("/api/slow"), &clock(), &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(r.body, b"{\"done\":true}");
    let polls = desk.st().seen.iter().filter(|s| s.2.starts_with(PENDING_PATH_PREFIX)).count();
    assert_eq!(polls, 3);
}

#[tokio::test]
async fn a_cancelled_deferred_answer_is_cancelled_at_the_desktop() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    desk.st().defer_polls = usize::MAX;
    let wire = DeskWire(desk.clone());
    let cancel = CancellationToken::new();
    let c2 = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        c2.cancel();
    });
    let r = client.request(&wire, &phone_secret(), LAN, &pin(), &phone(), get("/api/slow"), &clock(), &cancel).await;
    assert_eq!(r.unwrap_err(), SealedError::Cancelled);
    assert_eq!(desk.st().deferred_cancelled, vec!["AAAAAAAAAAAAAAAAAAAAAA".to_string()]);
}

#[tokio::test]
async fn a_result_comes_in_pieces_and_is_checked() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let data: Vec<u8> = (0..(MAX_CHUNK + 1234)).map(|i| (i % 251) as u8).collect();
    let sum = hex(&Sha256::digest(&data));
    {
        let mut st = desk.st();
        st.result = data.clone();
        st.drop_piece_at = Some(MAX_CHUNK as u64);
    }
    let wire = DeskWire(desk.clone());
    let cancel = CancellationToken::new();
    let got = client
        .fetch_result(&wire, &phone_secret(), LAN, &pin(), &phone(), "r1", data.len() as u64, &sum, &clock(), &cancel)
        .await;
    // A 503 inside the channel is an answer, not a transport failure: it ends the download.
    assert_eq!(got.unwrap_err().code(), "http_503");
    let got = client
        .fetch_result(&wire, &phone_secret(), LAN, &pin(), &phone(), "r1", data.len() as u64, &sum, &clock(), &cancel)
        .await
        .unwrap();
    assert_eq!(got, data);
    let pieces: Vec<_> = desk.st().seen.iter().filter(|s| s.2.starts_with(RESULTS_PATH_PREFIX)).map(|s| s.2.clone()).collect();
    assert!(pieces.iter().all(|p| p.contains("length=") && p.contains("offset=")));
    // A wrong checksum means: load again.
    let wrong = hex(&Sha256::digest(b"other"));
    let bad = client
        .fetch_result(&wire, &phone_secret(), LAN, &pin(), &phone(), "r1", data.len() as u64, &wrong, &clock(), &cancel)
        .await;
    assert_eq!(bad.unwrap_err(), SealedError::ResultCorrupt);
    // A piece that names another offset is never stitched in.
    desk.st().wrong_piece_offset = true;
    let shifted = client
        .fetch_result(&wire, &phone_secret(), LAN, &pin(), &phone(), "r1", data.len() as u64, &sum, &clock(), &cancel)
        .await;
    assert_eq!(shifted.unwrap_err(), SealedError::ResultCorrupt);
}

#[tokio::test]
async fn a_dropped_connection_while_loading_a_piece_resumes_at_the_last_good_offset() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let data: Vec<u8> = (0..(MAX_CHUNK + 10)).map(|i| (i % 7) as u8).collect();
    let sum = hex(&Sha256::digest(&data));
    desk.st().result = data.clone();

    /// Fails the second post once with no answer at all.
    struct Flaky(Arc<FakeDesk>, AtomicUsize);
    impl Wire for Flaky {
        fn post(&self, url: String, body: Vec<u8>, t: u64) -> WireFuture<'_> {
            let n = self.1.fetch_add(1, Ordering::SeqCst);
            Box::pin(async move {
                if n == 1 {
                    return Err("The connection dropped while the answer was coming in.".to_string());
                }
                DeskWire(self.0.clone()).post(url, body, t).await
            })
        }
    }
    let wire = Flaky(desk.clone(), AtomicUsize::new(0));
    let got = client
        .fetch_result(&wire, &phone_secret(), LAN, &pin(), &phone(), "r2", data.len() as u64, &sum, &clock(), &CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(got, data);
    let offsets: Vec<_> = desk.st().seen.iter().filter(|s| s.2.starts_with(RESULTS_PATH_PREFIX)).map(|s| s.2.clone()).collect();
    assert_eq!(offsets.len(), 2, "{offsets:?}");
    assert!(offsets[1].contains(&format!("offset={MAX_CHUNK}")));
}

#[tokio::test]
async fn forget_asks_the_desktop_and_drops_the_session() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let wire = DeskWire(desk.clone());
    assert!(client.forget(&wire, &phone_secret(), Some(LAN), &pin(), &phone(), &clock()).await);
    assert!(!client.has_session(&pin().desktop_id));
    assert!(desk.st().known.is_empty());
    // Offline, forgetting still works on this side.
    desk.down.store(true, Ordering::SeqCst);
    assert!(!client.forget(&wire, &phone_secret(), Some(LAN), &pin(), &phone(), &clock()).await);
}

#[tokio::test]
async fn outer_errors_become_codes() {
    let desk = FakeDesk::new();
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    client.clear();
    desk.st().rate_limited = true;
    let wire = DeskWire(desk.clone());
    let r = client
        .request(&wire, &phone_secret(), LAN, &pin(), &phone(), get("/api/tags"), &clock(), &CancellationToken::new())
        .await
        .unwrap_err();
    assert_eq!(r, SealedError::RateLimited(42));
    assert_eq!(r.message(), "remote_sealed: rate_limited: 42");
    let old = Outer { status: 302, body: Vec::new(), retry_after: None };
    assert_eq!(parse_outer_error(&old), SealedError::NotSupported);
    let cf = Outer { status: 524, body: b"<html>".to_vec(), retry_after: None };
    assert_eq!(parse_outer_error(&cf).code(), "unreachable");
    let weird = Outer { status: 400, body: b"{\"error\":\"<script>\"}".to_vec(), retry_after: None };
    assert_eq!(parse_outer_error(&weird).code(), "unreachable");
}

#[tokio::test]
async fn parallel_requests_after_a_restart_share_one_handshake() {
    let desk = FakeDesk::new();
    let client = Arc::new(SealedClient::new());
    paired(&desk, &client, LAN).await;
    client.clear();
    let mut tasks = Vec::new();
    for i in 0..6 {
        let c = client.clone();
        let d = desk.clone();
        tasks.push(tokio::spawn(async move {
            let wire = DeskWire(d);
            c.request(&wire, &phone_secret(), LAN, &pin(), &phone(), get(&format!("/api/x{i}")), &clock(), &CancellationToken::new())
                .await
                .unwrap()
                .status
        }));
    }
    for t in tasks {
        assert_eq!(t.await.unwrap(), 200);
    }
    assert_eq!(desk.st().handshakes, 2);
}

#[test]
fn the_device_secret_is_made_once_and_read_back() {
    let store: Mutex<Option<String>> = Mutex::new(None);
    let writes = AtomicU64::new(0);
    let get = || Ok(store.lock().unwrap().clone());
    let set = |v: &str| {
        writes.fetch_add(1, Ordering::SeqCst);
        *store.lock().unwrap() = Some(v.to_string());
        Ok(())
    };
    let a = load_or_create_secret(get, set).unwrap();
    let b = load_or_create_secret(get, set).unwrap();
    assert_eq!(a.device_id(), b.device_id());
    assert_eq!(writes.load(Ordering::SeqCst), 1);
    // A storage that swallows writes is an error, not a key that is gone tomorrow.
    let lost = load_or_create_secret(|| Ok(None), |_| Ok(()));
    assert_eq!(lost.err().map(|e| e.code().to_string()).as_deref(), Some("vault"));
    let broken = load_or_create_secret(|| Ok(Some("not a key".into())), |_| Ok(()));
    assert_eq!(broken.err().map(|e| e.code().to_string()).as_deref(), Some("vault"));
}

#[test]
fn the_device_secret_account_is_not_reachable_from_the_webview() {
    let secret_rs = include_str!("secret.rs");
    assert!(!secret_rs.contains(DEVICE_SECRET_ACCOUNT), "the secret commands must not know the device key account");
}

#[test]
fn device_names_are_cleaned() {
    assert_eq!(clean_device_name(Some("  Pixel\n8 \u{7}"), "android"), "Pixel 8");
    assert_eq!(clean_device_name(None, "ios"), "iPhone");
    // Format characters are dropped, separators become spaces: the desktop's
    // name check never refuses what the phone sends.
    assert_eq!(clean_device_name(Some("Pi\u{200B}xel\u{202E} 8\u{2028}Pro"), "android"), "Pixel 8 Pro");
    assert_eq!(clean_device_name(Some("\u{200D}\u{FEFF}"), "ios"), "iPhone");
    assert_eq!(clean_device_name(Some("   "), "android"), "Android phone");
    assert_eq!(clean_device_name(Some(&"x".repeat(100)), "android").len(), 64);
}

#[test]
fn wifi_and_internet_addresses_are_told_apart() {
    assert!(is_lan_address(LAN));
    assert!(is_lan_address("http://studio.local:11435"));
    assert!(!is_lan_address(NET));
    assert!(!is_lan_address("http://203.0.113.5:11435"));
    assert!(!is_lan_address("http://127.0.0.1:11435"));
    assert!(!is_lan_address("http://192.168.1.20:11435/mobile"));
}

#[test]
fn the_protocol_vector_link_is_read_like_the_desktop_writes_it() {
    // PROTOKOLL.md section 18.
    let link = "lu://remote?v=2&id=or24zD2Qk4Z7byxTVSh6WQ&k=BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4&t=MzMzMzMzMzMzMzMzMzMzMw&n=Studio+PC&lan=http%3A%2F%2F192.0.2.10%3A11435&net=https%3A%2F%2Fquiet-river-lamp.trycloudflare.com";
    let p = PairingLink::parse(link).unwrap();
    assert_eq!(p.desktop_id, desk_secret().desktop_id());
    assert_eq!(p.desktop_x25519, desk_secret().x25519_public());
    assert_eq!(p.name, "Studio PC");
}

// ---------------------------------------------------------------------------
// Sign in with my computer (PROTOKOLL 15)
// ---------------------------------------------------------------------------

#[tokio::test]
async fn signin_signs_the_code_the_desktop_handed_over_and_nothing_else() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    desk.st().signin = Some((200, "{\"code\":\"Zx9_k-2mQpLr7TbW\",\"expires\":1790000120}".into()));
    desk.st().defer_polls = 1;
    let out = client.signin(&wire, &phone_secret(), LAN, &pin(), &phone(), &clock(), &CancellationToken::new()).await.unwrap();
    assert_eq!(out.answer.status, 200);
    let proof = out.proof.expect("a proof for a good code");
    assert_eq!(proof.code, "Zx9_k-2mQpLr7TbW");
    assert_eq!(proof.time, NOW);
    assert_eq!(proof.expires, Some(1_790_000_120));
    // The vector of PROTOKOLL 18: the phone key of 32 x 0x11 over this code at this time.
    assert_eq!(proof.signature, "1lQOegmy0E6BYpNVvhyC9-pFsJoJe-xr8fdQDsNS1w3qtvSrtIeigA2ETW6OTNaG7-Gx5VIvXuMMsmMoWJRQAQ");
    let ed = b64(&phone_secret().ed25519_public());
    crate::remote_seal::verify_signin(&ed, &proof.code, proof.time, &proof.signature, NOW).unwrap();
    // The request went through the channel as a POST, after the deferred answer.
    let seen = desk.st().seen.clone();
    assert!(seen.iter().any(|(_, m, p, _)| m == "POST" && p == SIGNIN_PATH));
}

#[tokio::test]
async fn signin_refusals_come_back_as_the_desktop_said_without_a_proof() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    for (status, body) in [
        (403, "{\"error\":\"signin_denied\"}"),
        (409, "{\"error\":\"desktop_signed_out\",\"message\":\"LU on your computer is not signed in.\"}"),
        (409, "{\"error\":\"signin_pending\"}"),
        (502, "{\"error\":\"signin_unavailable\"}"),
    ] {
        desk.st().signin = Some((status, body.into()));
        let out = client.signin(&wire, &phone_secret(), LAN, &pin(), &phone(), &clock(), &CancellationToken::new()).await.unwrap();
        assert_eq!(out.answer.status, status);
        assert!(out.proof.is_none());
    }
}

#[tokio::test]
async fn signin_with_a_malformed_code_signs_nothing() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    for body in ["{\"code\":\"short\"}", "{\"code\":\"has space in it 1234\"}", "{}", "not json"] {
        desk.st().signin = Some((200, body.into()));
        let err = client.signin(&wire, &phone_secret(), LAN, &pin(), &phone(), &clock(), &CancellationToken::new()).await.unwrap_err();
        assert_eq!(err.code(), "bad_inner", "{body}");
    }
}

#[test]
fn a_request_body_is_text_or_base64_bytes_never_both() {
    assert_eq!(request_body(Some("{}".into()), None).unwrap(), b"{}".to_vec());
    assert_eq!(request_body(None, Some("iVBORw0KGgo=".into())).unwrap(), vec![0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a]);
    assert!(request_body(None, None).unwrap().is_empty());
    assert_eq!(request_body(Some("a".into()), Some("YQ==".into())).unwrap_err().code(), "bad_inner");
    assert_eq!(request_body(None, Some("***".into())).unwrap_err().code(), "bad_encoding");
}

#[tokio::test]
async fn an_upload_goes_through_the_channel_as_raw_bytes() {
    let desk = FakeDesk::new();
    let wire = DeskWire(desk.clone());
    let client = SealedClient::new();
    paired(&desk, &client, LAN).await;
    let png = request_body(None, Some("iVBORw0KGgoAAAANSUhEUg==".into())).unwrap();
    let call = SealedCall {
        method: "POST".into(),
        path: "/remote-api/create/uploads".into(),
        headers: vec![("content-type".into(), "image/png".into())],
        body: png.clone(),
        timeout_ms: None,
    };
    let r = client.request(&wire, &phone_secret(), LAN, &pin(), &phone(), call, &clock(), &CancellationToken::new()).await.unwrap();
    assert_eq!(r.status, 200);
    let seen = desk.st().seen.clone();
    let (_, m, p, h) = seen.last().unwrap();
    assert_eq!((m.as_str(), p.as_str()), ("POST", "/remote-api/create/uploads"));
    assert!(h.iter().any(|(k, v)| k == "content-type" && v == "image/png"));
}

#[tokio::test]
async fn a_piece_without_its_x_lu_headers_is_refused() {
    for drop in 1..=4u8 {
        let desk = FakeDesk::new();
        let wire = DeskWire(desk.clone());
        let client = SealedClient::new();
        paired(&desk, &client, LAN).await;
        let data: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let sum = hex(&Sha256::digest(&data));
        {
            let mut st = desk.st();
            st.result = data.clone();
            st.drop_piece_header = drop;
        }
        let err = client
            .fetch_result(&wire, &phone_secret(), LAN, &pin(), &phone(), "res_1", data.len() as u64, &sum, &clock(), &CancellationToken::new())
            .await
            .unwrap_err();
        assert_eq!(err, SealedError::ResultCorrupt, "header {drop} missing");
    }
}
