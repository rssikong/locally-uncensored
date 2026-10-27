//! The access token of the in-process engine (engine_inproc.rs).
//!
//! On a phone the engine is an HTTP server on 127.0.0.1. Loopback is shared
//! by every app on the device, so without a token any other app could ask the
//! loaded model, read `/props`, or keep the processor busy. The token is drawn
//! once per start of the app, lives only in memory and travels in one header.
//!
//! Only this process knows it. The page never sees it: its requests go
//! through the Rust proxy (commands/proxy.rs), which adds the header here, and
//! only for a port this process has bound itself. A request to any other
//! loopback server (Ollama, ComfyUI, a stranger that took the port after the
//! engine stopped) never carries it.
//!
//! The desktop sidecar is untouched: nothing registers a port there, so
//! nothing is ever attached and nothing is ever asked for.

// The asking half is only called where the in-process engine is built.
#![cfg_attr(not(any(mobile, all(target_os = "macos", feature = "inproc-engine"))), allow(dead_code))]

use std::collections::BTreeSet;
use std::sync::{Mutex, OnceLock};

/// The header the engine asks for.
pub(crate) const HEADER: &str = "x-lu-engine-token";

static TOKEN: OnceLock<String> = OnceLock::new();
static PORTS: Mutex<BTreeSet<u16>> = Mutex::new(BTreeSet::new());

/// 32 random bytes from the operating system, as hex.
pub(crate) fn token() -> &'static str {
    TOKEN.get_or_init(|| {
        use rand::RngCore;
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    })
}

/// True when `given` is the token. The comparison takes the same time
/// wherever the first difference sits.
pub(crate) fn matches(given: &str) -> bool {
    let want = token().as_bytes();
    let got = given.as_bytes();
    if want.len() != got.len() {
        return false;
    }
    want.iter().zip(got).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

/// Holds a port in the list of the engine's own ports for as long as it
/// lives. Dropped when the server ends, so the token stops travelling there.
pub(crate) struct BoundPort(u16);

impl BoundPort {
    pub(crate) fn hold(port: u16) -> Self {
        if let Ok(mut ports) = PORTS.lock() {
            ports.insert(port);
        }
        Self(port)
    }
}

impl Drop for BoundPort {
    fn drop(&mut self) {
        if let Ok(mut ports) = PORTS.lock() {
            ports.remove(&self.0);
        }
    }
}

/// The token when `port` is one this process serves, else nothing.
pub(crate) fn token_for_port(port: u16) -> Option<&'static str> {
    let ours = PORTS.lock().map(|ports| ports.contains(&port)).unwrap_or(false);
    ours.then(token)
}

/// The token when `url` points at the engine of this process: plain http, the
/// loopback address the engine binds, and a port it holds.
pub(crate) fn token_for_url(url: &str) -> Option<&'static str> {
    let parsed = url::Url::parse(url).ok()?;
    if parsed.scheme() != "http" {
        return None;
    }
    let host = parsed.host_str()?;
    if host != "127.0.0.1" && !host.eq_ignore_ascii_case("localhost") {
        return None;
    }
    token_for_port(parsed.port()?)
}

/// Add the header to a request of the Rust proxy when it goes to the engine.
pub(crate) fn attach(request: reqwest::RequestBuilder, url: &str) -> reqwest::RequestBuilder {
    match token_for_url(url) {
        Some(token) => request.header(HEADER, token),
        None => request,
    }
}

/// The same for the blocking client of the health check and the probe.
pub(crate) fn attach_blocking(
    request: reqwest::blocking::RequestBuilder,
    port: u16,
) -> reqwest::blocking::RequestBuilder {
    match token_for_port(port) {
        Some(token) => request.header(HEADER, token),
        None => request,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_is_long_random_and_stable_within_one_start() {
        let first = token();
        assert_eq!(first.len(), 64);
        assert!(first.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(first, "0".repeat(64));
        assert_eq!(first, token());
        assert!(matches(first));
        assert!(!matches(""));
        assert!(!matches(&first[1..]));
        assert!(!matches(&"0".repeat(64)));
    }

    #[test]
    fn the_token_travels_only_to_a_port_this_process_holds() {
        // No port is held on a desktop: nothing is attached anywhere.
        assert_eq!(token_for_url("http://127.0.0.1:61001/v1/chat/completions"), None);
        {
            let _held = BoundPort::hold(61001);
            assert_eq!(token_for_url("http://127.0.0.1:61001/v1/chat/completions"), Some(token()));
            assert_eq!(token_for_url("http://localhost:61001/health"), Some(token()));
            assert_eq!(token_for_port(61001), Some(token()));
            // Another loopback server, another host with the same port, https.
            assert_eq!(token_for_url("http://127.0.0.1:11434/api/tags"), None);
            assert_eq!(token_for_url("http://192.168.1.20:61001/health"), None);
            assert_eq!(token_for_url("http://127.0.0.1.example.com:61001/health"), None);
            assert_eq!(token_for_url("http://user@example.com:61001@127.0.0.1/health"), None);
            assert_eq!(token_for_url("https://127.0.0.1:61001/health"), None);
            assert_eq!(token_for_url("not a url"), None);

            let with = attach(reqwest::Client::new().get("http://127.0.0.1:61001/health"), "http://127.0.0.1:61001/health")
                .build()
                .unwrap();
            assert_eq!(with.headers().get(HEADER).and_then(|v| v.to_str().ok()), Some(token()));
            let without = attach(reqwest::Client::new().get("http://127.0.0.1:11434/x"), "http://127.0.0.1:11434/x")
                .build()
                .unwrap();
            assert!(without.headers().get(HEADER).is_none());
        }
        // The server ended: whoever takes the port next does not get the token.
        assert_eq!(token_for_url("http://127.0.0.1:61001/health"), None);
    }
}
