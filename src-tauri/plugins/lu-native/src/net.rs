//! Which hosts a request of this plugin may reach.
//!
//! Two opposite rules live here, on one classification, so they cannot drift
//! apart:
//!
//!   * the Remote transport may reach a desktop LU and nothing else: a
//!     private address, a home network name, or a Cloudflare quick tunnel;
//!   * `download_to_temp` and the background downloads fetch from the public
//!     internet and must NOT reach a private address, or a crafted address
//!     turns the app into a way to read the user's home network.
//!
//! Hosts are taken from `url::Url`, never picked apart by hand: a hand written
//! split does not know that a backslash ends the host in a special scheme, or
//! that `0x7f.1` is 127.0.0.1.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

/// Where a host points, as far as the name or address alone can tell.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HostKind {
    /// 127.0.0.0/8, ::1, `localhost`.
    Loopback,
    /// 10/8, 172.16/12, 192.168/16, 100.64/10 (carrier grade NAT, which is
    /// what Tailscale hands out), fc00::/7, fe80::/10.
    Private,
    /// A name that only resolves inside a home or office network.
    LocalName,
    /// `<name>.trycloudflare.com`.
    QuickTunnel,
    /// 169.254/16 (which holds the cloud metadata address), 0.0.0.0/8,
    /// multicast, broadcast, documentation ranges.
    Reserved,
    /// Everything else.
    Public,
}

const LOCAL_SUFFIXES: &[&str] = &[".local", ".lan", ".home", ".internal", ".home.arpa", ".fritz.box"];

fn classify_v4(ip: Ipv4Addr) -> HostKind {
    let o = ip.octets();
    if ip.is_loopback() {
        HostKind::Loopback
    } else if o[0] == 169 && o[1] == 254 {
        HostKind::Reserved
    } else if ip.is_private() || (o[0] == 100 && (64..128).contains(&o[1])) {
        HostKind::Private
    } else if o[0] == 0 || ip.is_multicast() || ip.is_broadcast() || ip.is_documentation() || o[0] >= 240 {
        HostKind::Reserved
    } else {
        HostKind::Public
    }
}

fn classify_v6(ip: Ipv6Addr) -> HostKind {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return classify_v4(v4);
    }
    let first = ip.segments()[0];
    if ip.is_loopback() {
        HostKind::Loopback
    } else if ip.is_unspecified() || ip.is_multicast() {
        HostKind::Reserved
    } else if (first & 0xfe00) == 0xfc00 || (first & 0xffc0) == 0xfe80 {
        HostKind::Private
    } else {
        HostKind::Public
    }
}

pub fn classify_ip(ip: IpAddr) -> HostKind {
    match ip {
        IpAddr::V4(v4) => classify_v4(v4),
        IpAddr::V6(v6) => classify_v6(v6),
    }
}

/// Classify the host of an already parsed address.
pub fn classify_host(host: &url::Host<&str>) -> HostKind {
    match host {
        url::Host::Ipv4(ip) => classify_v4(*ip),
        url::Host::Ipv6(ip) => classify_v6(*ip),
        url::Host::Domain(name) => {
            let name = name.trim_end_matches('.').to_ascii_lowercase();
            if name == "localhost" || name.ends_with(".localhost") {
                HostKind::Loopback
            } else if name.ends_with(".trycloudflare.com") && name.len() > ".trycloudflare.com".len() {
                HostKind::QuickTunnel
            } else if LOCAL_SUFFIXES.iter().any(|s| name.ends_with(s)) || !name.contains('.') {
                // A bare name without a dot (`desktop`) only ever resolves
                // through the local resolver.
                HostKind::LocalName
            } else {
                HostKind::Public
            }
        }
    }
}

