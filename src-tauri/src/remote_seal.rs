//! Sealed remote channel between the LU phone app and the LU desktop app.
//!
//! The wire format is specified in `mobile-docs/remote/PROTOKOLL.md`
//! (REMOTE-PROTOKOLL v2, channel version 1). This module is the one
//! implementation both ends compile: the desktop server opens what the phone
//! seals and the other way round. It is pure on purpose: no network, no
//! file, no clock (the caller passes `now` in unix seconds), no platform code.
//! Key storage (Android Keystore, desktop keychain) stays with the caller,
//! which only ever stores the 32 byte [`DeviceSecret`].
//!
//! Building blocks, none of them home made:
//! - Handshake: Noise `IK` (known device) and `IKpsk1` (first pairing with
//!   the ticket from the QR code), X25519, ChaCha20-Poly1305, SHA-256, through
//!   the `snow` crate.
//! - Transport: snow's `StatelessTransportState` with an explicit 64 bit
//!   nonce per record, so parallel HTTP requests need no shared order, plus a
//!   sliding replay window (the IPsec / WireGuard bitmap, RFC 6479 style).
//! - Signatures for the address lookup and the phone sign-in: Ed25519 (ring).
//! - Key derivation from the one stored secret: HKDF-SHA256 (ring).

// Nothing calls this yet: the desktop route and the phone command come in the
// next rounds (see mobile-docs/remote/R50.md). Until then only the tests do.
#![allow(dead_code)]

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use ring::rand::{SecureRandom, SystemRandom};
use ring::signature::{Ed25519KeyPair, KeyPair as _, UnparsedPublicKey, ED25519};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use curve25519_dalek::montgomery::MontgomeryPoint;
use snow::params::{CipherChoice, DHChoice, HashChoice, NoiseParams};
use snow::resolvers::{CryptoResolver, RingResolver};
use snow::types::{Cipher, Dh, Hash, Random};
use snow::{Builder, HandshakeState, StatelessTransportState};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use zeroize::{Zeroize, Zeroizing};

// ---------------------------------------------------------------------------
// Constants (all part of the contract, see PROTOKOLL.md)
// ---------------------------------------------------------------------------

/// Version byte at the start of every frame.
pub const CHANNEL_VERSION: u8 = 1;
/// Version of the JSON inside the channel (hello payloads, inner messages).
pub const INNER_VERSION: u32 = 1;
/// Protocol number the desktop reports in `GET /remote-api/status`.
pub const PROTOCOL_VERSION: u32 = 2;
/// Feature word in the status list that says "this desktop speaks the channel".
pub const FEATURE_SEALED: &str = "sealed";

const NOISE_IK: &str = "Noise_IK_25519_ChaChaPoly_SHA256";
// psk1, not psk2: the ticket is mixed in at the end of the FIRST message, so
// the desktop can tell a wrong ticket before it answers or asks its user.
// With psk2 a wrong ticket would only show at the phone, after the answer.
const NOISE_IKPSK1: &str = "Noise_IKpsk1_25519_ChaChaPoly_SHA256";
const PROLOGUE: &[u8] = b"lu-remote-v1/prologue";

// Domain separation labels. Every hash, derivation and signature carries one,
// so a value made for one purpose is never valid for another.
const L_SEED_SALT: &[u8] = b"lu-remote-v1/seed";
const L_X25519: &[u8] = b"lu-remote-v1/x25519";
const L_ED25519: &[u8] = b"lu-remote-v1/ed25519";
const L_DESKTOP_ID: &[u8] = b"lu-remote-v1/desktop-id\n";
const L_DEVICE_ID: &[u8] = b"lu-remote-v1/device-id\n";
const L_TICKET_ID: &[u8] = b"lu-remote-v1/ticket-id\n";
const L_TICKET_PSK: &[u8] = b"lu-remote-v1/ticket-psk";
const L_CODE_PSK: &[u8] = b"lu-remote-v1/code-psk";
const L_SID: &[u8] = b"lu-remote-v1/sid\n";
const L_SAS: &[u8] = b"lu-remote-v1/sas\n";
const L_SAS_QR: &[u8] = b"lu-remote-v1/sas-qr\n";
const L_SAS_COMMIT: &[u8] = b"lu-remote-v1/sas-commit\n";
const L_ANNOUNCE: &str = "lu-remote-v1/announce";
const L_SIGNIN: &str = "lu-remote-v1/signin";
const L_BIND: &str = "lu-remote-v1/bind";

/// Frame kinds (second byte of every frame).
pub const KIND_HS_INIT: u8 = 0x01;
pub const KIND_HS_RESP: u8 = 0x02;
pub const KIND_DATA_TO_DESKTOP: u8 = 0x03;
pub const KIND_DATA_TO_PHONE: u8 = 0x04;

const HS_FLAG_TICKET: u8 = 0x01;
const HS_FLAG_CODE: u8 = 0x02;
const REC_FIRST: u8 = 0x01;
const REC_LAST: u8 = 0x02;

const SID_LEN: usize = 16;
const TAG_LEN: usize = 16;
const NOISE_MAX: usize = 65535;
/// Plaintext bytes per record: Noise maximum minus tag minus the flag byte.
pub const RECORD_DATA_MAX: usize = NOISE_MAX - TAG_LEN - 1;
/// Largest message (inner request or response, encoded) one HTTP body carries.
pub const MAX_MESSAGE: usize = 8 * 1024 * 1024;
/// Largest piece of a result file one `.../results/{id}` answer carries.
pub const MAX_CHUNK: usize = 4 * 1024 * 1024;
/// Upper bound for a sealed HTTP body, framing included. A desktop refuses
/// anything longer before it reads further.
pub const MAX_BODY: usize = MAX_MESSAGE + 64 * 1024;
const MAX_HELLO: usize = 4096;

/// Width of the replay window in nonces.
pub const REPLAY_WINDOW: u64 = 4096;
/// A session lives at most this long after its handshake.
pub const SESSION_MAX_AGE_SECS: u64 = 24 * 60 * 60;
/// The sender stops before this many records and asks for a new handshake.
pub const NONCE_LIMIT: u64 = 1 << 48;
/// A pairing ticket from the QR code is valid this long.
pub const TICKET_TTL_SECS: u64 = 5 * 60;
/// Allowed clock difference for signed announcements and sign-in proofs.
pub const MAX_CLOCK_SKEW_SECS: u64 = 5 * 60;

/// Request headers the desktop passes from an inner request to its router.
/// Every other header is dropped; `x-lu-device` is set by the desktop itself.
pub const INNER_HEADER_ALLOWLIST: &[&str] = &["accept", "content-type", "x-lu-app-version", "x-lu-filename"];
/// Header the desktop sets on every inner request: the paired device's id.
pub const DEVICE_HEADER: &str = "x-lu-device";
/// Response header on a `202` that says "not done yet, poll this token".
pub const PENDING_HEADER: &str = "x-lu-pending";
/// Path prefix the phone polls a pending answer under.
pub const PENDING_PATH_PREFIX: &str = "/remote-api/pending/";
/// Inner paths that must never be reached through the channel (no nesting,
/// no second door to the code login).
pub const FORBIDDEN_INNER_PATHS: &[&str] = &["/remote-api/sealed", "/remote-api/auth"];
const INNER_METHODS: &[&str] = &["GET", "POST", "PUT", "PATCH", "DELETE"];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Everything that can go wrong. [`SealError::code`] is the stable string
/// that goes over the wire and into the app's error texts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SealError {
    /// Frame too short, wrong layout, bad length field.
    BadFrame,
    /// Frame version byte is not [`CHANNEL_VERSION`].
    VersionUnsupported,
    /// Frame kind is not the one expected here (also: a frame sent back to
    /// its own sender).
    WrongKind,
    /// Handshake did not complete: wrong key, wrong ticket, tampered.
    HandshakeFailed,
    /// Pairing frame names a ticket the desktop does not have (or no longer),
    /// or a code pairing while no code is shown.
    UnknownTicket,
    /// The desktop in the answer is not the pinned desktop.
    WrongDesktop,
    /// The phone's key binding signature does not verify.
    BadBinding,
    /// Data frame for another session id.
    SessionMismatch,
    /// Session older than [`SESSION_MAX_AGE_SECS`].
    SessionExpired,
    /// Send nonce reached [`NONCE_LIMIT`].
    SessionExhausted,
    /// Record failed authentication (tampered or wrong key).
    Decrypt,
    /// Nonce seen before or too old for the window.
    Replay,
    /// Records missing, reordered or cut.
    BadSequence,
    /// Message larger than allowed.
    TooLarge,
    /// Base64, key or id with a wrong shape.
    BadEncoding,
    /// Signature does not verify.
    BadSignature,
    /// Signed time too far from now.
    ClockSkew,
    /// Address outside the allowed form.
    BadAddress,
    /// Inner request or response not acceptable (method, header, JSON).
    BadInner,
    /// Inner path forbidden or malformed.
    ForbiddenPath,
    /// Response does not belong to the request.
    ResponseMismatch,
    /// Pairing link malformed.
    BadLink,
    /// No randomness from the OS.
    Rng,
    /// The phone's reveal for the comparison code does not match the
    /// commitment from its first message (or the session has none).
    BadReveal,
}

