//! Where a page fetch for a model may connect, and how much it may read.
//!
//! `web_fetch` takes its address from a model, and a model takes it from
//! whatever page it read last. Three things were open (review of round 6):
//!
//! 1. The address was checked and then looked up a second time when the
//!    socket was opened. A name that answers a public address to the check
//!    and 192.168.x.x to the connect (DNS rebinding) walked into the home
//!    network. Here every hop is resolved ONCE, checked, and connected to
//!    exactly the addresses that were checked (`proxy::pinned_client_as`).
//!    Redirects are followed by hand, so each hop gets its own check and its
//!    own pin.
//! 2. The body was read whole, whatever its size. A server that sends as fast
//!    as the line carries filled the memory until the 20 s deadline. Here the
//!    body is read piece by piece and the count stops at `MAX_BODY`.
//! 3. The shared gate (`proxy::is_blocked_ip`) leaves 100.64.0.0/10 open on
//!    purpose: that is where Tailscale puts the user's own machines, and the
//!    same predicate judges the backends a user enters by hand. A model is not
//!    the user. `closed_to_a_model` is the stricter list for an address a
//!    model supplied, applied on top of the shared gate.
//!
//! Everything that needs a network is behind `Gate`, so the tests run against
//! stub servers on loopback and hand in the answers a hostile resolver gives.

use crate::os_error;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

/// The most bytes of a body that are read off the wire, packed or not. The
/// reader keeps 24 000 characters of a page, so this is generous.
pub(crate) const MAX_BODY: usize = 8 * 1024 * 1024;

/// Redirects followed before the fetch gives up. The number the automatic
/// policy had before.
const MAX_REDIRECTS: usize = 6;

/// One deadline for the whole fetch, every hop and the body. As before.
pub(crate) const DEADLINE: Duration = Duration::from_secs(20);

pub(crate) const USER_AGENT: &str = crate::app_identity::AGENT_FETCH_USER_AGENT;
const ACCEPT: &str = "text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5";
const ACCEPT_LANGUAGE: &str = "en,de;q=0.8";

/// Check one URL and answer the addresses the connection must go to.
pub(crate) type Gate = Arc<dyn Fn(&str) -> Result<Vec<SocketAddr>, String> + Send + Sync>;

/// What came back from the last hop.
#[derive(Debug)]
pub(crate) struct Page {
    pub final_url: String,
    pub status: u16,
    pub content_type: String,
    pub content_encoding: String,
    pub body: Vec<u8>,
}

fn closed_v4(v4: Ipv4Addr) -> Option<&'static str> {
    let o = v4.octets();
    match o {
        [0, ..] => Some("an address of this host"),
        [10, ..] | [172, 16..=31, ..] | [192, 168, ..] => Some("a private network address"),
        [100, 64..=127, ..] => Some("a carrier or Tailscale address"),
        [127, ..] => Some("a loopback address"),
        [169, 254, ..] => Some("a link-local address"),
        [192, 0, 0, _] => Some("a protocol assignment address"),
        [198, 18..=19, ..] => Some("a benchmark network address"),
        [224..=239, ..] => Some("a multicast address"),
        // 240.0.0.0/4 is reserved, and its last address is the broadcast.
        [240..=255, ..] => Some("a reserved or broadcast address"),
        _ => None,
    }
}

/// The IPv4 address an IPv6 address stands for, where it stands for one:
/// mapped (`::ffff:a.b.c.d`), compatible (`::a.b.c.d`), NAT64
/// (`64:ff9b::/96` and the local-use `64:ff9b:1::/48`) and 6to4 (`2002::/16`).
/// A phone on an IPv6-only carrier reaches every public IPv4 site through
/// NAT64, so that prefix cannot be closed as a whole: the address inside it
/// decides.
fn embedded_v4(v6: Ipv6Addr) -> Option<Ipv4Addr> {
    if let Some(v4) = v6.to_ipv4_mapped().or_else(|| v6.to_ipv4()) {
        return Some(v4);
    }
    let s = v6.segments();
    let tail = Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8);
    if s[0] == 0x0064 && s[1] == 0xff9b && (s[2] == 0 || s[2] == 1) {
        return Some(tail);
    }
    if s[0] == 0x2002 {
        return Some(Ipv4Addr::new((s[1] >> 8) as u8, s[1] as u8, (s[2] >> 8) as u8, s[2] as u8));
    }
    None
}