/// An address the Remote transport may call.
///
/// http or https to a private address or a local name, https only to a quick
/// tunnel. No credentials in the address: a token belongs in a header.
/// Loopback is refused: on a phone that is the phone itself, never a desktop.
pub fn check_remote_url(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "That address is not valid.".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Only http and https addresses can be reached.".to_string());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("An address with a user name or password in it is not allowed.".to_string());
    }
    let host = parsed.host().ok_or_else(|| "That address has no host.".to_string())?;
    match classify_host(&host) {
        HostKind::Private | HostKind::LocalName => Ok(parsed),
        HostKind::QuickTunnel if scheme == "https" => Ok(parsed),
        HostKind::QuickTunnel => Err("A trycloudflare.com link has to start with https.".to_string()),
        HostKind::Loopback => Err("This address points at the phone itself, not at a desktop.".to_string()),
        HostKind::Reserved | HostKind::Public => Err(
            "Remote Access only reaches a desktop on your own network or through its trycloudflare.com link."
                .to_string(),
        ),
    }
}

/// An address a download may fetch from: https to a public host.
///
/// `allow_test_hosts` is the acceptance switch (cargo feature `abnahme`): it
/// lets a plain http server on a private or loopback address through, which
/// is where the test servers of the emulator and the simulator live.
pub fn check_public_url(raw: &str, allow_test_hosts: bool) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw.trim()).map_err(|_| "That address is not valid.".to_string())?;
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("An address with a user name or password in it is not allowed.".to_string());
    }
    let host = parsed.host().ok_or_else(|| "That address has no host.".to_string())?;
    let kind = classify_host(&host);
    match (parsed.scheme(), kind) {
        ("https", HostKind::Public | HostKind::QuickTunnel) => Ok(parsed),
        ("http" | "https", HostKind::Private | HostKind::Loopback | HostKind::LocalName) if allow_test_hosts => {
            Ok(parsed)
        }
        ("http", HostKind::Public | HostKind::QuickTunnel) => {
            Err("Downloads need an https address.".to_string())
        }
        ("http" | "https", _) => Err("Downloads from a private or local address are not allowed.".to_string()),
        _ => Err("Only https addresses can be downloaded.".to_string()),
    }
}

/// What following the redirects of a download address by hand found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Walk {
    /// Every hop is an address a download may use. The list starts with the
    /// address that was asked for and ends with the one that answers.
    Clear(Vec<String>),
    /// A hop leads somewhere a download must not go. `reason` is the sentence
    /// for the user.
    Refused { hop: String, reason: String },
    /// The network did not answer, so nothing can be said. Not a refusal:
    /// a download that is started offline waits for the network by itself.
    Unknown(String),
}

/// The sentence a download ends with when one of its redirects points at an
/// address downloads may not reach. The same words on every platform.
pub const REDIRECT_REFUSED: &str = "This download was redirected to an address that is not allowed.";

/// How many redirects a download may take. Hugging Face needs two.
pub const MAX_REDIRECTS: usize = 8;

/// Do the two addresses share scheme, host and port? Headers of the caller (a
/// Hugging Face token) only ever go to the origin they were meant for.
pub fn same_origin(a: &url::Url, b: &url::Url) -> bool {
    a.scheme() == b.scheme() && a.host_str() == b.host_str() && a.port_or_known_default() == b.port_or_known_default()
}