impl SealError {
    pub fn code(&self) -> &'static str {
        match self {
            SealError::BadFrame => "bad_frame",
            SealError::VersionUnsupported => "version_unsupported",
            SealError::WrongKind => "wrong_kind",
            SealError::HandshakeFailed => "handshake_failed",
            SealError::UnknownTicket => "unknown_ticket",
            SealError::WrongDesktop => "wrong_desktop",
            SealError::BadBinding => "bad_binding",
            SealError::SessionMismatch => "session_unknown",
            SealError::SessionExpired => "session_expired",
            SealError::SessionExhausted => "session_expired",
            SealError::Decrypt => "decrypt_failed",
            SealError::Replay => "replay",
            SealError::BadSequence => "bad_sequence",
            SealError::TooLarge => "too_large",
            SealError::BadEncoding => "bad_encoding",
            SealError::BadSignature => "bad_signature",
            SealError::ClockSkew => "clock_skew",
            SealError::BadAddress => "bad_address",
            SealError::BadInner => "bad_inner",
            SealError::ForbiddenPath => "forbidden_path",
            SealError::ResponseMismatch => "response_mismatch",
            SealError::BadLink => "bad_link",
            SealError::Rng => "rng",
            SealError::BadReveal => "bad_reveal",
        }
    }
}

impl std::fmt::Display for SealError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.code())
    }
}

impl std::error::Error for SealError {}

pub type SealResult<T> = Result<T, SealError>;

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

/// base64url without padding, the one text encoding for keys, ids and
/// signatures in this protocol.
pub fn b64(bytes: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(bytes)
}

/// Strict decode: no padding, no foreign alphabet, canonical trailing bits,
/// exact length.
pub fn b64_decode_exact<const N: usize>(text: &str) -> SealResult<[u8; N]> {
    let raw = URL_SAFE_NO_PAD
        .decode(text.as_bytes())
        .map_err(|_| SealError::BadEncoding)?;
    if raw.len() != N || b64(&raw) != text {
        return Err(SealError::BadEncoding);
    }
    let mut out = [0u8; N];
    out.copy_from_slice(&raw);
    Ok(out)
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = Sha256::new();
    for p in parts {
        h.update(p);
    }
    h.finalize().into()
}

fn random_bytes<const N: usize>() -> SealResult<[u8; N]> {
    let mut out = [0u8; N];
    SystemRandom::new()
        .fill(&mut out)
        .map_err(|_| SealError::Rng)?;
    Ok(out)
}

struct HkdfLen(usize);

impl ring::hkdf::KeyType for HkdfLen {
    fn len(&self) -> usize {
        self.0
    }
}

fn hkdf32(ikm: &[u8], salt: &[u8], info: &[u8]) -> Zeroizing<[u8; 32]> {
    let prk = ring::hkdf::Salt::new(ring::hkdf::HKDF_SHA256, salt).extract(ikm);
    let mut out = Zeroizing::new([0u8; 32]);
    prk.expand(&[info], HkdfLen(32))
        .and_then(|okm| okm.fill(&mut out[..]))
        .expect("HKDF-SHA256 gives 32 bytes");
    out
}

/// X25519 for snow, on curve25519-dalek. The same two calls snow's own
/// default resolver makes (`mul_base_clamped`, `mul_clamped`), plus the
/// optional Noise check that refuses an all-zero result (low order point).
#[derive(Default)]
struct Dh25519 {
    private: Zeroizing<[u8; 32]>,
    public: [u8; 32],
}

impl Dh for Dh25519 {
    fn name(&self) -> &'static str {
        "25519"
    }

    fn pub_len(&self) -> usize {
        32
    }

    fn priv_len(&self) -> usize {
        32
    }

    fn set(&mut self, privkey: &[u8]) {
        self.private.copy_from_slice(&privkey[..32]);
        self.public = x25519_public_from_private(&self.private);
    }

    fn generate(&mut self, rng: &mut dyn Random) -> Result<(), snow::Error> {
        rng.try_fill_bytes(&mut self.private[..])?;
        self.public = x25519_public_from_private(&self.private);
        Ok(())
    }

    fn pubkey(&self) -> &[u8] {
        &self.public
    }

    fn privkey(&self) -> &[u8] {
        &self.private[..]
    }

    fn dh(&self, pubkey: &[u8], out: &mut [u8]) -> Result<(), snow::Error> {
        if pubkey.len() < 32 || out.len() < 32 {
            return Err(snow::Error::Dh);
        }
        let mut theirs = [0u8; 32];
        theirs.copy_from_slice(&pubkey[..32]);
        let shared = Zeroizing::new(MontgomeryPoint(theirs).mul_clamped(*self.private).to_bytes());
        if shared.iter().all(|&b| b == 0) {
            return Err(snow::Error::Dh);
        }
        out[..32].copy_from_slice(&shared[..]);
        Ok(())
    }
}

/// ring for randomness, SHA-256 and ChaCha20-Poly1305; [`Dh25519`] for X25519.
struct Resolver;

impl CryptoResolver for Resolver {
    fn resolve_rng(&self) -> Option<Box<dyn Random>> {
        RingResolver.resolve_rng()
    }

    fn resolve_dh(&self, choice: &DHChoice) -> Option<Box<dyn Dh>> {
        match choice {
            DHChoice::Curve25519 => Some(Box::<Dh25519>::default()),
            _ => None,
        }
    }

    fn resolve_hash(&self, choice: &HashChoice) -> Option<Box<dyn Hash>> {
        RingResolver.resolve_hash(choice)
    }

    fn resolve_cipher(&self, choice: &CipherChoice) -> Option<Box<dyn Cipher>> {
        RingResolver.resolve_cipher(choice)
    }
}

fn x25519_public_from_private(private: &[u8; 32]) -> [u8; 32] {
    MontgomeryPoint::mul_base_clamped(*private).to_bytes()
}

// ---------------------------------------------------------------------------
// Device keys
// ---------------------------------------------------------------------------

/// The one long lived secret of a device (phone or desktop). 32 random bytes;
/// the X25519 key of the handshake and the Ed25519 signing key are derived
/// from it with HKDF and distinct labels. Store it in the Android Keystore or
/// the desktop keychain, nowhere else.
pub struct DeviceSecret(Zeroizing<[u8; 32]>);

impl DeviceSecret {
    pub fn generate() -> SealResult<Self> {
        Ok(Self(Zeroizing::new(random_bytes::<32>()?)))
    }