/// Why a model may not reach this address, or None when it may.
///
/// Wider than `proxy::is_blocked_ip`: it adds 100.64.0.0/10, 192.0.0.0/24,
/// 198.18.0.0/15, multicast, the reserved block with the broadcast address,
/// IPv6 multicast and site-local, and it looks inside NAT64 and 6to4.
pub(crate) fn closed_to_a_model(ip: IpAddr) -> Option<&'static str> {
    match ip {
        IpAddr::V4(v4) => closed_v4(v4),
        IpAddr::V6(v6) => {
            if let Some(v4) = embedded_v4(v6) {
                return closed_v4(v4);
            }
            let s = v6.segments();
            if v6.is_loopback() || v6.is_unspecified() {
                Some("an address of this host")
            } else if (s[0] & 0xfe00) == 0xfc00 {
                Some("a private network address")
            } else if (s[0] & 0xffc0) == 0xfe80 || (s[0] & 0xffc0) == 0xfec0 {
                Some("a link-local or site-local address")
            } else if (s[0] & 0xff00) == 0xff00 {
                Some("a multicast address")
            } else {
                None
            }
        }
    }
}

/// The shared gate first (scheme, host text, numeric forms, the lookup, the
/// shared ranges), then the stricter list on every address it answered. One
/// closed address among several refuses the URL: the connection could pick it.
fn strict_addrs(
    raw: &str,
    shared: impl Fn(&str) -> Result<Vec<SocketAddr>, String>,
) -> Result<Vec<SocketAddr>, String> {
    let addrs = shared(raw)?;
    for addr in &addrs {
        if let Some(what) = closed_to_a_model(addr.ip()) {
            return Err(format!(
                "Blocked: this address leads to {}, {}, which a fetched page may not reach",
                addr.ip(),
                what
            ));
        }
    }
    Ok(addrs)
}

/// The gate of `web_fetch`. Resolves the name; call it off the reactor.
pub(crate) fn model_url_addrs(raw: &str) -> Result<Vec<SocketAddr>, String> {
    strict_addrs(raw, crate::commands::proxy::validate_public_url_addrs)
}

/// Why a request failed, in the app's own words. The address is left out.
fn reason(e: &reqwest::Error) -> String {
    let kind = if e.is_timeout() {
        "timed out"
    } else if e.is_connect() {
        "could not connect"
    } else if e.is_decode() || e.is_body() {
        "the answer could not be read"
    } else {
        "the request failed"
    };
    let mut inner: Option<String> = None;
    let mut cur = std::error::Error::source(e);
    while let Some(s) = cur {
        inner = Some(match s.downcast_ref::<std::io::Error>() {
            Some(io) => os_error::io_english(io),
            None => s.to_string(),
        });
        cur = s.source();
    }
    match inner {
        Some(i) if !i.is_empty() && i != kind => format!("{} ({})", kind, i),
        _ => kind.to_string(),
    }
}

fn too_large_message(limit: usize) -> String {
    let size = if limit >= 1024 * 1024 {
        format!("{} MB", limit / (1024 * 1024))
    } else {
        format!("{} bytes", limit)
    };
    format!(
        "Fetch failed: the page is larger than {size}, so it was not read. Use a different address."
    )
}