/// Follow the redirects of a download address by hand and hold EVERY hop to
/// the download rule.
///
/// Why this exists: on iOS the transfer belongs to a background `URLSession`,
/// and a background session follows redirects by itself without asking the
/// app (`willPerformHTTPRedirection` is not called for it). A public address
/// answering `302 Location: https://192.168.1.1/...` would be followed. So
/// before a download is handed to the system, and before it is resumed, the
/// chain is walked here first: one small ranged GET per hop, no redirect
/// followed automatically, each `Location` checked before it is asked.
/// Android does the same check in Kotlin on every connection it opens
/// (`NetGuard.kt`), because there the app makes the requests itself.
///
/// `check` is `check_public_url` in production. It is a parameter so the
/// tests can run against servers on this machine, which the real rule
/// refuses by design.
pub async fn walk_redirects_with<C>(
    start: &str,
    headers: &std::collections::HashMap<String, String>,
    user_agent: &str,
    budget: std::time::Duration,
    check: C,
) -> Walk
where
    C: Fn(&str) -> Result<url::Url, String>,
{
    let origin = match check(start) {
        Ok(u) => u,
        Err(reason) => return Walk::Refused { hop: start.to_string(), reason },
    };
    let client = match reqwest::Client::builder()
        .user_agent(user_agent)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(std::time::Duration::from_secs(6))
        .timeout(std::time::Duration::from_secs(8))
        .build()
    {
        Ok(c) => c,
        Err(_) => return Walk::Unknown("The network client could not be set up.".to_string()),
    };
    let deadline = tokio::time::Instant::now() + budget;
    let mut current = origin.clone();
    let mut hops = vec![current.to_string()];
    loop {
        let mut request = client.get(current.clone()).header("Range", "bytes=0-0");
        if same_origin(&current, &origin) {
            for (name, value) in headers {
                let lower = name.to_ascii_lowercase();
                if !matches!(lower.as_str(), "host" | "content-length" | "range" | "connection" | "transfer-encoding" | "user-agent") {
                    request = request.header(name.as_str(), value.as_str());
                }
            }
        }
        let response = match tokio::time::timeout_at(deadline, request.send()).await {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => return Walk::Unknown("The server could not be reached.".to_string()),
            Err(_) => return Walk::Unknown("The server did not answer in time.".to_string()),
        };
        if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
            return Walk::Clear(hops);
        }
        let Some(location) = response.headers().get(reqwest::header::LOCATION).and_then(|v| v.to_str().ok()) else {
            return Walk::Clear(hops);
        };
        let next = match current.join(location) {
            Ok(u) => u,
            Err(_) => return Walk::Refused { hop: location.to_string(), reason: REDIRECT_REFUSED.to_string() },
        };
        if check(next.as_str()).is_err() {
            return Walk::Refused { hop: next.to_string(), reason: REDIRECT_REFUSED.to_string() };
        }
        if hops.len() > MAX_REDIRECTS {
            return Walk::Refused { hop: next.to_string(), reason: "This download redirects too many times.".to_string() };
        }
        hops.push(next.to_string());
        current = next;
    }
}

/// What a walk means for a start or a resume: only a refusal stops it. No
/// answer from the network is not a reason, a download started offline
/// waits for the network by itself.
pub fn redirect_verdict(walk: Walk) -> Result<(), String> {
    match walk {
        Walk::Refused { reason, .. } => Err(reason),
        Walk::Clear(_) | Walk::Unknown(_) => Ok(()),
    }
}

/// `walk_redirects_with` under the download rule.
pub async fn walk_redirects(
    start: &str,
    headers: &std::collections::HashMap<String, String>,
    user_agent: &str,
    allow_test_hosts: bool,
) -> Walk {
    walk_redirects_with(start, headers, user_agent, std::time::Duration::from_secs(10), |raw| {
        check_public_url(raw, allow_test_hosts)
    })
    .await
}

/// A link that may leave the app: the web, a mail app, the dialer. Nothing
/// else. `intent:`, `file:`, `content:`, `javascript:` and an app's own
/// scheme could reach into other apps or into this one, and the page that
/// asks is a webview.
pub fn check_external_url(raw: &str) -> Result<url::Url, String> {
    let raw = raw.trim();
    if raw.is_empty() || raw.len() > 4096 || raw.chars().any(|c| c.is_control()) {
        return Err("This is not a link that can be opened.".to_string());
    }
    let url = url::Url::parse(raw).map_err(|_| "This is not a link that can be opened.".to_string())?;
    match url.scheme() {
        "http" | "https" if url.host_str().is_some_and(|h| !h.is_empty()) => Ok(url),
        "mailto" | "tel" if !url.path().is_empty() => Ok(url),
        _ => Err("Only web links, mail addresses and phone numbers can be opened from here.".to_string()),
    }
}