    pub fn from_bytes(bytes: [u8; 32]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    /// Text form for the secure store.
    pub fn to_b64(&self) -> Zeroizing<String> {
        Zeroizing::new(b64(&self.0[..]))
    }

    pub fn from_b64(text: &str) -> SealResult<Self> {
        let mut raw = b64_decode_exact::<32>(text)?;
        let me = Self::from_bytes(raw);
        raw.zeroize();
        Ok(me)
    }

    fn x25519_private(&self) -> Zeroizing<[u8; 32]> {
        hkdf32(&self.0[..], L_SEED_SALT, L_X25519)
    }

    pub fn x25519_public(&self) -> [u8; 32] {
        x25519_public_from_private(&self.x25519_private())
    }

    fn ed25519(&self) -> Ed25519KeyPair {
        let seed = hkdf32(&self.0[..], L_SEED_SALT, L_ED25519);
        Ed25519KeyPair::from_seed_unchecked(&seed[..]).expect("any 32 bytes are an Ed25519 seed")
    }

    pub fn ed25519_public(&self) -> [u8; 32] {
        let mut out = [0u8; 32];
        out.copy_from_slice(self.ed25519().public_key().as_ref());
        out
    }

    fn sign(&self, message: &[u8]) -> [u8; 64] {
        let mut out = [0u8; 64];
        out.copy_from_slice(self.ed25519().sign(message).as_ref());
        out
    }

    /// Id of this device in its desktop role (address lookup, QR).
    pub fn desktop_id(&self) -> String {
        desktop_id_from_ed25519(&self.ed25519_public())
    }

    /// Id of this device in its phone role (paired device list, `x-lu-device`).
    pub fn device_id(&self) -> String {
        device_id_from_x25519(&self.x25519_public())
    }
}

/// `desktop_id` = base64url(SHA-256("lu-remote-v1/desktop-id\n" || ed25519_pub)[0..16]),
/// 22 characters. Anyone holding the public key can check the id, so the
/// lookup service never has to trust a first registration blindly.
pub fn desktop_id_from_ed25519(ed25519_pub: &[u8; 32]) -> String {
    b64(&sha256(&[L_DESKTOP_ID, ed25519_pub])[..16])
}

/// Device id of a phone, from its Noise static key (the key the channel
/// authenticates), 22 characters.
pub fn device_id_from_x25519(x25519_pub: &[u8; 32]) -> String {
    b64(&sha256(&[L_DEVICE_ID, x25519_pub])[..16])
}

/// Shape check for a 22 character id (16 bytes, canonical base64url).
pub fn check_id(id: &str) -> SealResult<()> {
    b64_decode_exact::<16>(id).map(|_| ())
}

// ---------------------------------------------------------------------------
// Signatures (address lookup, sign-in, key binding)
// ---------------------------------------------------------------------------

/// Allowed address for the lookup service: `https://<label>.trycloudflare.com`,
/// lower case, no port, no path, no trailing slash.
pub fn check_tunnel_address(address: &str) -> SealResult<()> {
    let host = address
        .strip_prefix("https://")
        .and_then(|rest| rest.strip_suffix(".trycloudflare.com"))
        .ok_or(SealError::BadAddress)?;
    let ok = !host.is_empty()
        && host.len() <= 63
        && !host.starts_with('-')
        && !host.ends_with('-')
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(SealError::BadAddress)
    }
}

fn check_skew(time: u64, now: u64) -> SealResult<()> {
    if time.abs_diff(now) > MAX_CLOCK_SKEW_SECS {
        Err(SealError::ClockSkew)
    } else {
        Ok(())
    }
}

fn verify_ed25519(public: &[u8; 32], message: &[u8], signature: &[u8; 64]) -> SealResult<()> {
    UnparsedPublicKey::new(&ED25519, public)
        .verify(message, signature)
        .map_err(|_| SealError::BadSignature)
}

/// A desktop's signed "my tunnel address is now ..." for lu-labs.ai.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Announce {
    pub desktop_id: String,
    pub ed25519_pub: String,
    pub address: String,
    pub time: u64,
    pub signature: String,
}

/// The exact signed bytes: UTF-8 of
/// `lu-remote-v1/announce\n<desktop_id>\n<ed25519_pub>\n<address>\n<time>`,
/// no trailing newline, time in decimal unix seconds. All fields are
/// validated first, so none can carry a newline.
pub fn announce_message(desktop_id: &str, ed25519_pub: &str, address: &str, time: u64) -> SealResult<Vec<u8>> {
    check_id(desktop_id)?;
    b64_decode_exact::<32>(ed25519_pub)?;
    check_tunnel_address(address)?;
    Ok(format!("{L_ANNOUNCE}\n{desktop_id}\n{ed25519_pub}\n{address}\n{time}").into_bytes())
}

pub fn sign_announce(secret: &DeviceSecret, address: &str, time: u64) -> SealResult<Announce> {
    let desktop_id = secret.desktop_id();
    let ed25519_pub = b64(&secret.ed25519_public());
    let msg = announce_message(&desktop_id, &ed25519_pub, address, time)?;
    Ok(Announce {
        signature: b64(&secret.sign(&msg)),
        desktop_id,
        ed25519_pub,
        address: address.to_string(),
        time,
    })
}

/// What the lookup service checks: shapes, id belongs to the key, time
/// within skew, signature. The first-key-wins rule (TOFU) and the 7 day
/// expiry are the service's own state and not in here.
pub fn verify_announce(a: &Announce, now: u64) -> SealResult<()> {
    let msg = announce_message(&a.desktop_id, &a.ed25519_pub, &a.address, a.time)?;
    let public = b64_decode_exact::<32>(&a.ed25519_pub)?;
    if desktop_id_from_ed25519(&public) != a.desktop_id {
        return Err(SealError::BadSignature);
    }
    check_skew(a.time, now)?;
    let sig = b64_decode_exact::<64>(&a.signature)?;
    verify_ed25519(&public, &msg, &sig)
}

/// Shape of a sign-in code: 16 to 128 characters of the base64url alphabet.
pub fn check_signin_code(code: &str) -> SealResult<()> {
    let ok = (16..=128).contains(&code.len())
        && code
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if ok {
        Ok(())
    } else {
        Err(SealError::BadEncoding)
    }
}

/// Signed bytes for redeeming a sign-in code:
/// `lu-remote-v1/signin\n<code>\n<time>`.
pub fn signin_message(code: &str, time: u64) -> SealResult<Vec<u8>> {
    check_signin_code(code)?;
    Ok(format!("{L_SIGNIN}\n{code}\n{time}").into_bytes())
}

/// The phone's proof for `POST /api/device-signin/redeem`.
pub fn sign_signin(secret: &DeviceSecret, code: &str, time: u64) -> SealResult<String> {
    Ok(b64(&secret.sign(&signin_message(code, time)?)))
}

pub fn verify_signin(ed25519_pub: &str, code: &str, time: u64, signature: &str, now: u64) -> SealResult<()> {
    let msg = signin_message(code, time)?;
    let public = b64_decode_exact::<32>(ed25519_pub)?;
    check_skew(time, now)?;
    let sig = b64_decode_exact::<64>(signature)?;
    verify_ed25519(&public, &msg, &sig)
}

/// Signed bytes that tie a phone's Ed25519 key to its X25519 key:
/// `lu-remote-v1/bind\n<x25519_pub>`.
pub fn bind_message(x25519_pub: &[u8; 32]) -> Vec<u8> {
    format!("{L_BIND}\n{}", b64(x25519_pub)).into_bytes()
}

pub fn sign_bind(secret: &DeviceSecret) -> String {
    b64(&secret.sign(&bind_message(&secret.x25519_public())))
}

pub fn verify_bind(ed25519_pub: &str, x25519_pub: &[u8; 32], signature: &str) -> SealResult<()> {
    let public = b64_decode_exact::<32>(ed25519_pub)?;
    let sig = b64_decode_exact::<64>(signature)?;
    verify_ed25519(&public, &bind_message(x25519_pub), &sig).map_err(|_| SealError::BadBinding)
}

// ---------------------------------------------------------------------------
// Pairing ticket and QR link
// ---------------------------------------------------------------------------

/// One-time pairing secret shown in the QR code (128 bit, 5 minutes, once).
#[derive(Clone)]
pub struct Ticket(Zeroizing<[u8; 16]>);

impl Ticket {
    pub fn generate() -> SealResult<Self> {
        Ok(Self(Zeroizing::new(random_bytes::<16>()?)))
    }

    pub fn from_bytes(bytes: [u8; 16]) -> Self {
        Self(Zeroizing::new(bytes))
    }

    pub fn from_b64(text: &str) -> SealResult<Self> {
        Ok(Self::from_bytes(b64_decode_exact::<16>(text)?))
    }

    pub fn to_b64(&self) -> String {
        b64(&self.0[..])
    }

    /// Public handle in the pairing frame header, so the desktop knows which
    /// pre-shared key to use. SHA-256("lu-remote-v1/ticket-id\n" || ticket)[0..8].
    pub fn id(&self) -> [u8; 8] {
        let h = sha256(&[L_TICKET_ID, &self.0[..]]);
        let mut out = [0u8; 8];
        out.copy_from_slice(&h[..8]);
        out
    }

    /// Noise psk: HKDF-SHA256(ikm = ticket, salt = "lu-remote-v1/seed",
    /// info = "lu-remote-v1/ticket-psk").
    pub fn psk(&self) -> Zeroizing<[u8; 32]> {
        hkdf32(&self.0[..], L_SEED_SALT, L_TICKET_PSK)
    }
}

/// The six digit code of the LAN-only typed pairing. Never over the
/// internet (decision E2): six digits are a weak secret, the comparison code
/// ([`Session::sas`]) on both screens is what stops a man in the middle.
pub fn check_pairing_code(code: &str) -> SealResult<()> {
    if code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()) {
        Ok(())
    } else {
        Err(SealError::BadEncoding)
    }
}