fn header(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> String {
    resp.headers().get(name).and_then(|v| v.to_str().ok()).unwrap_or("").to_string()
}

/// Read a body piece by piece and stop at `limit`. The count is of the bytes
/// on the wire, so a packed body is counted packed; what it unfolds to is
/// counted where it is unpacked (`web_body`). A `Content-Length` over the
/// limit ends it before the first piece.
async fn read_body(mut resp: reqwest::Response, limit: usize) -> Result<Vec<u8>, String> {
    if resp.content_length().is_some_and(|len| len > limit as u64) {
        return Err(too_large_message(limit));
    }
    let mut body: Vec<u8> = Vec::new();
    while let Some(piece) = resp
        .chunk()
        .await
        .map_err(|e| format!("Read body failed: {}", reason(&e)))?
    {
        if body.len() + piece.len() > limit {
            // Dropping the response closes the connection: nothing more is read.
            return Err(too_large_message(limit));
        }
        body.extend_from_slice(&piece);
    }
    Ok(body)
}

async fn fetch_hops(url: &str, gate: Gate, limit: usize, user_agent: &str) -> Result<Page, String> {
    let mut current = url.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let target = current.clone();
        let check = gate.clone();
        // The lookup blocks; keep it off the reactor. Its answer is the only
        // one this hop ever uses.
        let addrs = tokio::task::spawn_blocking(move || check(&target))
            .await
            .map_err(|e| format!("Fetch failed: the address check did not finish ({})", e))??;
        let parsed = url::Url::parse(&current).map_err(|e| format!("Invalid URL: {}", e))?;
        let host = parsed.host_str().unwrap_or("").to_string();
        let client =
            crate::commands::proxy::pinned_client_as(&host, &addrs, DEADLINE, user_agent)?;
        let resp = client
            .get(current.clone())
            .header("Accept", ACCEPT)
            .header("Accept-Language", ACCEPT_LANGUAGE)
            .send()
            .await
            .map_err(|e| format!("Fetch failed: {}", reason(&e)))?;
        let status = resp.status().as_u16();
        let location = header(&resp, reqwest::header::LOCATION);
        // The statuses the automatic policy followed. Without a target the
        // answer is handed back as it is.
        if matches!(status, 301 | 302 | 303 | 307 | 308) && !location.is_empty() {
            current = parsed
                .join(&location)
                .map_err(|e| format!("Invalid redirect target: {}", e))?
                .to_string();
            continue;
        }
        let content_type = header(&resp, reqwest::header::CONTENT_TYPE);
        let content_encoding = header(&resp, reqwest::header::CONTENT_ENCODING);
        let body = read_body(resp, limit).await?;
        return Ok(Page { final_url: current, status, content_type, content_encoding, body });
    }
    Err("Fetch failed: too many redirects".to_string())
}