/// What the sign-in sheet of the system is started with (`web_auth`): the
/// page, which has to be an https address, and the scheme of the link the
/// page ends on. The scheme is one of the app, never one a browser follows
/// itself: with `https` as the "way back" the sheet would close on the first
/// page it loads and hand that address to the app.
pub fn check_web_auth(raw_url: &str, raw_scheme: &str) -> Result<(url::Url, String), String> {
    const NOT_A_SCHEME: &str = "The sign-in page could not be started.";
    let url = check_external_url(raw_url)?;
    if url.scheme() != "https" {
        return Err("The sign-in page has to be a secure web address.".to_string());
    }
    let scheme = raw_scheme.trim().to_ascii_lowercase();
    let mut letters = scheme.chars();
    let starts_with_letter = letters.next().is_some_and(|c| c.is_ascii_lowercase());
    let rest_fits = letters.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '+' | '-' | '.'));
    if scheme.len() > 32 || !starts_with_letter || !rest_fits {
        return Err(NOT_A_SCHEME.to_string());
    }
    const OF_THE_SYSTEM: [&str; 12] =
        ["http", "https", "file", "ftp", "mailto", "tel", "sms", "data", "javascript", "about", "blob", "tauri"];
    if OF_THE_SYSTEM.contains(&scheme.as_str()) {
        return Err(NOT_A_SCHEME.to_string());
    }
    Ok((url, scheme))
}

/// The three ticks the shell knows. Anything else is the light one.
pub fn haptic_kind(raw: Option<&str>) -> &'static str {
    match raw.map(str::trim) {
        Some("success") => "success",
        Some("warning") => "warning",
        _ => "light",
    }
}

/// `#rrggbb`, lower case, or nothing.
pub fn bar_color(raw: Option<&str>) -> Option<String> {
    let raw = raw?.trim();
    let hex = raw.strip_prefix('#')?;
    (hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit())).then(|| format!("#{}", hex.to_ascii_lowercase()))
}