/// The extra secret of a first pairing.
#[derive(Clone)]
pub enum PairingSecret {
    /// From the QR code (internet and LAN).
    Ticket(Ticket),
    /// Typed six digit code (LAN only).
    Code(Zeroizing<String>),
}

/// What the pairing frame says about its secret, without revealing it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PairingRef {
    Ticket([u8; 8]),
    Code,
}

impl PairingSecret {
    pub fn code(code: &str) -> SealResult<Self> {
        check_pairing_code(code)?;
        Ok(Self::Code(Zeroizing::new(code.to_string())))
    }

    fn psk(&self) -> Zeroizing<[u8; 32]> {
        match self {
            Self::Ticket(t) => t.psk(),
            Self::Code(c) => hkdf32(c.as_bytes(), L_SEED_SALT, L_CODE_PSK),
        }
    }

    fn reference(&self) -> PairingRef {
        match self {
            Self::Ticket(t) => PairingRef::Ticket(t.id()),
            Self::Code(_) => PairingRef::Code,
        }
    }
}

/// Content of the QR code, `lu://remote?v=2&id=..&k=..&t=..&n=..&lan=..&net=..`.
#[derive(Clone)]
pub struct PairingLink {
    pub desktop_id: String,
    pub desktop_x25519: [u8; 32],
    pub ticket: Ticket,
    pub name: String,
    pub lan: Option<String>,
    pub tunnel: Option<String>,
}

const MAX_NAME: usize = 64;
/// Byte cap next to the character cap: 64 characters of at most 4 bytes.
const MAX_NAME_BYTES: usize = 256;

fn check_lan_address(addr: &str) -> SealResult<()> {
    let u = url::Url::parse(addr).map_err(|_| SealError::BadLink)?;
    let plain = u.scheme() == "http"
        && u.host_str().is_some()
        && u.port().is_some()
        && u.path() == "/"
        && u.query().is_none()
        && u.fragment().is_none()
        && u.username().is_empty()
        && u.password().is_none()
        && !addr.ends_with('/');
    if plain {
        Ok(())
    } else {
        Err(SealError::BadLink)
    }
}

/// Unicode general category Cf (format), from the fixed list of assigned
/// ranges (Unicode 16). No extra crate: the list is short and changes
/// rarely; a later Cf code point still has to pass the other checks.
pub(crate) fn is_format_char(c: char) -> bool {
    matches!(
        c as u32,
        0x00AD
            | 0x0600..=0x0605
            | 0x061C
            | 0x06DD
            | 0x070F
            | 0x0890..=0x0891
            | 0x08E2
            | 0x180E
            | 0x200B..=0x200F
            | 0x202A..=0x202E
            | 0x2060..=0x206F
            | 0xFEFF
            | 0xFFF9..=0xFFFB
            | 0x110BD
            | 0x110CD
            | 0x13430..=0x1343F
            | 0x1BCA0..=0x1BCA3
            | 0x1D173..=0x1D17A
            | 0xE0001
            | 0xE0020..=0xE007F
    )
}

/// Characters a device name may not carry: controls (Cc), format (Cf, so
/// zero width and bidi controls), line and paragraph separators (Zl, Zp).
pub(crate) fn is_forbidden_name_char(c: char) -> bool {
    c.is_control() || is_format_char(c) || c == '\u{2028}' || c == '\u{2029}'
}

/// Checks a device name and returns it normalized: no forbidden character
/// (checked on the raw value), trimmed, every run of white space one plain
/// space, then 1 to 64 characters and at most 256 bytes.
fn normalize_name(name: &str) -> SealResult<String> {
    if name.chars().any(is_forbidden_name_char) {
        return Err(SealError::BadLink);
    }
    let out = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if out.is_empty() || out.chars().count() > MAX_NAME || out.len() > MAX_NAME_BYTES {
        Err(SealError::BadLink)
    } else {
        Ok(out)
    }
}

/// Short plain value from the phone hello (`platform`, `app_version`):
/// 1 to 32 visible ASCII characters, so nothing odd reaches a dialog or log.
fn check_token(value: &str) -> SealResult<()> {
    if !value.is_empty() && value.len() <= 32 && value.bytes().all(|b| b.is_ascii_graphic()) {
        Ok(())
    } else {
        Err(SealError::BadInner)
    }
}

impl PairingLink {
    pub fn to_uri(&self) -> SealResult<String> {
        check_id(&self.desktop_id)?;
        let name = normalize_name(&self.name)?;
        let mut q = url::form_urlencoded::Serializer::new(String::new());
        q.append_pair("v", "2")
            .append_pair("id", &self.desktop_id)
            .append_pair("k", &b64(&self.desktop_x25519))
            .append_pair("t", &self.ticket.to_b64())
            .append_pair("n", &name);
        if let Some(lan) = &self.lan {
            check_lan_address(lan)?;
            q.append_pair("lan", lan);
        }
        if let Some(net) = &self.tunnel {
            check_tunnel_address(net).map_err(|_| SealError::BadLink)?;
            q.append_pair("net", net);
        }
        if self.lan.is_none() && self.tunnel.is_none() {
            return Err(SealError::BadLink);
        }
        Ok(format!("lu://remote?{}", q.finish()))
    }

    pub fn parse(uri: &str) -> SealResult<Self> {
        let query = uri.strip_prefix("lu://remote?").ok_or(SealError::BadLink)?;
        let mut v = None;
        let mut id = None;
        let mut k = None;
        let mut t = None;
        let mut n = None;
        let mut lan = None;
        let mut net = None;
        for (key, value) in url::form_urlencoded::parse(query.as_bytes()) {
            let slot = match key.as_ref() {
                "v" => &mut v,
                "id" => &mut id,
                "k" => &mut k,
                "t" => &mut t,
                "n" => &mut n,
                "lan" => &mut lan,
                "net" => &mut net,
                // Unknown keys are ignored so a later version can add some.
                _ => continue,
            };
            if slot.is_some() {
                return Err(SealError::BadLink);
            }
            *slot = Some(value.into_owned());
        }
        if v.as_deref() != Some("2") {
            return Err(SealError::BadLink);
        }
        let desktop_id = id.ok_or(SealError::BadLink)?;
        check_id(&desktop_id).map_err(|_| SealError::BadLink)?;
        let desktop_x25519 = b64_decode_exact::<32>(&k.ok_or(SealError::BadLink)?).map_err(|_| SealError::BadLink)?;
        let ticket = Ticket::from_b64(&t.ok_or(SealError::BadLink)?).map_err(|_| SealError::BadLink)?;
        let name = normalize_name(&n.ok_or(SealError::BadLink)?)?;
        if let Some(l) = &lan {
            check_lan_address(l)?;
        }
        if let Some(a) = &net {
            check_tunnel_address(a).map_err(|_| SealError::BadLink)?;
        }
        if lan.is_none() && net.is_none() {
            return Err(SealError::BadLink);
        }
        Ok(Self {
            desktop_id,
            desktop_x25519,
            ticket,
            name,
            lan,
            tunnel: net,
        })
    }
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

/// Payload of the phone's first handshake message (encrypted by Noise).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PhoneHello {
    pub v: u32,
    /// Shown in the desktop's confirmation dialog and device list.
    pub name: String,
    /// "android", "ios" ...
    pub platform: String,
    pub app_version: String,
    /// The phone's Ed25519 key (for the sign-in code at lu-labs.ai).
    pub ed25519_pub: String,
    /// Ed25519 signature over [`bind_message`] of the phone's X25519 key.
    pub bind: String,
    /// Code pairing only: commitment to the phone's comparison code nonce,
    /// base64url(SHA-256("lu-remote-v1/sas-commit\n" || nonce)). Set by
    /// [`PhoneHandshake::start`]; whatever the caller puts here is replaced.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sas_commit: Option<String>,
}

impl PhoneHello {
    pub fn new(secret: &DeviceSecret, name: &str, platform: &str, app_version: &str) -> Self {
        Self {
            v: INNER_VERSION,
            name: name.to_string(),
            platform: platform.to_string(),
            app_version: app_version.to_string(),
            ed25519_pub: b64(&secret.ed25519_public()),
            bind: sign_bind(secret),
            sas_commit: None,
        }
    }
}

/// Pairing state the desktop reports in its handshake answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PairState {
    /// Known device, the session may be used right away.
    Paired,
    /// New pairing, waiting for the human at the desktop.
    Pending,
}