/// GET a page for a model with `gate` checking every hop (in the app
/// `model_url_addrs`), the connection pinned to the addresses that check
/// answered, the body capped at `limit`, the whole thing inside one deadline.
///
/// `user_agent` is the one the user set under Settings, Search Provider
/// (D16), already checked by `search::custom_user_agent`, or `USER_AGENT`.
/// `search::web_fetch_with` is the caller.
pub(crate) async fn fetch_page_with(
    url: &str,
    gate: Gate,
    limit: usize,
    deadline: Duration,
    user_agent: &str,
) -> Result<Page, String> {
    match tokio::time::timeout(deadline, fetch_hops(url, gate, limit, user_agent)).await {
        Ok(result) => result,
        Err(_) => Err("Fetch failed: timed out".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Mutex;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn the_usual_private_and_special_ranges_are_closed() {
        for closed in [
            "0.0.0.0", "0.1.2.3", "127.0.0.1", "127.255.255.254", "10.0.0.1", "10.255.255.255",
            "172.16.0.1", "172.31.255.255", "192.168.0.1", "192.168.255.255", "169.254.169.254",
            "100.64.0.1", "100.100.100.200", "100.127.255.255", "192.0.0.8", "198.18.0.1",
            "198.19.255.255", "224.0.0.1", "239.255.255.250", "240.0.0.1", "255.255.255.255",
            "::", "::1", "fc00::1", "fd00:ec2::254", "fdff::1", "fe80::1", "febf::1", "fec0::1",
            "ff02::1", "ff0e::1",
        ] {
            assert!(closed_to_a_model(ip(closed)).is_some(), "{closed} must be closed");
        }
    }

    #[test]
    fn the_neighbours_of_every_closed_range_stay_open() {
        for open in [
            "1.1.1.1", "9.255.255.255", "11.0.0.1", "100.63.255.255", "100.128.0.1",
            "126.255.255.255", "128.0.0.1", "169.253.0.1", "169.255.0.1", "172.15.255.255",
            "172.32.0.1", "192.0.1.1", "192.167.255.255", "192.169.0.1", "198.17.255.255",
            "198.20.0.1", "223.255.255.255", "93.184.216.34", "2606:4700:4700::1111",
            "2001:4860:4860::8888", "fbff::1", "fe00::1",
        ] {
            assert_eq!(closed_to_a_model(ip(open)), None, "{open} must stay open");
        }
    }

    #[test]
    fn an_ipv4_address_inside_an_ipv6_address_is_judged_as_what_it_is() {
        for closed in [
            "::ffff:127.0.0.1", "::ffff:192.168.1.1", "::ffff:100.64.0.1", "::10.0.0.1",
            "64:ff9b::7f00:1", "64:ff9b::c0a8:101", "64:ff9b::6440:1", "64:ff9b:1::a00:1",
            "2002:7f00:1::1", "2002:c0a8:101::1", "2002:a9fe:a9fe::",
        ] {
            assert!(closed_to_a_model(ip(closed)).is_some(), "{closed} must be closed");
        }
        // An IPv6-only carrier reaches a public IPv4 site through NAT64.
        for open in ["64:ff9b::5db8:d822", "::ffff:93.184.216.34", "2002:5db8:d822::1"] {
            assert_eq!(closed_to_a_model(ip(open)), None, "{open} must stay open");
        }
    }

    fn answers(list: &'static [&'static str]) -> impl Fn(&str) -> Result<Vec<SocketAddr>, String> {
        move |_raw| Ok(list.iter().map(|a| SocketAddr::new(ip(a), 443)).collect())
    }

    #[test]
    fn a_name_is_judged_by_every_address_it_answered() {
        let ok = strict_addrs("https://example.org/", answers(&["93.184.216.34", "2606:4700::1"])).unwrap();
        assert_eq!(ok.len(), 2, "the approved addresses are handed back for the pin");
        // Tailscale: open in the shared gate, closed for a model.
        let tail = strict_addrs("https://box.example/", answers(&["100.101.102.103"])).unwrap_err();
        assert!(tail.starts_with("Blocked:") && tail.contains("100.101.102.103"), "{tail}");
        // One closed address among public ones is enough.
        let split = strict_addrs("https://split.example/", answers(&["93.184.216.34", "64:ff9b::a00:1"]));
        assert!(split.unwrap_err().starts_with("Blocked:"));
        // What the shared gate refuses stays refused, in its own words.
        let shared = strict_addrs("https://x.example/", |_| Err("Blocked: by the shared gate".to_string()));
        assert_eq!(shared.unwrap_err(), "Blocked: by the shared gate");
    }

    #[test]
    fn the_real_gate_refuses_written_addresses_without_a_lookup() {
        for url in [
            "http://127.0.0.1:8127/", "http://localhost/", "http://192.168.1.1/", "http://10.0.0.1/",
            "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1:11435/",
            "http://100.100.50.2/", "http://[::1]/", "http://[fd00::1]/", "http://[fe80::1]/",
            "http://[::ffff:192.168.0.1]/", "http://[64:ff9b::c0a8:1]/", "http://224.0.0.1/",
            "http://255.255.255.255/", "http://0.0.0.0/", "http://198.18.0.1/", "http://2130706433/",
            "http://0x7f000001/", "file:///etc/passwd", "ftp://example.org/",
        ] {
            assert!(model_url_addrs(url).is_err(), "{url} must be refused");
        }
        // A public address written out passes, and is the address to connect to.
        let addrs = model_url_addrs("https://93.184.216.34/").unwrap();
        assert_eq!(addrs, vec![SocketAddr::new(ip("93.184.216.34"), 443)]);
    }

    /// One tiny HTTP server: answers every connection with what `answer`
    /// makes of the request text, and counts the connections.
    async fn serve<F>(listener: TcpListener, hits: Arc<AtomicUsize>, seen: Arc<Mutex<Vec<String>>>, answer: F)
    where
        F: Fn(&str) -> Vec<u8> + Send + Sync + 'static,
    {
        let answer = Arc::new(answer);
        loop {
            let Ok((mut sock, _)) = listener.accept().await else { break };
            hits.fetch_add(1, Ordering::SeqCst);
            let answer = answer.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                seen.lock().unwrap().push(request.clone());
                let _ = sock.write_all(&answer(&request)).await;
                let _ = sock.shutdown().await;
            });
        }
    }

    struct Stub {
        port: u16,
        hits: Arc<AtomicUsize>,
        seen: Arc<Mutex<Vec<String>>>,
    }

    async fn stub_on<F>(bind: &str, answer: F) -> Option<Stub>
    where
        F: Fn(&str) -> Vec<u8> + Send + Sync + 'static,
    {
        let listener = TcpListener::bind(bind).await.ok()?;
        let port = listener.local_addr().unwrap().port();
        let hits = Arc::new(AtomicUsize::new(0));
        let seen = Arc::new(Mutex::new(Vec::new()));
        tokio::spawn(serve(listener, hits.clone(), seen.clone(), answer));
        Some(Stub { port, hits, seen })
    }

    async fn stub<F>(answer: F) -> Stub
    where
        F: Fn(&str) -> Vec<u8> + Send + Sync + 'static,
    {
        stub_on("127.0.0.1:0", answer).await.unwrap()
    }

    fn ok(body: &str) -> Vec<u8> {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .into_bytes()
    }

    fn redirect(to: &str) -> Vec<u8> {
        format!("HTTP/1.1 302 Found\r\nLocation: {to}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").into_bytes()
    }

    /// The gate of the stub tests: the names ending in `.test` stand for
    /// public names and answer loopback, where the stubs live. Everything else
    /// goes through the real gate, so a redirect to a written address is
    /// judged exactly as in the app.
    fn stub_gate() -> Gate {
        Arc::new(|raw: &str| {
            let parsed = url::Url::parse(raw).map_err(|e| e.to_string())?;
            let port = parsed.port_or_known_default().unwrap_or(80);
            if parsed.host_str().unwrap_or("").ends_with(".test") {
                return Ok(vec![SocketAddr::new(ip("127.0.0.1"), port)]);
            }
            model_url_addrs(raw)
        })
    }

    async fn get(url: &str, gate: Gate) -> Result<Page, String> {
        fetch_page_with(url, gate, 64 * 1024, Duration::from_secs(10), USER_AGENT).await
    }

    #[tokio::test]
    async fn a_page_is_fetched_with_the_headers_web_fetch_always_sent() {
        let page = stub(|_| {
            b"HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Encoding: gzip\r\nContent-Length: 5\r\nConnection: close\r\n\r\nhello".to_vec()
        })
        .await;
        let url = format!("http://site.test:{}/a?b=c", page.port);
        let got = get(&url, stub_gate()).await.unwrap();
        assert_eq!(got.status, 200);
        assert_eq!(got.final_url, url);
        assert_eq!(got.content_type, "text/html; charset=utf-8");
        assert_eq!(got.content_encoding, "gzip");
        assert_eq!(got.body, b"hello");
        let request = page.seen.lock().unwrap().join("\n").to_ascii_lowercase();
        assert!(request.starts_with("get /a?b=c http/1.1"), "{request}");
        assert!(request.contains("user-agent: mozilla/5.0 (compatible; locallyuncensored-agent/1.0)"), "{request}");
        assert!(request.contains("accept: text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.5"), "{request}");
        assert!(request.contains("accept-language: en,de;q=0.8"), "{request}");
        assert!(!request.contains("accept-encoding"), "the client asks for no packing: {request}");
    }

    #[tokio::test]
    async fn a_user_agent_from_settings_goes_out_on_every_hop() {
        // D16: the user set his own User-Agent. It goes out on the first hop
        // AND on the hop a redirect leads to, the other headers stay.
        let end = stub(|_| ok("arrived")).await;
        let to = format!("http://end.test:{}/there", end.port);
        let start = stub(move |_| redirect(&to)).await;
        let mine = "MyResearchBot/2.0 (+contact me)";
        let got = fetch_page_with(
            &format!("http://start.test:{}/", start.port),
            stub_gate(),
            64 * 1024,
            Duration::from_secs(10),
            mine,
        )
        .await
        .unwrap();
        assert_eq!(got.body, b"arrived");
        for stub in [&start, &end] {
            let request = stub.seen.lock().unwrap().join("\n").to_ascii_lowercase();
            assert!(request.contains("user-agent: myresearchbot/2.0 (+contact me)"), "{request}");
            assert!(!request.contains("locallyuncensored-agent"), "{request}");
            assert!(request.contains("accept-language: en,de;q=0.8"), "{request}");
        }
    }

    #[tokio::test]
    async fn a_redirect_is_followed_and_the_last_address_is_reported() {
        let end = stub(|_| ok("arrived")).await;
        let to = format!("http://end.test:{}/there", end.port);
        let start = stub(move |_| redirect(&to)).await;
        let got = get(&format!("http://start.test:{}/", start.port), stub_gate()).await.unwrap();
        assert_eq!(got.body, b"arrived");
        assert_eq!(got.final_url, format!("http://end.test:{}/there", end.port));
        // A relative target is read against the address it came from.
        let rel = stub(|request| if request.starts_with("GET /next") { ok("relative") } else { redirect("/next") }).await;
        let got = get(&format!("http://rel.test:{}/first", rel.port), stub_gate()).await.unwrap();
        assert_eq!(got.body, b"relative");
        assert_eq!(got.final_url, format!("http://rel.test:{}/next", rel.port));
    }

    #[tokio::test]
    async fn a_redirect_into_loopback_or_a_private_network_is_never_requested() {
        let inside = stub(|_| ok("the secret of the home network")).await;
        let targets = vec![
            format!("http://127.0.0.1:{}/secret", inside.port),
            format!("http://localhost:{}/secret", inside.port),
            format!("http://[::1]:{}/secret", inside.port),
            format!("http://[::ffff:127.0.0.1]:{}/secret", inside.port),
            "http://192.168.1.1/".to_string(),
            "http://10.0.0.2:8188/".to_string(),
            "http://172.20.0.1/".to_string(),
            "http://100.64.0.7:11435/".to_string(),
            "http://169.254.169.254/latest/meta-data/".to_string(),
            "http://[fd12:3456::1]/".to_string(),
            "file:///etc/passwd".to_string(),
        ];
        for target in targets {
            let to = target.clone();
            let start = stub(move |_| redirect(&to)).await;
            let err = get(&format!("http://start.test:{}/", start.port), stub_gate()).await.unwrap_err();
            assert!(err.starts_with("Blocked"), "{target}: {err}");
            assert_eq!(start.hits.load(Ordering::SeqCst), 1, "{target}: the first hop is asked once");
        }
        assert_eq!(inside.hits.load(Ordering::SeqCst), 0, "nothing inside was ever connected to");
    }

    #[tokio::test]
    async fn redirects_end_after_six() {
        let hits = Arc::new(AtomicUsize::new(0));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let to = format!("http://loop.test:{port}/again");
        tokio::spawn(serve(listener, hits.clone(), Arc::new(Mutex::new(Vec::new())), move |_| redirect(&to)));
        let err = get(&format!("http://loop.test:{port}/"), stub_gate()).await.unwrap_err();
        assert_eq!(err, "Fetch failed: too many redirects");
        assert_eq!(hits.load(Ordering::SeqCst), MAX_REDIRECTS + 1);
    }

    /// DNS rebinding: the name answers one address to the check and another
    /// one to whoever asks again. The connection must go to the address that
    /// was checked, and the name must be asked exactly once per hop.
    #[tokio::test]
    async fn a_name_that_answers_differently_the_second_time_is_connected_where_it_was_checked() {
        let checked = stub(|_| ok("the checked address")).await;
        // The second answer of the name: same port, the other loopback family.
        let Some(other) = stub_on(&format!("[::1]:{}", checked.port), |_| ok("the rebound address")).await else {
            return; // no IPv6 loopback, or the port is taken there: nothing to compare with
        };
        let asked = Arc::new(AtomicUsize::new(0));
        let count = asked.clone();
        let gate: Gate = Arc::new(move |raw: &str| {
            let port = url::Url::parse(raw).unwrap().port().unwrap();
            let nth = count.fetch_add(1, Ordering::SeqCst);
            let answer = if nth == 0 { "127.0.0.1" } else { "::1" };
            Ok(vec![SocketAddr::new(ip(answer), port)])
        });
        let url = format!("http://rebind.test:{}/", checked.port);
        let got = get(&url, gate.clone()).await.unwrap();
        assert_eq!(got.body, b"the checked address");
        assert_eq!(asked.load(Ordering::SeqCst), 1, "one lookup for one hop, and no second one for the connect");
        assert_eq!(other.hits.load(Ordering::SeqCst), 0, "the rebound address was never connected to");
        // The next fetch is a new hop with a new check, and it is connected to
        // what THAT check answered: the pin is per hop, not per name.
        let again = get(&url, gate).await.unwrap();
        assert_eq!(again.body, b"the rebound address");
        assert_eq!(asked.load(Ordering::SeqCst), 2);
        assert_eq!(checked.hits.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn every_hop_of_a_redirect_gets_its_own_check_and_its_own_pin() {
        let end = stub(|_| ok("end")).await;
        let to = format!("http://second.test:{}/", end.port);
        let start = stub(move |_| redirect(&to)).await;
        let checked = Arc::new(Mutex::new(Vec::<String>::new()));
        let log = checked.clone();
        let inner = stub_gate();
        let gate: Gate = Arc::new(move |raw: &str| {
            log.lock().unwrap().push(raw.to_string());
            inner(raw)
        });
        let first = format!("http://first.test:{}/", start.port);
        get(&first, gate).await.unwrap();
        assert_eq!(*checked.lock().unwrap(), vec![first, format!("http://second.test:{}/", end.port)]);
    }

    #[tokio::test]
    async fn a_body_over_the_limit_is_refused_by_its_announced_length() {
        // The length alone is enough: the body is never sent.
        let big = stub(|_| b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 900000000\r\nConnection: close\r\n\r\n<html>".to_vec()).await;
        let err = get(&format!("http://big.test:{}/", big.port), stub_gate()).await.unwrap_err();
        assert_eq!(err, "Fetch failed: the page is larger than 65536 bytes, so it was not read. Use a different address.");
        assert_eq!(too_large_message(MAX_BODY), "Fetch failed: the page is larger than 8 MB, so it was not read. Use a different address.");
    }

    #[tokio::test]
    async fn a_body_without_a_length_is_counted_piece_by_piece_and_cut_at_the_limit() {
        // No Content-Length, and the server would go on for ever.
        let sent = Arc::new(AtomicUsize::new(0));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let counter = sent.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                let counter = counter.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let _ = sock.read(&mut buf).await;
                    let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nConnection: close\r\n\r\n").await;
                    let piece = vec![b'a'; 16 * 1024];
                    while sock.write_all(&piece).await.is_ok() {
                        counter.fetch_add(piece.len(), Ordering::SeqCst);
                    }
                });
            }
        });
        let started = std::time::Instant::now();
        let err = get(&format!("http://endless.test:{port}/"), stub_gate()).await.unwrap_err();
        assert!(err.contains("larger than 65536 bytes"), "{err}");
        assert!(started.elapsed() < Duration::from_secs(5), "cut at the limit, not at the deadline");
        // The connection is closed: the server stops being able to send.
        tokio::time::sleep(Duration::from_millis(300)).await;
        let after = sent.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(sent.load(Ordering::SeqCst), after, "nothing is read after the cut");
        assert!(after < 64 * 1024 * 1024, "the server never got to send without end: {after}");
    }

    #[tokio::test]
    async fn a_body_at_the_limit_is_read_whole() {
        let page = stub(|_| {
            let mut out = b"HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n".to_vec();
            out.extend(std::iter::repeat_n(b'x', 64 * 1024));
            out
        })
        .await;
        let got = get(&format!("http://exact.test:{}/", page.port), stub_gate()).await.unwrap();
        assert_eq!(got.body.len(), 64 * 1024);
    }

    #[tokio::test]
    async fn a_server_that_never_answers_ends_at_the_deadline() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut held = Vec::new();
            loop {
                let Ok((sock, _)) = listener.accept().await else { break };
                held.push(sock);
            }
        });
        let err = fetch_page_with(&format!("http://silent.test:{port}/"), stub_gate(), 1024, Duration::from_millis(400), USER_AGENT)
            .await
            .unwrap_err();
        assert_eq!(err, "Fetch failed: timed out");
    }
}