/// The theme the user chose in the app, as the native side keeps it for the
/// next start: `dark`, `light`, `system`, or nothing when the page said
/// nothing (then what is kept stays).
pub fn start_theme(raw: Option<&str>) -> Option<&'static str> {
    match raw?.trim() {
        "dark" => Some("dark"),
        "light" => Some("light"),
        "system" => Some("system"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_start_theme_is_one_of_three_words_or_nothing() {
        assert_eq!(start_theme(Some("dark")), Some("dark"));
        assert_eq!(start_theme(Some(" light ")), Some("light"));
        assert_eq!(start_theme(Some("system")), Some("system"));
        for bad in ["", "Dark", "auto", "#141414"] {
            assert_eq!(start_theme(Some(bad)), None, "{bad}");
        }
        assert_eq!(start_theme(None), None);
    }

    #[test]
    fn only_web_mail_and_phone_links_leave_the_app() {
        for ok in ["https://locallyuncensored.com/pricing", "http://example.org", "mailto:hi@example.com", "tel:+4930123456", "  https://a.b/c?d=e#f  "] {
            assert!(check_external_url(ok).is_ok(), "{ok}");
        }
        for bad in [
            "", "   ", "example.org", "intent://scan/#Intent;scheme=zxing;end", "file:///data/data/app/secret",
            "content://com.android.contacts/1", "javascript:alert(1)", "lu://oauth/callback", "market://details?id=x",
            "https://", "mailto:", "tel:", "https://a.b/\u{0007}", "data:text/html,x", "sms:+49",
        ] {
            assert!(check_external_url(bad).is_err(), "{bad}");
        }
        assert!(check_external_url(&format!("https://a.b/{}", "x".repeat(5000))).is_err());
    }

    #[test]
    fn an_unknown_tick_is_the_light_one() {
        assert_eq!(haptic_kind(None), "light");
        assert_eq!(haptic_kind(Some("light")), "light");
        assert_eq!(haptic_kind(Some(" success ")), "success");
        assert_eq!(haptic_kind(Some("warning")), "warning");
        assert_eq!(haptic_kind(Some("heavy; rm -rf")), "light");
    }

    #[test]
    fn a_bar_colour_is_six_hex_digits_or_nothing() {
        assert_eq!(bar_color(Some("#F3F4F6")).as_deref(), Some("#f3f4f6"));
        assert_eq!(bar_color(Some(" #141414 ")).as_deref(), Some("#141414"));
        for bad in ["141414", "#14141", "#1414141", "#gggggg", "red", ""] {
            assert_eq!(bar_color(Some(bad)), None, "{bad}");
        }
        assert_eq!(bar_color(None), None);
    }

    fn kind(raw: &str) -> HostKind {
        let u = url::Url::parse(raw).unwrap();
        classify_host(&u.host().unwrap())
    }

    #[test]
    fn private_ranges_are_private() {
        for a in [
            "http://10.0.2.2:11435",
            "http://172.16.0.1",
            "http://172.31.255.254",
            "http://192.168.1.20:11435/mobile",
            "http://100.64.0.1",
            "http://100.127.255.254",
            "http://[fd12:3456::1]:11435",
            "http://[fe80::1]",
        ] {
            assert_eq!(kind(a), HostKind::Private, "{a}");
        }
    }

    #[test]
    fn the_edges_of_the_private_ranges_are_public() {
        for a in ["http://172.15.255.255", "http://172.32.0.1", "http://100.63.255.255", "http://100.128.0.1", "http://11.0.0.1", "http://192.169.0.1"] {
            assert_eq!(kind(a), HostKind::Public, "{a}");
        }
    }

    #[test]
    fn metadata_and_link_local_are_reserved() {
        assert_eq!(kind("http://169.254.169.254/latest"), HostKind::Reserved);
        assert_eq!(kind("http://0.0.0.0"), HostKind::Reserved);
        assert_eq!(kind("http://224.0.0.1"), HostKind::Reserved);
    }

    #[test]
    fn number_tricks_do_not_hide_an_address() {
        // The URL parser turns every one of these into the dotted form
        // before the classification sees it.
        assert_eq!(kind("http://0x7f.1"), HostKind::Loopback);
        assert_eq!(kind("http://2130706433"), HostKind::Loopback);
        assert_eq!(kind("http://017700000001"), HostKind::Loopback);
        assert_eq!(kind("http://0xa9fea9fe"), HostKind::Reserved);
        assert_eq!(kind("http://[::ffff:169.254.169.254]"), HostKind::Reserved);
        assert_eq!(kind("http://[::ffff:8.8.8.8]"), HostKind::Public);
    }

    #[test]
    fn remote_accepts_a_desktop_on_the_home_network() {
        for a in [
            "http://192.168.1.20:11435/remote-api/status",
            "http://10.0.2.2:11435/api/chat",
            "http://desktop.local:11435/api/tags",
            "http://desktop:11435/api/tags",
            "https://quiet-river-1234.trycloudflare.com/remote-api/auth",
        ] {
            assert!(check_remote_url(a).is_ok(), "{a}");
        }
    }

    #[test]
    fn remote_refuses_everything_that_is_not_a_desktop() {
        for a in [
            "http://8.8.8.8/",
            "https://example.com/remote-api/auth",
            "http://169.254.169.254/",
            "http://127.0.0.1:8127/v1/models",
            "http://localhost:11435/",
            "ftp://192.168.1.20/",
            "http://user:pw@192.168.1.20:11435/",
            "http://quiet-river-1234.trycloudflare.com/",
            "https://trycloudflare.com/",
            "https://trycloudflare.com.evil.example/",
            "https://eviltrycloudflare.com/",
            "not an address",
        ] {
            assert!(check_remote_url(a).is_err(), "{a}");
        }
    }

    #[test]
    fn a_backslash_does_not_smuggle_another_host() {
        // In a special scheme a backslash ends the host. The parser knows.
        let u = check_remote_url("http://192.168.1.20\\@evil.example/x");
        if let Ok(u) = u {
            assert_eq!(u.host_str(), Some("192.168.1.20"));
        }
        assert!(check_remote_url("https://evil.example\\.trycloudflare.com/x").is_err());
    }

    #[test]
    fn downloads_reach_the_public_internet_only() {
        assert!(check_public_url("https://huggingface.co/x/resolve/main/m.gguf", false).is_ok());
        for a in [
            "http://huggingface.co/x",
            "https://192.168.1.20/x",
            "https://127.0.0.1/x",
            "http://10.0.2.2:8799/a.bin",
            "https://169.254.169.254/",
            "https://printer.local/",
            "file:///etc/passwd",
            "https://user:pw@huggingface.co/x",
        ] {
            assert!(check_public_url(a, false).is_err(), "{a}");
        }
    }

    #[test]
    fn the_acceptance_switch_opens_test_servers_and_nothing_else() {
        assert!(check_public_url("http://10.0.2.2:8799/a.bin", true).is_ok());
        assert!(check_public_url("http://127.0.0.1:8799/a.bin", true).is_ok());
        // Still closed with the switch on.
        assert!(check_public_url("http://169.254.169.254/", true).is_err());
        assert!(check_public_url("http://example.com/a.bin", true).is_err());
        assert!(check_public_url("file:///etc/passwd", true).is_err());
    }
    // ── one table for Rust, Kotlin and Swift ─────────────────────────────

    fn kind_word(k: HostKind) -> &'static str {
        match k {
            HostKind::Loopback => "loopback",
            HostKind::Private => "private",
            HostKind::LocalName => "localname",
            HostKind::QuickTunnel => "tunnel",
            HostKind::Reserved => "reserved",
            HostKind::Public => "public",
        }
    }

    #[test]
    fn the_shared_table_holds() {
        let table = include_str!("../testdata/net-vectors.tsv");
        let mut rows = 0;
        for line in table.lines().filter(|l| !l.trim().is_empty() && !l.starts_with('#')) {
            let cols: Vec<&str> = line.split('\t').collect();
            assert_eq!(cols.len(), 4, "four columns separated by one tab: {line:?}");
            let (raw, kind, store, acceptance) = (cols[0], cols[1], cols[2], cols[3]);
            let actual = url::Url::parse(raw)
                .ok()
                .and_then(|u| u.host().map(|h| kind_word(classify_host(&h))))
                .unwrap_or("invalid");
            assert_eq!(actual, kind, "kind of {raw}");
            assert_eq!(check_public_url(raw, false).is_ok(), store == "yes", "store build, {raw}");
            assert_eq!(check_public_url(raw, true).is_ok(), acceptance == "yes", "acceptance build, {raw}");
            rows += 1;
        }
        assert!(rows >= 60, "the table lost rows: {rows}");
    }

    // ── redirects, hop by hop ────────────────────────────────────────────

    use std::sync::{Arc, Mutex as StdMutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// A server that answers every request with `head` and keeps what it was
    /// sent.
    async fn stub(head: String) -> (u16, Arc<StdMutex<Vec<String>>>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let seen = Arc::new(StdMutex::new(Vec::new()));
        let log = seen.clone();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                let head = head.clone();
                let log = log.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    log.lock().unwrap().push(String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase());
                    let _ = sock.write_all(head.as_bytes()).await;
                });
            }
        });
        (port, seen)
    }

    fn redirect_to(target: &str) -> String {
        format!("HTTP/1.1 302 Found\r\nLocation: {target}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
    }

    const PARTIAL: &str = "HTTP/1.1 206 Partial Content\r\nContent-Range: bytes 0-0/10\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx";

    /// The rule of these tests: this machine passes, except the listed ports.
    /// Everything else goes through the real rule of a store build.
    fn rule(forbidden: Vec<u16>) -> impl Fn(&str) -> Result<url::Url, String> {
        move |raw| {
            let u = url::Url::parse(raw).map_err(|_| "That address is not valid.".to_string())?;
            if u.host_str() == Some("127.0.0.1") && !forbidden.contains(&u.port().unwrap_or(0)) {
                return Ok(u);
            }
            check_public_url(raw, false)
        }
    }

    fn token() -> std::collections::HashMap<String, String> {
        [("Authorization".to_string(), "Bearer hf_secret".to_string())].into_iter().collect()
    }

    const BUDGET: std::time::Duration = std::time::Duration::from_secs(5);

    #[tokio::test]
    async fn a_clean_chain_is_walked_to_its_end_and_the_token_stays_at_home() {
        let (cdn, cdn_saw) = stub(PARTIAL.to_string()).await;
        let (mid, mid_saw) = stub(redirect_to(&format!("http://127.0.0.1:{cdn}/blob"))).await;
        let (hub, hub_saw) = stub(redirect_to(&format!("http://127.0.0.1:{mid}/step"))).await;
        let start = format!("http://127.0.0.1:{hub}/a/b/resolve/main/m.gguf");
        let walk = walk_redirects_with(&start, &token(), "LU-Mobile/test", BUDGET, rule(vec![])).await;
        assert_eq!(
            walk,
            Walk::Clear(vec![start.clone(), format!("http://127.0.0.1:{mid}/step"), format!("http://127.0.0.1:{cdn}/blob")])
        );
        assert!(hub_saw.lock().unwrap()[0].contains("authorization: bearer hf_secret"));
        assert!(!mid_saw.lock().unwrap()[0].contains("authorization"), "the token left its host");
        assert!(!cdn_saw.lock().unwrap()[0].contains("authorization"), "the token left its host");
        // One byte is asked for, never the file.
        assert!(cdn_saw.lock().unwrap()[0].contains("range: bytes=0-0"));
    }

    #[tokio::test]
    async fn the_second_hop_is_checked_like_the_first_and_never_asked() {
        // hub -> mid -> inner. `inner` stands for an address in the home
        // network. It must not get a single request.
        let (inner, inner_saw) = stub(PARTIAL.to_string()).await;
        let (mid, mid_saw) = stub(redirect_to(&format!("http://127.0.0.1:{inner}/router/config"))).await;
        let (hub, _) = stub(redirect_to(&format!("http://127.0.0.1:{mid}/step"))).await;
        let start = format!("http://127.0.0.1:{hub}/m.gguf");
        let walk = walk_redirects_with(&start, &token(), "LU-Mobile/test", BUDGET, rule(vec![inner])).await;
        assert_eq!(
            walk,
            Walk::Refused { hop: format!("http://127.0.0.1:{inner}/router/config"), reason: REDIRECT_REFUSED.to_string() }
        );
        assert_eq!(mid_saw.lock().unwrap().len(), 1, "the hop before it was asked");
        assert!(inner_saw.lock().unwrap().is_empty(), "the refused hop got a request");
    }

    #[tokio::test]
    async fn the_real_rule_refuses_private_metadata_and_plain_http_targets() {
        for target in [
            "https://192.168.1.1/config",
            "https://10.0.0.5:8443/x",
            "http://169.254.169.254/latest/meta-data/",
            "https://[::1]/x",
            "https://printer.local/x",
            "http://example.com/m.gguf",
            "file:///etc/passwd",
            "https://user:pw@example.com/m.gguf",
        ] {
            let (hub, _) = stub(redirect_to(target)).await;
            let start = format!("http://127.0.0.1:{hub}/m.gguf");
            let walk = walk_redirects_with(&start, &Default::default(), "LU-Mobile/test", BUDGET, rule(vec![])).await;
            assert!(
                matches!(&walk, Walk::Refused { reason, .. } if reason == REDIRECT_REFUSED),
                "{target} was not refused: {walk:?}"
            );
        }
    }

    #[tokio::test]
    async fn a_relative_location_stays_on_its_host_and_passes() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut first = true;
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                let mut buf = vec![0u8; 4096];
                let _ = sock.read(&mut buf).await;
                let head = if first { redirect_to("/other/place") } else { PARTIAL.to_string() };
                first = false;
                let _ = sock.write_all(head.as_bytes()).await;
            }
        });
        let start = format!("http://127.0.0.1:{port}/m.gguf");
        let walk = walk_redirects_with(&start, &Default::default(), "LU-Mobile/test", BUDGET, rule(vec![])).await;
        assert_eq!(walk, Walk::Clear(vec![start, format!("http://127.0.0.1:{port}/other/place")]));
    }

    #[tokio::test]
    async fn a_chain_without_end_is_refused() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let mut n = 0;
            loop {
                let Ok((mut sock, _)) = listener.accept().await else { break };
                let mut buf = vec![0u8; 4096];
                let _ = sock.read(&mut buf).await;
                n += 1;
                let _ = sock.write_all(redirect_to(&format!("/again/{n}")).as_bytes()).await;
            }
        });
        let start = format!("http://127.0.0.1:{port}/m.gguf");
        let walk = walk_redirects_with(&start, &Default::default(), "LU-Mobile/test", BUDGET, rule(vec![])).await;
        assert!(matches!(&walk, Walk::Refused { reason, .. } if reason.contains("too many")), "{walk:?}");
    }

    #[tokio::test]
    async fn no_network_is_unknown_and_not_a_refusal() {
        let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = probe.local_addr().unwrap().port();
        drop(probe);
        let start = format!("http://127.0.0.1:{port}/m.gguf");
        let walk = walk_redirects_with(&start, &Default::default(), "LU-Mobile/test", BUDGET, rule(vec![])).await;
        assert!(matches!(walk, Walk::Unknown(_)), "{walk:?}");
    }

    #[tokio::test]
    async fn a_start_address_that_breaks_the_rule_is_refused_before_any_request() {
        let walk = walk_redirects("https://192.168.1.1/m.gguf", &Default::default(), "LU-Mobile/test", false).await;
        assert!(matches!(walk, Walk::Refused { .. }), "{walk:?}");
    }

    #[test]
    fn only_a_refusal_stops_a_download() {
        assert!(redirect_verdict(Walk::Clear(vec!["https://a.b/c".into()])).is_ok());
        assert!(redirect_verdict(Walk::Unknown("offline".into())).is_ok());
        assert_eq!(
            redirect_verdict(Walk::Refused { hop: "https://192.168.1.1/".into(), reason: REDIRECT_REFUSED.into() }),
            Err(REDIRECT_REFUSED.to_string())
        );
    }

    #[test]
    fn the_token_only_goes_to_scheme_host_and_port_it_was_meant_for() {
        let u = |s: &str| url::Url::parse(s).unwrap();
        assert!(same_origin(&u("https://huggingface.co/a"), &u("https://huggingface.co:443/b")));
        assert!(!same_origin(&u("https://huggingface.co/a"), &u("http://huggingface.co/a")));
        assert!(!same_origin(&u("https://huggingface.co/a"), &u("https://huggingface.co:8443/a")));
        assert!(!same_origin(&u("https://huggingface.co/a"), &u("https://cdn-lfs.huggingface.co/a")));
        assert!(!same_origin(&u("https://huggingface.co/a"), &u("https://huggingface.co.evil.example/a")));
    }
    #[test]
    fn the_sign_in_sheet_takes_a_secure_page_and_a_scheme_of_the_app() {
        let (url, scheme) = check_web_auth(" https://auth.example.org/authorize?provider=google ", " LU ").unwrap();
        assert_eq!(url.as_str(), "https://auth.example.org/authorize?provider=google");
        assert_eq!(scheme, "lu");
        assert!(check_web_auth("https://a.b/c", "com.example.app").is_ok());
        for page in ["http://a.b/c", "mailto:hi@example.com", "tel:+4930123456", "lu://oauth/callback", "file:///etc/passwd", "", "https://"] {
            assert!(check_web_auth(page, "lu").is_err(), "took the page {page}");
        }
        let long = "x".repeat(33);
        for scheme in ["", " ", "http", "https", "HTTPS", "file", "javascript", "data", "mailto", "tauri", "1lu", "lu:", "lu://", "l u", "l\u{00e4}", "a/b", long.as_str()] {
            assert!(check_web_auth("https://a.b/c", scheme).is_err(), "took the scheme {scheme:?}");
        }
    }

}