/// Payload of the desktop's handshake answer (encrypted by Noise).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DesktopHello {
    pub v: u32,
    pub desktop_id: String,
    pub ed25519_pub: String,
    pub name: String,
    pub state: PairState,
    pub features: Vec<String>,
    /// Unix seconds when the desktop drops this session.
    pub expires: u64,
}

impl DesktopHello {
    pub fn new(secret: &DeviceSecret, name: &str, state: PairState, features: Vec<String>, now: u64) -> Self {
        Self {
            v: INNER_VERSION,
            desktop_id: secret.desktop_id(),
            ed25519_pub: b64(&secret.ed25519_public()),
            name: name.to_string(),
            state,
            features,
            expires: now.saturating_add(SESSION_MAX_AGE_SECS),
        }
    }
}

fn builder<'a>(pattern: &str) -> Builder<'a> {
    let params: NoiseParams = pattern.parse().expect("pattern names are constants");
    Builder::with_resolver(params, Box::new(Resolver))
}

fn hs_err(_: snow::Error) -> SealError {
    SealError::HandshakeFailed
}

/// Phone side of a handshake in progress.
pub struct PhoneHandshake {
    hs: HandshakeState,
    expected_desktop_id: String,
    desktop_x25519: [u8; 32],
    /// Code pairing only: the nonce the phone committed to in its hello and
    /// reveals after the answer (see [`Session::sas_reveal`]).
    sas_nonce: Option<Zeroizing<[u8; 32]>>,
    /// QR pairing (ticket): comparison code straight from the handshake hash.
    qr: bool,
}

impl PhoneHandshake {
    /// Starts a handshake to a pinned desktop. `pairing` is `Some` only for
    /// the first pairing (ticket from the QR code, or the typed code in the
    /// LAN). Returns the HTTP body to POST.
    pub fn start(
        secret: &DeviceSecret,
        desktop_id: &str,
        desktop_x25519: &[u8; 32],
        pairing: Option<&PairingSecret>,
        hello: &PhoneHello,
    ) -> SealResult<(Self, Vec<u8>)> {
        Self::start_inner(secret, desktop_id, desktop_x25519, pairing, hello, None)
    }

    fn start_inner(
        secret: &DeviceSecret,
        desktop_id: &str,
        desktop_x25519: &[u8; 32],
        pairing: Option<&PairingSecret>,
        hello: &PhoneHello,
        fixed_ephemeral: Option<&[u8; 32]>,
    ) -> SealResult<(Self, Vec<u8>)> {
        check_id(desktop_id)?;
        let private = secret.x25519_private();
        let psk = pairing.map(PairingSecret::psk);
        let mut b = builder(if pairing.is_some() { NOISE_IKPSK1 } else { NOISE_IK })
            .local_private_key(&private[..])
            .and_then(|b| b.remote_public_key(desktop_x25519))
            .and_then(|b| b.prologue(PROLOGUE))
            .map_err(hs_err)?;
        if let Some(psk) = &psk {
            b = b.psk(1, psk).map_err(hs_err)?;
        }
        if let Some(e) = fixed_ephemeral {
            b = b.fixed_ephemeral_key_for_testing_only(e);
        }
        let mut hs = b.build_initiator().map_err(hs_err)?;
        // Code pairing: commit to a fresh nonce now, reveal it only after the
        // answer. The answering side then cannot steer the comparison code by
        // trying ephemeral keys (it moves last in the handshake).
        let sas_nonce = match pairing {
            Some(PairingSecret::Code(_)) => Some(Zeroizing::new(random_bytes::<32>()?)),
            _ => None,
        };
        let mut hello = hello.clone();
        hello.sas_commit = sas_nonce.as_ref().map(|n| b64(&sas_commitment(n)));
        let payload = serde_json::to_vec(&hello).map_err(|_| SealError::BadInner)?;
        if payload.len() > MAX_HELLO {
            return Err(SealError::TooLarge);
        }
        let mut frame = vec![CHANNEL_VERSION, KIND_HS_INIT];
        match pairing.map(PairingSecret::reference) {
            Some(PairingRef::Ticket(id)) => {
                frame.push(HS_FLAG_TICKET);
                frame.extend_from_slice(&id);
            }
            Some(PairingRef::Code) => frame.push(HS_FLAG_CODE),
            None => frame.push(0),
        }
        let mut buf = vec![0u8; NOISE_MAX];
        let n = hs.write_message(&payload, &mut buf).map_err(hs_err)?;
        frame.extend_from_slice(&buf[..n]);
        Ok((
            Self {
                hs,
                expected_desktop_id: desktop_id.to_string(),
                desktop_x25519: *desktop_x25519,
                sas_nonce,
                qr: matches!(pairing, Some(PairingSecret::Ticket(_))),
            },
            frame,
        ))
    }

    /// Reads the desktop's answer. Checks that the desktop is the pinned one
    /// (Noise already proved the X25519 key; the Ed25519 key in the hello
    /// must hash to the pinned desktop id).
    pub fn finish(mut self, body: &[u8], now: u64) -> SealResult<(Session, DesktopHello)> {
        let msg = frame_head(body, KIND_HS_RESP)?;
        let mut buf = vec![0u8; NOISE_MAX];
        let n = self.hs.read_message(msg, &mut buf).map_err(hs_err)?;
        let mut hello: DesktopHello = serde_json::from_slice(&buf[..n]).map_err(|_| SealError::BadInner)?;
        if hello.v != INNER_VERSION {
            return Err(SealError::VersionUnsupported);
        }
        hello.name = normalize_name(&hello.name).map_err(|_| SealError::BadInner)?;
        let ed = b64_decode_exact::<32>(&hello.ed25519_pub).map_err(|_| SealError::WrongDesktop)?;
        if hello.desktop_id != self.expected_desktop_id || desktop_id_from_ed25519(&ed) != hello.desktop_id {
            return Err(SealError::WrongDesktop);
        }
        let sas = match (self.sas_nonce.take(), self.qr) {
            (Some(n), _) => SasMode::PhoneNonce(n),
            (None, true) => SasMode::Qr,
            (None, false) => SasMode::None,
        };
        let session = Session::from_handshake(self.hs, Role::Phone, now, self.desktop_x25519, sas)?;
        Ok((session, hello))
    }
}

/// Desktop side: the phone's first message, read and checked, not yet
/// answered. The caller decides (known device? pairing allowed?) and then
/// calls [`DesktopHandshake::respond`], or drops it.
pub struct DesktopHandshake {
    hs: HandshakeState,
    pairing: Option<PairingRef>,
    phone_x25519: [u8; 32],
    hello: PhoneHello,
    sas_commit: Option<[u8; 32]>,
}

impl DesktopHandshake {
    /// `lookup` is called only for a pairing frame. It gets the ticket id
    /// (or "code") and returns the open secret, which it should then mark as
    /// used: a ticket works once; a failed code counts as a failed attempt
    /// for the caller's lockout.
    pub fn read_init(
        secret: &DeviceSecret,
        body: &[u8],
        lookup: impl FnOnce(PairingRef) -> Option<PairingSecret>,
    ) -> SealResult<Self> {
        Self::read_init_inner(secret, body, lookup, None)
    }

    fn read_init_inner(
        secret: &DeviceSecret,
        body: &[u8],
        lookup: impl FnOnce(PairingRef) -> Option<PairingSecret>,
        fixed_ephemeral: Option<&[u8; 32]>,
    ) -> SealResult<Self> {
        let rest = frame_head(body, KIND_HS_INIT)?;
        let (&flags, rest) = rest.split_first().ok_or(SealError::BadFrame)?;
        let private = secret.x25519_private();
        let (pairing, msg) = match flags {
            0 => (None, rest),
            HS_FLAG_TICKET => {
                if rest.len() < 8 {
                    return Err(SealError::BadFrame);
                }
                let mut id = [0u8; 8];
                id.copy_from_slice(&rest[..8]);
                (Some(PairingRef::Ticket(id)), &rest[8..])
            }
            HS_FLAG_CODE => (Some(PairingRef::Code), rest),
            _ => return Err(SealError::BadFrame),
        };
        let found = match pairing {
            Some(r) => {
                let found = lookup(r).ok_or(SealError::UnknownTicket)?;
                // The secret must be of the kind (and for a ticket, the id)
                // the frame names.
                if found.reference() != r {
                    return Err(SealError::UnknownTicket);
                }
                Some(found)
            }
            None => None,
        };
        let psk = found.as_ref().map(PairingSecret::psk);
        let mut b = builder(if pairing.is_some() { NOISE_IKPSK1 } else { NOISE_IK })
            .local_private_key(&private[..])
            .and_then(|b| b.prologue(PROLOGUE))
            .map_err(hs_err)?;
        if let Some(psk) = &psk {
            b = b.psk(1, psk).map_err(hs_err)?;
        }
        if let Some(e) = fixed_ephemeral {
            b = b.fixed_ephemeral_key_for_testing_only(e);
        }
        let mut hs = b.build_responder().map_err(hs_err)?;
        let mut buf = vec![0u8; NOISE_MAX];
        let n = hs.read_message(msg, &mut buf).map_err(hs_err)?;
        let mut hello: PhoneHello = serde_json::from_slice(&buf[..n]).map_err(|_| SealError::BadInner)?;
        let rs = hs.get_remote_static().ok_or(SealError::HandshakeFailed)?;
        let mut phone_x25519 = [0u8; 32];
        phone_x25519.copy_from_slice(rs);
        if hello.v != INNER_VERSION {
            return Err(SealError::VersionUnsupported);
        }
        verify_bind(&hello.ed25519_pub, &phone_x25519, &hello.bind)?;
        hello.name = normalize_name(&hello.name).map_err(|_| SealError::BadInner)?;
        check_token(&hello.platform)?;
        check_token(&hello.app_version)?;
        // The code path needs the phone's commitment; the others ignore it.
        let sas_commit = if pairing == Some(PairingRef::Code) {
            let c = hello.sas_commit.as_deref().ok_or(SealError::BadInner)?;
            Some(b64_decode_exact::<32>(c).map_err(|_| SealError::BadInner)?)
        } else {
            None
        };
        Ok(Self {
            hs,
            pairing,
            phone_x25519,
            hello,
            sas_commit,
        })
    }

    /// True for a first pairing (ticket or code used), false for a known device.
    pub fn is_pairing(&self) -> bool {
        self.pairing.is_some()
    }

    /// How the phone paired: `Some(Code)` means the desktop must show the
    /// comparison code in its confirmation dialog, and may only ask its user
    /// after the phone's reveal ([`Session::accept_sas_reveal`]). A code that
    /// got this far (first message decrypted) is used up: show a new one for
    /// the next attempt.
    pub fn pairing(&self) -> Option<PairingRef> {
        self.pairing
    }

    pub fn phone_x25519(&self) -> [u8; 32] {
        self.phone_x25519
    }

    pub fn phone_device_id(&self) -> String {
        device_id_from_x25519(&self.phone_x25519)
    }

    pub fn hello(&self) -> &PhoneHello {
        &self.hello
    }

    /// Writes the answer and turns the handshake into a session.
    pub fn respond(mut self, hello: &DesktopHello, now: u64) -> SealResult<(Session, Vec<u8>)> {
        let payload = serde_json::to_vec(hello).map_err(|_| SealError::BadInner)?;
        if payload.len() > MAX_HELLO {
            return Err(SealError::TooLarge);
        }
        let mut buf = vec![0u8; NOISE_MAX];
        let n = self.hs.write_message(&payload, &mut buf).map_err(hs_err)?;
        let mut frame = vec![CHANNEL_VERSION, KIND_HS_RESP];
        frame.extend_from_slice(&buf[..n]);
        let sas = match (self.sas_commit, self.pairing) {
            (Some(c), _) => SasMode::DesktopCommit(c),
            (None, Some(PairingRef::Ticket(_))) => SasMode::Qr,
            (None, _) => SasMode::None,
        };
        let session = Session::from_handshake(self.hs, Role::Desktop, now, self.phone_x25519, sas)?;
        Ok((session, frame))
    }
}

fn frame_head(body: &[u8], kind: u8) -> SealResult<&[u8]> {
    if body.len() < 2 {
        return Err(SealError::BadFrame);
    }
    if body[0] != CHANNEL_VERSION {
        return Err(SealError::VersionUnsupported);
    }
    if body[1] != kind {
        return Err(SealError::WrongKind);
    }
    Ok(&body[2..])
}

/// Frame kind of a body, after the version check. The desktop uses it to
/// route a `POST /remote-api/sealed` to the handshake or the session.
pub fn frame_kind(body: &[u8]) -> SealResult<u8> {
    if body.len() < 2 {
        return Err(SealError::BadFrame);
    }
    if body[0] != CHANNEL_VERSION {
        return Err(SealError::VersionUnsupported);
    }
    match body[1] {
        k @ (KIND_HS_INIT | KIND_HS_RESP | KIND_DATA_TO_DESKTOP | KIND_DATA_TO_PHONE) => Ok(k),
        _ => Err(SealError::BadFrame),
    }
}

/// Session id from a data frame, so the desktop can find the session.
pub fn peek_session_id(body: &[u8]) -> SealResult<[u8; SID_LEN]> {
    let k = frame_kind(body)?;
    if k != KIND_DATA_TO_DESKTOP && k != KIND_DATA_TO_PHONE {
        return Err(SealError::WrongKind);
    }
    if body.len() < 2 + SID_LEN {
        return Err(SealError::BadFrame);
    }
    let mut sid = [0u8; SID_LEN];
    sid.copy_from_slice(&body[2..2 + SID_LEN]);
    Ok(sid)
}

// ---------------------------------------------------------------------------
// Replay window
// ---------------------------------------------------------------------------

const WINDOW_WORDS: usize = (REPLAY_WINDOW / 64) as usize;

/// Sliding bitmap over the last [`REPLAY_WINDOW`] nonces. Accepts each nonce
/// once, in any order, as long as it is not older than the window.
#[derive(Clone)]
pub struct ReplayWindow {
    top: Option<u64>,
    bits: [u64; WINDOW_WORDS],
}

impl Default for ReplayWindow {
    fn default() -> Self {
        Self {
            top: None,
            bits: [0; WINDOW_WORDS],
        }
    }
}

impl ReplayWindow {
    fn slot(n: u64) -> (usize, u64) {
        let i = n % REPLAY_WINDOW;
        ((i / 64) as usize, 1u64 << (i % 64))
    }

    /// Would `n` be accepted? Does not change the window.
    pub fn check(&self, n: u64) -> bool {
        match self.top {
            None => true,
            Some(top) if n > top => true,
            Some(top) if top - n >= REPLAY_WINDOW => false,
            Some(_) => {
                let (w, m) = Self::slot(n);
                self.bits[w] & m == 0
            }
        }
    }

    /// Marks `n` as seen. Call only after [`ReplayWindow::check`] and after
    /// the record authenticated.
    pub fn set(&mut self, n: u64) {
        match self.top {
            Some(top) if n <= top => {}
            Some(top) => {
                // Clear the slots the window slides over.
                if n - top >= REPLAY_WINDOW {
                    self.bits = [0; WINDOW_WORDS];
                } else {
                    let mut i = top + 1;
                    while i <= n {
                        let (w, m) = Self::slot(i);
                        self.bits[w] &= !m;
                        i += 1;
                    }
                }
                self.top = Some(n);
            }
            None => self.top = Some(n),
        }
        let (w, m) = Self::slot(n);
        self.bits[w] |= m;
    }
}

// ---------------------------------------------------------------------------
// Session
// ---------------------------------------------------------------------------

/// How a session gets its comparison code.
enum SasMode {
    /// Known device: no comparison code.
    None,
    /// Ticket (QR) pairing: from the handshake hash alone, own label. The
    /// ticket already binds the channel; the code only tells several
    /// requests at the desktop apart.
    Qr,
    /// Phone side of a code pairing: hash plus the phone's own nonce.
    PhoneNonce(Zeroizing<[u8; 32]>),
    /// Desktop side of a code pairing: waits for the phone's reveal.
    DesktopCommit([u8; 32]),
}

fn sas_commitment(nonce: &[u8; 32]) -> [u8; 32] {
    sha256(&[L_SAS_COMMIT, nonce])
}

/// Code path: `BE-u32(SHA-256("lu-remote-v1/sas\n" || h || nonce)[0..4]) mod 1000000`,
/// six digits with leading zeros.
fn sas_digits(h: &[u8; 32], nonce: &[u8; 32]) -> String {
    digits6(&sha256(&[L_SAS, h, nonce]))
}

/// QR path: `BE-u32(SHA-256("lu-remote-v1/sas-qr\n" || h)[0..4]) mod 1000000`.
fn sas_digits_qr(h: &[u8; 32]) -> String {
    digits6(&sha256(&[L_SAS_QR, h]))
}

fn digits6(s: &[u8; 32]) -> String {
    format!("{:06}", u32::from_be_bytes([s[0], s[1], s[2], s[3]]) % 1_000_000)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    Phone,
    Desktop,
}

/// An established channel. Thread safe: many requests may seal and open at
/// the same time (each record has its own nonce).
pub struct Session {
    sid: [u8; SID_LEN],
    /// Handshake hash, input of the comparison code.
    h: [u8; 32],
    sas: OnceLock<String>,
    /// Phone side of a code pairing: the nonce to reveal.
    sas_nonce: Option<Zeroizing<[u8; 32]>>,
    /// Desktop side of a code pairing: the phone's commitment.
    sas_commit: Option<[u8; 32]>,
    role: Role,
    transport: StatelessTransportState,
    send_nonce: AtomicU64,
    window: Mutex<ReplayWindow>,
    created_at: u64,
    peer_x25519: [u8; 32],
}

impl Session {
    fn from_handshake(hs: HandshakeState, role: Role, now: u64, peer: [u8; 32], mode: SasMode) -> SealResult<Self> {
        let mut h = [0u8; 32];
        let hh = hs.get_handshake_hash();
        if hh.len() != 32 {
            return Err(SealError::HandshakeFailed);
        }
        h.copy_from_slice(hh);
        let mut sid = [0u8; SID_LEN];
        sid.copy_from_slice(&sha256(&[L_SID, &h])[..SID_LEN]);
        let sas = OnceLock::new();
        let (sas_nonce, sas_commit) = match mode {
            SasMode::None => (None, None),
            SasMode::Qr => {
                let _ = sas.set(sas_digits_qr(&h));
                (None, None)
            }
            SasMode::PhoneNonce(n) => {
                let _ = sas.set(sas_digits(&h, &n));
                (Some(n), None)
            }
            SasMode::DesktopCommit(c) => (None, Some(c)),
        };
        let transport = hs.into_stateless_transport_mode().map_err(hs_err)?;
        Ok(Self {
            sid,
            h,
            sas,
            sas_nonce,
            sas_commit,
            role,
            transport,
            send_nonce: AtomicU64::new(0),
            window: Mutex::new(ReplayWindow::default()),
            created_at: now,
            peer_x25519: peer,
        })
    }

    pub fn id(&self) -> [u8; SID_LEN] {
        self.sid
    }

    pub fn id_b64(&self) -> String {
        b64(&self.sid)
    }

    /// Six digit comparison code, the same on both ends of one handshake.
    /// QR pairing: `Some` right after the handshake (tells several requests
    /// at the desktop apart). Code pairing: `Some` on the phone right away,
    /// on the desktop only after the phone's reveal
    /// ([`Session::accept_sas_reveal`]). Known device: always `None`.
    pub fn sas(&self) -> Option<&str> {
        self.sas.get().map(String::as_str)
    }

    /// Phone side of a code pairing: the nonce to send to the desktop once
    /// the handshake is done (in the channel, `POST /remote-api/pair/reveal`).
    /// `None` for every other session.
    pub fn sas_reveal(&self) -> Option<String> {
        self.sas_nonce.as_ref().map(|n| b64(&n[..]))
    }

    /// Desktop side of a code pairing: checks the phone's reveal against the
    /// commitment from its first message and returns the comparison code.
    /// Only now may the desktop ask its user.
    pub fn accept_sas_reveal(&self, reveal: &str) -> SealResult<&str> {
        let commit = self.sas_commit.ok_or(SealError::BadReveal)?;
        let nonce = Zeroizing::new(b64_decode_exact::<32>(reveal).map_err(|_| SealError::BadReveal)?);
        if sas_commitment(&nonce) != commit {
            return Err(SealError::BadReveal);
        }
        Ok(self.sas.get_or_init(|| sas_digits(&self.h, &nonce)).as_str())
    }

    pub fn role(&self) -> Role {
        self.role
    }

    pub fn peer_x25519(&self) -> [u8; 32] {
        self.peer_x25519
    }

    pub fn created_at(&self) -> u64 {
        self.created_at
    }

    pub fn is_expired(&self, now: u64) -> bool {
        now >= self.created_at.saturating_add(SESSION_MAX_AGE_SECS)
    }

    fn send_kind(&self) -> u8 {
        match self.role {
            Role::Phone => KIND_DATA_TO_DESKTOP,
            Role::Desktop => KIND_DATA_TO_PHONE,
        }
    }

    fn recv_kind(&self) -> u8 {
        match self.role {
            Role::Phone => KIND_DATA_TO_PHONE,
            Role::Desktop => KIND_DATA_TO_DESKTOP,
        }
    }

    /// Seals one message (an encoded inner request or response) into one
    /// HTTP body.
    pub fn seal(&self, message: &[u8], now: u64) -> SealResult<Vec<u8>> {
        if self.is_expired(now) {
            return Err(SealError::SessionExpired);
        }
        if message.len() > MAX_MESSAGE {
            return Err(SealError::TooLarge);
        }
        let pieces: Vec<&[u8]> = if message.is_empty() {
            vec![&[][..]]
        } else {
            message.chunks(RECORD_DATA_MAX).collect()
        };
        let count = pieces.len() as u64;
        let first = self.send_nonce.fetch_add(count, Ordering::SeqCst);
        if first.saturating_add(count) > NONCE_LIMIT {
            return Err(SealError::SessionExhausted);
        }
        let mut out = Vec::with_capacity(2 + SID_LEN + message.len() + pieces.len() * (10 + TAG_LEN + 1));
        out.push(CHANNEL_VERSION);
        out.push(self.send_kind());
        out.extend_from_slice(&self.sid);
        let mut plain = Vec::with_capacity(RECORD_DATA_MAX + 1);
        let mut ct = vec![0u8; NOISE_MAX];
        let last = pieces.len() - 1;
        for (i, piece) in pieces.iter().enumerate() {
            let mut flags = 0u8;
            if i == 0 {
                flags |= REC_FIRST;
            }
            if i == last {
                flags |= REC_LAST;
            }
            plain.clear();
            plain.push(flags);
            plain.extend_from_slice(piece);
            let nonce = first + i as u64;
            let n = self
                .transport
                .write_message(nonce, &plain, &mut ct)
                .map_err(|_| SealError::TooLarge)?;
            out.extend_from_slice(&nonce.to_be_bytes());
            out.extend_from_slice(&(n as u16).to_be_bytes());
            out.extend_from_slice(&ct[..n]);
        }
        Ok(out)
    }

    /// Opens one HTTP body. Every record must authenticate, the nonces must
    /// be consecutive, the first and last flags in place, and no nonce may
    /// have been seen before. Only then does the window move.
    pub fn open(&self, body: &[u8], now: u64) -> SealResult<Vec<u8>> {
        if body.len() > MAX_BODY {
            return Err(SealError::TooLarge);
        }
        let rest = frame_head(body, self.recv_kind())?;
        if rest.len() < SID_LEN {
            return Err(SealError::BadFrame);
        }
        if rest[..SID_LEN] != self.sid {
            return Err(SealError::SessionMismatch);
        }
        if self.is_expired(now) {
            return Err(SealError::SessionExpired);
        }
        let mut rest = &rest[SID_LEN..];
        let mut message = Vec::new();
        let mut nonces = Vec::new();
        let mut plain = vec![0u8; NOISE_MAX];
        let mut done = false;
        while !rest.is_empty() {
            if done || rest.len() < 10 {
                return Err(SealError::BadFrame);
            }
            let nonce = u64::from_be_bytes(rest[..8].try_into().expect("8 bytes"));
            let len = u16::from_be_bytes([rest[8], rest[9]]) as usize;
            rest = &rest[10..];
            if len < TAG_LEN + 1 || rest.len() < len {
                return Err(SealError::BadFrame);
            }
            let (ct, tail) = rest.split_at(len);
            rest = tail;
            if nonce >= NONCE_LIMIT {
                return Err(SealError::BadFrame);
            }
            let n = self
                .transport
                .read_message(nonce, ct, &mut plain)
                .map_err(|_| SealError::Decrypt)?;
            let flags = plain[0];
            let expect_first = nonces.is_empty();
            if (flags & REC_FIRST != 0) != expect_first || flags & !(REC_FIRST | REC_LAST) != 0 {
                return Err(SealError::BadSequence);
            }
            if let Some(&prev) = nonces.last() {
                if nonce != prev + 1 {
                    return Err(SealError::BadSequence);
                }
            }
            nonces.push(nonce);
            if message.len() + n - 1 > MAX_MESSAGE {
                return Err(SealError::TooLarge);
            }
            message.extend_from_slice(&plain[1..n]);
            done = flags & REC_LAST != 0;
        }
        if !done {
            return Err(SealError::BadSequence);
        }
        let mut w = self.window.lock().unwrap_or_else(|e| e.into_inner());
        if !nonces.iter().all(|&n| w.check(n)) {
            return Err(SealError::Replay);
        }
        for &n in &nonces {
            w.set(n);
        }
        Ok(message)
    }
}

// ---------------------------------------------------------------------------
// Inner messages (an HTTP exchange in small)
// ---------------------------------------------------------------------------

/// An HTTP request carried inside the channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InnerRequest {
    /// 22 character random id chosen by the phone; the response echoes it.
    pub id: String,
    pub method: String,
    pub path: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

/// An HTTP response carried inside the channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InnerResponse {
    pub id: String,
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
struct RequestHead {
    v: u32,
    id: String,
    m: String,
    p: String,
    h: Vec<(String, String)>,
}

#[derive(Serialize, Deserialize)]
struct ResponseHead {
    v: u32,
    id: String,
    s: u16,
    h: Vec<(String, String)>,
}

const MAX_INNER_HEAD: usize = 64 * 1024;
const MAX_HEADERS: usize = 32;
const MAX_PATH: usize = 2048;

fn encode_with_head<T: Serialize>(head: &T, body: &[u8]) -> SealResult<Vec<u8>> {
    let json = serde_json::to_vec(head).map_err(|_| SealError::BadInner)?;
    if json.len() > MAX_INNER_HEAD {
        return Err(SealError::TooLarge);
    }
    let total = 4 + json.len() + body.len();
    if total > MAX_MESSAGE {
        return Err(SealError::TooLarge);
    }
    let mut out = Vec::with_capacity(total);
    out.extend_from_slice(&(json.len() as u32).to_be_bytes());
    out.extend_from_slice(&json);
    out.extend_from_slice(body);
    Ok(out)
}

fn split_head(message: &[u8]) -> SealResult<(&[u8], &[u8])> {
    if message.len() < 4 {
        return Err(SealError::BadInner);
    }
    let len = u32::from_be_bytes(message[..4].try_into().expect("4 bytes")) as usize;
    if len > MAX_INNER_HEAD || message.len() < 4 + len {
        return Err(SealError::BadInner);
    }
    Ok((&message[4..4 + len], &message[4 + len..]))
}

fn check_header(name: &str, value: &str) -> SealResult<()> {
    let name_ok = !name.is_empty()
        && name.len() <= 64
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    let value_ok = value.len() <= 8192 && !value.bytes().any(|b| b == b'\r' || b == b'\n' || b == 0);
    if name_ok && value_ok {
        Ok(())
    } else {
        Err(SealError::BadInner)
    }
}

/// Path rules for an inner request: absolute, printable ASCII, no `..`
/// segment, no `//`, no backslash, no encoded slash, backslash or dot, no
/// fragment, and never one of [`FORBIDDEN_INNER_PATHS`] (any case, with or
/// without trailing slash or query).
pub fn check_inner_path(path: &str) -> SealResult<()> {
    if path.is_empty() || path.len() > MAX_PATH || !path.starts_with('/') {
        return Err(SealError::ForbiddenPath);
    }
    if !path.bytes().all(|b| (0x21..0x7f).contains(&b)) || path.contains('#') || path.contains('\\') {
        return Err(SealError::ForbiddenPath);
    }
    let route = path.split('?').next().unwrap_or("");
    let lower = route.to_ascii_lowercase();
    if lower.contains("//") || !plain_escapes(&lower) {
        return Err(SealError::ForbiddenPath);
    }
    if lower.split('/').any(|seg| seg == ".." || seg == ".") {
        return Err(SealError::ForbiddenPath);
    }
    let trimmed = lower.trim_end_matches('/');
    for bad in FORBIDDEN_INNER_PATHS {
        if trimmed == *bad || trimmed.starts_with(&format!("{bad}/")) {
            return Err(SealError::ForbiddenPath);
        }
    }
    Ok(())
}

/// Every `%` in the route starts a well formed escape, and no escape stands
/// for a character that never needs one (letters, digits, `-._~`) or for `/`
/// or `\`. So the route has one spelling: whatever a router decodes, it
/// cannot turn into a forbidden path or a `..` segment.
fn plain_escapes(route: &str) -> bool {
    let b = route.as_bytes();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = |c: u8| (c as char).to_digit(16);
            let (Some(hi), Some(lo)) = (b.get(i + 1).and_then(|&c| hex(c)), b.get(i + 2).and_then(|&c| hex(c))) else {
                return false;
            };
            let c = (hi * 16 + lo) as u8;
            if c.is_ascii_alphanumeric() || b"-._~/\\".contains(&c) {
                return false;
            }
            i += 3;
        } else {
            i += 1;
        }
    }
    true
}

/// New random request id (16 bytes, base64url).
pub fn new_request_id() -> SealResult<String> {
    Ok(b64(&random_bytes::<16>()?))
}

impl InnerRequest {
    pub fn encode(&self) -> SealResult<Vec<u8>> {
        self.validate()?;
        encode_with_head(
            &RequestHead {
                v: INNER_VERSION,
                id: self.id.clone(),
                m: self.method.clone(),
                p: self.path.clone(),
                h: self.headers.clone(),
            },
            &self.body,
        )
    }

    pub fn decode(message: &[u8]) -> SealResult<Self> {
        let (head, body) = split_head(message)?;
        let h: RequestHead = serde_json::from_slice(head).map_err(|_| SealError::BadInner)?;
        if h.v != INNER_VERSION {
            return Err(SealError::VersionUnsupported);
        }
        let req = Self {
            id: h.id,
            method: h.m,
            path: h.p,
            headers: h.h,
            body: body.to_vec(),
        };
        req.validate()?;
        Ok(req)
    }

    fn validate(&self) -> SealResult<()> {
        check_id(&self.id).map_err(|_| SealError::BadInner)?;
        if !INNER_METHODS.contains(&self.method.as_str()) {
            return Err(SealError::BadInner);
        }
        check_inner_path(&self.path)?;
        if self.headers.len() > MAX_HEADERS {
            return Err(SealError::BadInner);
        }
        for (k, v) in &self.headers {
            check_header(k, v)?;
        }
        Ok(())
    }

    /// What the desktop hands to its router: only allow-listed headers, and
    /// `x-lu-device` set from the authenticated session, never from the phone.
    pub fn for_router(&self, device_id: &str) -> SealResult<Self> {
        self.validate()?;
        check_id(device_id)?;
        let mut headers: Vec<(String, String)> = self
            .headers
            .iter()
            .filter(|(k, _)| INNER_HEADER_ALLOWLIST.contains(&k.as_str()))
            .cloned()
            .collect();
        headers.push((DEVICE_HEADER.to_string(), device_id.to_string()));
        Ok(Self {
            headers,
            ..self.clone()
        })
    }
}

impl InnerResponse {
    pub fn encode(&self) -> SealResult<Vec<u8>> {
        self.validate()?;
        encode_with_head(
            &ResponseHead {
                v: INNER_VERSION,
                id: self.id.clone(),
                s: self.status,
                h: self.headers.clone(),
            },
            &self.body,
        )
    }

    /// Decodes and checks that the response answers `request_id`. A response
    /// to another request (swapped by somebody in the middle) is refused.
    pub fn decode_for(message: &[u8], request_id: &str) -> SealResult<Self> {
        let (head, body) = split_head(message)?;
        let h: ResponseHead = serde_json::from_slice(head).map_err(|_| SealError::BadInner)?;
        if h.v != INNER_VERSION {
            return Err(SealError::VersionUnsupported);
        }
        let resp = Self {
            id: h.id,
            status: h.s,
            headers: h.h,
            body: body.to_vec(),
        };
        resp.validate()?;
        if resp.id != request_id {
            return Err(SealError::ResponseMismatch);
        }
        Ok(resp)
    }

    fn validate(&self) -> SealResult<()> {
        check_id(&self.id).map_err(|_| SealError::BadInner)?;
        if !(100..=599).contains(&self.status) || self.headers.len() > MAX_HEADERS {
            return Err(SealError::BadInner);
        }
        for (k, v) in &self.headers {
            check_header(k, v)?;
        }
        Ok(())
    }

    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.as_str())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
