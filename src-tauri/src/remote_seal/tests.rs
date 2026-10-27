//! Tests for the sealed channel. The vectors at the end are the ones printed
//! in mobile-docs/remote/PROTOKOLL.md; change one, change both.

use super::*;

const T0: u64 = 1_790_000_000;

fn phone_secret() -> DeviceSecret {
    DeviceSecret::from_bytes([0x11; 32])
}

fn desktop_secret() -> DeviceSecret {
    DeviceSecret::from_bytes([0x22; 32])
}

fn ticket() -> Ticket {
    Ticket::from_bytes([0x33; 16])
}

fn phone_hello(s: &DeviceSecret) -> PhoneHello {
    PhoneHello::new(s, "Pixel 8", "android", "3.0.7")
}

fn desktop_hello(s: &DeviceSecret, state: PairState, now: u64) -> DesktopHello {
    DesktopHello::new(s, "Studio PC", state, vec![FEATURE_SEALED.to_string()], now)
}

/// Full handshake. `pairing` uses the ticket (IKpsk1), otherwise IK.
fn handshake(pairing: bool) -> (Session, Session, DesktopHello, PhoneHello) {
    let p = phone_secret();
    let d = desktop_secret();
    let t = ticket();
    let secret = PairingSecret::Ticket(t.clone());
    let (hs, init) = PhoneHandshake::start(
        &p,
        &d.desktop_id(),
        &d.x25519_public(),
        if pairing { Some(&secret) } else { None },
        &phone_hello(&p),
    )
    .unwrap();
    let dh = DesktopHandshake::read_init(&d, &init, |r| (r == PairingRef::Ticket(t.id())).then(|| PairingSecret::Ticket(t.clone()))).unwrap();
    assert_eq!(dh.is_pairing(), pairing);
    let ph = dh.hello().clone();
    let state = if pairing { PairState::Pending } else { PairState::Paired };
    let (ds, resp) = dh.respond(&desktop_hello(&d, state, T0), T0).unwrap();
    let (ps, dhello) = hs.finish(&resp, T0).unwrap();
    (ps, ds, dhello, ph)
}

fn req(path: &str) -> InnerRequest {
    InnerRequest {
        id: new_request_id().unwrap(),
        method: "POST".into(),
        path: path.into(),
        headers: vec![("content-type".into(), "application/json".into())],
        body: br#"{"model":"x"}"#.to_vec(),
    }
}

// ---------------------------------------------------------------- keys -----

#[test]
fn keys_are_deterministic_and_separated() {
    let a = phone_secret();
    let b = phone_secret();
    assert_eq!(a.x25519_public(), b.x25519_public());
    assert_eq!(a.ed25519_public(), b.ed25519_public());
    // Two labels, two unrelated keys.
    assert_ne!(a.x25519_public(), a.ed25519_public());
    assert_ne!(a.x25519_public(), desktop_secret().x25519_public());
    // Store round trip.
    let back = DeviceSecret::from_b64(&a.to_b64()).unwrap();
    assert_eq!(back.x25519_public(), a.x25519_public());
}

#[test]
fn fresh_secrets_differ() {
    let a = DeviceSecret::generate().unwrap();
    let b = DeviceSecret::generate().unwrap();
    assert_ne!(a.x25519_public(), b.x25519_public());
    assert_ne!(Ticket::generate().unwrap().to_b64(), Ticket::generate().unwrap().to_b64());
}

#[test]
fn ids_have_the_specified_shape() {
    let d = desktop_secret();
    let id = d.desktop_id();
    assert_eq!(id.len(), 22);
    check_id(&id).unwrap();
    assert_eq!(id, desktop_id_from_ed25519(&d.ed25519_public()));
    assert_ne!(d.desktop_id(), d.device_id());
}

#[test]
fn base64_is_strict() {
    let k = b64(&[7u8; 32]);
    assert_eq!(k.len(), 43);
    assert!(b64_decode_exact::<32>(&k).is_ok());
    assert_eq!(b64_decode_exact::<32>(&format!("{k}=")), Err(SealError::BadEncoding));
    assert_eq!(b64_decode_exact::<31>(&k), Err(SealError::BadEncoding));
    assert_eq!(b64_decode_exact::<32>(&k.replace('B', "+")), Err(SealError::BadEncoding));
    // Non canonical trailing bits: last char of 32 bytes carries 4 bits.
    let mut odd = k.clone();
    odd.pop();
    odd.push('H');
    assert!(b64_decode_exact::<32>(&odd).is_err());
}

// ----------------------------------------------------------- handshake -----

#[test]
fn pairing_handshake_succeeds_both_ways() {
    let (ps, ds, dhello, phello) = handshake(true);
    assert_eq!(ps.id(), ds.id());
    assert_eq!(ps.sas(), ds.sas());
    assert_eq!(ps.sas().unwrap().len(), 6);
    // Ticket pairing: no commitment, nothing to reveal.
    assert_eq!(ps.sas_reveal(), None);
    assert_eq!(ds.accept_sas_reveal(&b64(&[0u8; 32])), Err(SealError::BadReveal));
    assert_eq!(dhello.state, PairState::Pending);
    assert_eq!(dhello.desktop_id, desktop_secret().desktop_id());
    assert_eq!(phello.name, "Pixel 8");
    assert_eq!(ds.peer_x25519(), phone_secret().x25519_public());
    assert_eq!(device_id_from_x25519(&ds.peer_x25519()), phone_secret().device_id());

    let r = req("/api/chat");
    let body = ps.seal(&r.encode().unwrap(), T0).unwrap();
    let got = InnerRequest::decode(&ds.open(&body, T0).unwrap()).unwrap();
    assert_eq!(got, r);

    let resp = InnerResponse {
        id: r.id.clone(),
        status: 200,
        headers: vec![],
        body: b"ok".to_vec(),
    };
    let body = ds.seal(&resp.encode().unwrap(), T0).unwrap();
    let back = InnerResponse::decode_for(&ps.open(&body, T0).unwrap(), &r.id).unwrap();
    assert_eq!(back, resp);
}

#[test]
fn reconnect_handshake_without_ticket_succeeds() {
    let (ps, ds, dhello, _) = handshake(false);
    assert_eq!(dhello.state, PairState::Paired);
    let body = ps.seal(b"hello", T0).unwrap();
    assert_eq!(ds.open(&body, T0).unwrap(), b"hello");
}

#[test]
fn each_handshake_gives_a_new_session() {
    let (a, _, _, _) = handshake(false);
    let (b, _, _, _) = handshake(false);
    assert_ne!(a.id(), b.id());
}

#[test]
fn phone_with_wrong_pinned_desktop_key_fails() {
    let p = phone_secret();
    let d = desktop_secret();
    let other = DeviceSecret::from_bytes([0x99; 32]);
    // Phone pinned "other", the real desktop at the address cannot read it.
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &other.x25519_public(), None, &phone_hello(&p)).unwrap();
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| None).err(),
        Some(SealError::HandshakeFailed)
    );
}

#[test]
fn impostor_desktop_cannot_answer() {
    // An impostor with its own key gets a message made for the real desktop.
    let p = phone_secret();
    let d = desktop_secret();
    let impostor = DeviceSecret::from_bytes([0x98; 32]);
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &phone_hello(&p)).unwrap();
    assert!(DesktopHandshake::read_init(&impostor, &init, |_| None).is_err());
}

#[test]
fn desktop_hello_with_foreign_id_is_refused() {
    // Same X25519 key (so Noise passes) but the id in the hello belongs to
    // another Ed25519 key: the phone refuses.
    let p = phone_secret();
    let d = desktop_secret();
    let (hs, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &phone_hello(&p)).unwrap();
    let dh = DesktopHandshake::read_init(&d, &init, |_| None).unwrap();
    let mut hello = desktop_hello(&d, PairState::Paired, T0);
    hello.ed25519_pub = b64(&DeviceSecret::from_bytes([0x55; 32]).ed25519_public());
    let (_, resp) = dh.respond(&hello, T0).unwrap();
    assert_eq!(hs.finish(&resp, T0).err(), Some(SealError::WrongDesktop));
}

#[test]
fn phone_expecting_another_desktop_id_refuses() {
    let p = phone_secret();
    let d = desktop_secret();
    let wrong_id = DeviceSecret::from_bytes([0x56; 32]).desktop_id();
    let (hs, init) = PhoneHandshake::start(&p, &wrong_id, &d.x25519_public(), None, &phone_hello(&p)).unwrap();
    let dh = DesktopHandshake::read_init(&d, &init, |_| None).unwrap();
    let (_, resp) = dh.respond(&desktop_hello(&d, PairState::Paired, T0), T0).unwrap();
    assert_eq!(hs.finish(&resp, T0).err(), Some(SealError::WrongDesktop));
}

#[test]
fn wrong_or_unknown_ticket_fails() {
    let p = phone_secret();
    let d = desktop_secret();
    let t = ticket();
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), Some(&PairingSecret::Ticket(t.clone())), &phone_hello(&p)).unwrap();
    // Desktop has no open ticket.
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| None).err(),
        Some(SealError::UnknownTicket)
    );
    // Desktop answers with another ticket: its id does not match the frame.
    let other = Ticket::from_bytes([0x34; 16]);
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| Some(PairingSecret::Ticket(other.clone()))).err(),
        Some(SealError::UnknownTicket)
    );
    // Right id in the header, wrong ticket behind it (header forged onto a
    // frame made with another ticket): the first message does not decrypt.
    let (_, init_other) =
        PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), Some(&PairingSecret::Ticket(other)), &phone_hello(&p)).unwrap();
    let mut forged = init_other.clone();
    forged[3..11].copy_from_slice(&t.id());
    assert_eq!(
        DesktopHandshake::read_init(&d, &forged, |_| Some(PairingSecret::Ticket(t.clone()))).err(),
        Some(SealError::HandshakeFailed)
    );
}

#[test]
fn ticket_is_consumed_once_by_the_caller() {
    // The module asks for the ticket per frame; the desktop removes it on
    // first use. Model that store here and replay the same pairing frame.
    let p = phone_secret();
    let d = desktop_secret();
    let t = ticket();
    let mut open: Option<Ticket> = Some(t.clone());
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), Some(&PairingSecret::Ticket(t.clone())), &phone_hello(&p)).unwrap();
    let take = |open: &mut Option<Ticket>, r: PairingRef| {
        if open.as_ref().map(|x| PairingRef::Ticket(x.id())) == Some(r) {
            open.take().map(PairingSecret::Ticket)
        } else {
            None
        }
    };
    assert!(DesktopHandshake::read_init(&d, &init, |r| take(&mut open, r)).is_ok());
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |r| take(&mut open, r)).err(),
        Some(SealError::UnknownTicket)
    );
}

#[test]
fn pairing_frame_without_ticket_flag_cannot_be_read_as_ik() {
    // Strip the ticket from a pairing frame: the desktop then runs IK on an
    // IKpsk1 message and fails.
    let p = phone_secret();
    let d = desktop_secret();
    let t = ticket();
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), Some(&PairingSecret::Ticket(t.clone())), &phone_hello(&p)).unwrap();
    let mut forged = vec![CHANNEL_VERSION, KIND_HS_INIT, 0];
    forged.extend_from_slice(&init[11..]);
    assert!(DesktopHandshake::read_init(&d, &forged, |_| None).is_err());
}

#[test]
fn code_pairing_works_and_shows_the_same_comparison_code() {
    let p = phone_secret();
    let d = desktop_secret();
    let code = PairingSecret::code("482913").unwrap();
    let (hs, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), Some(&code), &phone_hello(&p)).unwrap();
    // The frame carries no hint of the code (no id derived from it).
    assert_eq!(&init[..3], &[CHANNEL_VERSION, KIND_HS_INIT, 0x02]);
    let dh = DesktopHandshake::read_init(&d, &init, |r| {
        assert_eq!(r, PairingRef::Code);
        Some(PairingSecret::code("482913").unwrap())
    })
    .unwrap();
    assert_eq!(dh.pairing(), Some(PairingRef::Code));
    let (ds, resp) = dh.respond(&desktop_hello(&d, PairState::Pending, T0), T0).unwrap();
    let (ps, _) = hs.finish(&resp, T0).unwrap();
    // The desktop learns the code only from the phone's reveal.
    assert_eq!(ds.sas(), None);
    let reveal = ps.sas_reveal().unwrap();
    let mut wrong = b64_decode_exact::<32>(&reveal).unwrap();
    wrong[0] ^= 1;
    assert_eq!(ds.accept_sas_reveal(&b64(&wrong)), Err(SealError::BadReveal));
    assert_eq!(ds.accept_sas_reveal("short"), Err(SealError::BadReveal));
    assert_eq!(ds.sas(), None);
    assert_eq!(ds.accept_sas_reveal(&reveal).unwrap(), ps.sas().unwrap());
    assert_eq!(ps.sas(), ds.sas());
}

#[test]
fn wrong_code_fails_at_the_first_message() {
    let p = phone_secret();
    let d = desktop_secret();
    let code = PairingSecret::code("482913").unwrap();
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), Some(&code), &phone_hello(&p)).unwrap();
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| Some(PairingSecret::code("482914").unwrap())).err(),
        Some(SealError::HandshakeFailed)
    );
    // No code shown at the desktop.
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| None).err(),
        Some(SealError::UnknownTicket)
    );
    // A ticket offered for a code frame is refused, not tried.
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| Some(PairingSecret::Ticket(ticket()))).err(),
        Some(SealError::UnknownTicket)
    );
    for bad in ["12345", "1234567", "12a456", " 12345"] {
        assert!(PairingSecret::code(bad).is_err(), "{bad}");
    }
}

#[test]
fn man_in_the_middle_on_code_pairing_shows_another_comparison_code() {
    // The LAN attacker hands the phone its own key instead of the desktop's.
    // It can learn the code offline from the phone's message and pair itself
    // with the real desktop, but the two sessions have different handshake
    // hashes, so the comparison codes differ and the user says no.
    // (Chance of an accidental match: one in a million.)
    let p = phone_secret();
    let d = desktop_secret();
    let m = DeviceSecret::from_bytes([0x66; 32]);
    let code = PairingSecret::code("482913").unwrap();
    let (phs, init) = PhoneHandshake::start_inner(&p, &m.desktop_id(), &m.x25519_public(), Some(&code), &phone_hello(&p), Some(&[0x41; 32])).unwrap();
    let mdh = DesktopHandshake::read_init_inner(&m, &init, |_| Some(code.clone()), Some(&[0x42; 32])).unwrap();
    let (m_side, resp) = mdh.respond(&desktop_hello(&m, PairState::Pending, T0), T0).unwrap();
    let (phone, _) = phs.finish(&resp, T0).unwrap();
    m_side.accept_sas_reveal(&phone.sas_reveal().unwrap()).unwrap();
    let (mhs, init2) = PhoneHandshake::start_inner(&m, &d.desktop_id(), &d.x25519_public(), Some(&code), &phone_hello(&m), Some(&[0x43; 32])).unwrap();
    let ddh = DesktopHandshake::read_init_inner(&d, &init2, |_| Some(code.clone()), Some(&[0x44; 32])).unwrap();
    let (d_side, resp2) = ddh.respond(&desktop_hello(&d, PairState::Pending, T0), T0).unwrap();
    let (m_phone, _) = mhs.finish(&resp2, T0).unwrap();
    d_side.accept_sas_reveal(&m_phone.sas_reveal().unwrap()).unwrap();
    assert_ne!(phone.sas(), d_side.sas());
}

#[test]
fn tampered_handshake_fails() {
    let p = phone_secret();
    let d = desktop_secret();
    let (hs, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &phone_hello(&p)).unwrap();
    for i in [3, 20, 40, init.len() - 1] {
        let mut bad = init.clone();
        bad[i] ^= 0x01;
        assert!(DesktopHandshake::read_init(&d, &bad, |_| None).is_err(), "byte {i}");
    }
    let dh = DesktopHandshake::read_init(&d, &init, |_| None).unwrap();
    let (_, resp) = dh.respond(&desktop_hello(&d, PairState::Paired, T0), T0).unwrap();
    let mut bad = resp.clone();
    let last = bad.len() - 1;
    bad[last] ^= 0x80;
    assert_eq!(hs.finish(&bad, T0).err(), Some(SealError::HandshakeFailed));
}

#[test]
fn bad_binding_signature_is_refused() {
    let p = phone_secret();
    let d = desktop_secret();
    let mut hello = phone_hello(&p);
    // Binding made by another key pair.
    hello.bind = sign_bind(&DeviceSecret::from_bytes([0x77; 32]));
    let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &hello).unwrap();
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| None).err(),
        Some(SealError::BadBinding)
    );
}

#[test]
fn frame_version_and_kind_are_checked() {
    let p = phone_secret();
    let d = desktop_secret();
    let (_, mut init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &phone_hello(&p)).unwrap();
    assert_eq!(frame_kind(&init), Ok(KIND_HS_INIT));
    init[0] = 2;
    assert_eq!(frame_kind(&init), Err(SealError::VersionUnsupported));
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| None).err(),
        Some(SealError::VersionUnsupported)
    );
    assert_eq!(frame_kind(&[1, 9]), Err(SealError::BadFrame));
    assert_eq!(frame_kind(&[1]), Err(SealError::BadFrame));
}

// ------------------------------------------------------------ transport -----

#[test]
fn replayed_body_is_refused() {
    let (ps, ds, _, _) = handshake(false);
    let body = ps.seal(b"once", T0).unwrap();
    assert!(ds.open(&body, T0).is_ok());
    assert_eq!(ds.open(&body, T0), Err(SealError::Replay));
}

#[test]
fn parallel_bodies_may_arrive_in_any_order() {
    let (ps, ds, _, _) = handshake(false);
    let bodies: Vec<Vec<u8>> = (0..200).map(|i| ps.seal(format!("m{i}").as_bytes(), T0).unwrap()).collect();
    // Reverse order, all inside the window.
    for (i, b) in bodies.iter().enumerate().rev() {
        assert_eq!(ds.open(b, T0).unwrap(), format!("m{i}").as_bytes());
    }
    for b in &bodies {
        assert_eq!(ds.open(b, T0), Err(SealError::Replay));
    }
}

#[test]
fn body_older_than_the_window_is_refused() {
    let (ps, ds, _, _) = handshake(false);
    let old = ps.seal(b"old", T0).unwrap();
    for _ in 0..REPLAY_WINDOW {
        let b = ps.seal(b"x", T0).unwrap();
        ds.open(&b, T0).unwrap();
    }
    assert_eq!(ds.open(&old, T0), Err(SealError::Replay));
}

#[test]
fn concurrent_sealing_never_reuses_a_nonce() {
    use std::sync::Arc;
    let (ps, ds, _, _) = handshake(false);
    let ps = Arc::new(ps);
    let handles: Vec<_> = (0..8)
        .map(|_| {
            let ps = Arc::clone(&ps);
            std::thread::spawn(move || (0..50).map(|_| ps.seal(b"p", T0).unwrap()).collect::<Vec<_>>())
        })
        .collect();
    let mut all = Vec::new();
    for h in handles {
        all.extend(h.join().unwrap());
    }
    for b in &all {
        ds.open(b, T0).unwrap();
    }
}

#[test]
fn tampering_with_any_part_of_a_data_frame_fails() {
    let (ps, ds, _, _) = handshake(false);
    let body = ps.seal(b"secret prompt", T0).unwrap();
    // version, kind, sid, nonce, length, ciphertext, tag
    for i in [0usize, 1, 2, 17, 18, 25, 26, 27, 30, body.len() - 1] {
        let mut bad = body.clone();
        bad[i] ^= 0x01;
        assert!(ds.open(&bad, T0).is_err(), "byte {i} accepted");
    }
    // Truncated and extended.
    assert!(ds.open(&body[..body.len() - 1], T0).is_err());
    let mut longer = body.clone();
    longer.push(0);
    assert!(ds.open(&longer, T0).is_err());
    // The untouched body still opens: failed attempts did not burn its nonce.
    assert_eq!(ds.open(&body, T0).unwrap(), b"secret prompt");
}

fn records(body: &[u8]) -> (Vec<u8>, Vec<Vec<u8>>) {
    let head = body[..2 + SID_LEN].to_vec();
    let mut rest = &body[2 + SID_LEN..];
    let mut out = Vec::new();
    while !rest.is_empty() {
        let len = u16::from_be_bytes([rest[8], rest[9]]) as usize;
        out.push(rest[..10 + len].to_vec());
        rest = &rest[10 + len..];
    }
    (head, out)
}

#[test]
fn records_dropped_reordered_or_spliced_fail() {
    let (ps, ds, _, _) = handshake(false);
    let big = vec![0xabu8; RECORD_DATA_MAX * 2 + 10];
    let body = ps.seal(&big, T0).unwrap();
    let (head, recs) = records(&body);
    assert_eq!(recs.len(), 3);
    let join = |parts: &[&Vec<u8>]| {
        let mut b = head.clone();
        for p in parts {
            b.extend_from_slice(p);
        }
        b
    };
    // Last record dropped.
    assert_eq!(ds.open(&join(&[&recs[0], &recs[1]]), T0), Err(SealError::BadSequence));
    // First record dropped.
    assert_eq!(ds.open(&join(&[&recs[1], &recs[2]]), T0), Err(SealError::BadSequence));
    // Reordered.
    assert_eq!(ds.open(&join(&[&recs[0], &recs[2], &recs[1]]), T0), Err(SealError::BadSequence));
    // Duplicated record.
    assert!(ds.open(&join(&[&recs[0], &recs[1], &recs[1], &recs[2]]), T0).is_err());
    // Spliced with a record of another body.
    let other = ps.seal(b"short", T0).unwrap();
    let (_, orecs) = records(&other);
    assert!(ds.open(&join(&[&recs[0], &recs[1], &orecs[0]]), T0).is_err());
    // The real body still opens.
    assert_eq!(ds.open(&body, T0).unwrap(), big);
}

#[test]
fn bodies_do_not_cross_sessions_or_directions() {
    let (ps1, ds1, _, _) = handshake(false);
    let (ps2, ds2, _, _) = handshake(false);
    let body = ps1.seal(b"for session 1", T0).unwrap();
    assert_eq!(peek_session_id(&body), Ok(ds1.id()));
    assert_eq!(ds2.open(&body, T0), Err(SealError::SessionMismatch));
    // Sent back to its own sender (reflection).
    assert_eq!(ps1.open(&body, T0), Err(SealError::WrongKind));
    // A desktop answer is not a phone request.
    let answer = ds1.seal(b"answer", T0).unwrap();
    assert_eq!(ds1.open(&answer, T0), Err(SealError::WrongKind));
    // Session 2 header pasted on session 1 records.
    let mut forged = body.clone();
    forged[2..2 + SID_LEN].copy_from_slice(&ps2.id());
    assert_eq!(ds2.open(&forged, T0), Err(SealError::Decrypt));
}

#[test]
fn session_expires_after_24_hours() {
    let (ps, ds, dhello, _) = handshake(false);
    assert_eq!(dhello.expires, T0 + SESSION_MAX_AGE_SECS);
    let late = T0 + SESSION_MAX_AGE_SECS;
    let body = ps.seal(b"x", late - 1).unwrap();
    assert_eq!(ds.open(&body, late), Err(SealError::SessionExpired));
    assert_eq!(ps.seal(b"x", late), Err(SealError::SessionExpired));
    assert_eq!(SealError::SessionExpired.code(), "session_expired");
}

#[test]
fn desktop_restart_means_a_new_handshake() {
    // The desktop keeps sessions in memory only. After a restart the old
    // session id is unknown (the server answers session_unknown), the phone
    // runs IK again with the same keys and goes on; old bodies stay dead.
    let (ps_old, ds_old, _, _) = handshake(false);
    let old_body = ps_old.seal(b"before", T0).unwrap();
    drop(ds_old);
    let (ps_new, ds_new, _, _) = handshake(false);
    assert_eq!(ds_new.open(&old_body, T0), Err(SealError::SessionMismatch));
    let body = ps_new.seal(b"after", T0 + 5).unwrap();
    assert_eq!(ds_new.open(&body, T0 + 5).unwrap(), b"after");
}

#[test]
fn message_size_limits_hold() {
    let (ps, ds, _, _) = handshake(false);
    let max = vec![1u8; MAX_MESSAGE];
    let body = ps.seal(&max, T0).unwrap();
    assert!(body.len() <= MAX_BODY);
    assert_eq!(ds.open(&body, T0).unwrap().len(), MAX_MESSAGE);
    assert_eq!(ps.seal(&vec![1u8; MAX_MESSAGE + 1], T0), Err(SealError::TooLarge));
    let empty = ps.seal(b"", T0).unwrap();
    assert_eq!(ds.open(&empty, T0).unwrap(), b"");
    const { assert!(MAX_CHUNK + 64 * 1024 < MAX_MESSAGE) };
}

#[test]
fn replay_window_unit() {
    let mut w = ReplayWindow::default();
    assert!(w.check(5));
    w.set(5);
    assert!(!w.check(5));
    assert!(w.check(3));
    w.set(3);
    assert!(!w.check(3));
    w.set(5 + REPLAY_WINDOW - 1);
    assert!(!w.check(4)); // slid out of the window
    assert!(!w.check(5)); // oldest slot still inside, seen
    assert!(w.check(6)); // inside, unseen
    w.set(10_000_000);
    assert!(!w.check(4));
    assert!(!w.check(10_000_000));
    assert!(w.check(10_000_000 - 1));
    assert!(!w.check(10_000_000 - REPLAY_WINDOW));
}

// ---------------------------------------------------------- inner layer -----

#[test]
fn forbidden_and_malformed_inner_paths() {
    for ok in ["/api/chat", "/remote-api/status", "/remote-api/agent-tool", "/remote-api/create/jobs/abc?x=1", "/remote-api/sealed-ish"] {
        assert_eq!(check_inner_path(ok), Ok(()), "{ok}");
    }
    for bad in [
        "/remote-api/sealed",
        "/remote-api/sealed/",
        "/remote-api/sealed?x=1",
        "/REMOTE-API/Sealed",
        "/remote-api/sealed/more",
        "/remote-api/auth",
        "/remote-api/auth/",
        "/remote-api/x/../auth",
        "/remote-api/%2e%2e/auth",
        "/remote-api%2fauth",
        "//remote-api/auth",
        "/a/./b",
        "/a\\b",
        "/a#b",
        "/a b",
        "relative",
        "",
    ] {
        assert_eq!(check_inner_path(bad), Err(SealError::ForbiddenPath), "{bad}");
    }
}

#[test]
fn inner_request_rejects_nesting_and_bad_methods() {
    let mut r = req("/remote-api/sealed");
    assert_eq!(r.encode(), Err(SealError::ForbiddenPath));
    r.path = "/api/chat".into();
    r.method = "CONNECT".into();
    assert_eq!(r.encode(), Err(SealError::BadInner));
    r.method = "GET".into();
    r.headers.push(("x-evil".into(), "a\r\nb".into()));
    assert_eq!(r.encode(), Err(SealError::BadInner));
}

#[test]
fn router_gets_only_allowed_headers_and_the_desktop_device_id() {
    let mut r = req("/api/chat");
    r.headers.push(("authorization".into(), "Bearer stolen".into()));
    r.headers.push((DEVICE_HEADER.into(), "spoofed-id-0000000000a".into()));
    r.headers.push(("x-lu-app-version".into(), "3.0.7".into()));
    r.headers.push(("cookie".into(), "a=b".into()));
    let device = phone_secret().device_id();
    let out = r.for_router(&device).unwrap();
    let names: Vec<&str> = out.headers.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(names, vec!["content-type", "x-lu-app-version", DEVICE_HEADER]);
    assert_eq!(out.headers.last().unwrap().1, device);
}

#[test]
fn response_must_answer_its_request() {
    let r1 = req("/api/chat");
    let r2 = req("/api/chat");
    let resp = InnerResponse {
        id: r1.id.clone(),
        status: 202,
        headers: vec![(PENDING_HEADER.into(), "tok".into())],
        body: vec![],
    };
    let enc = resp.encode().unwrap();
    assert_eq!(InnerResponse::decode_for(&enc, &r2.id), Err(SealError::ResponseMismatch));
    let ok = InnerResponse::decode_for(&enc, &r1.id).unwrap();
    assert_eq!(ok.header(PENDING_HEADER), Some("tok"));
}

#[test]
fn inner_decode_rejects_garbage() {
    assert_eq!(InnerRequest::decode(b""), Err(SealError::BadInner));
    assert_eq!(InnerRequest::decode(&[0, 0, 0, 9, b'{']), Err(SealError::BadInner));
    let mut v2 = Vec::new();
    let head = br#"{"v":2,"id":"AAAAAAAAAAAAAAAAAAAAAA","m":"GET","p":"/","h":[]}"#;
    v2.extend_from_slice(&(head.len() as u32).to_be_bytes());
    v2.extend_from_slice(head);
    assert_eq!(InnerRequest::decode(&v2), Err(SealError::VersionUnsupported));
}

// ---------------------------------------------------------- signatures -----

const ADDR: &str = "https://quiet-river-lamp.trycloudflare.com";

#[test]
fn announce_signs_and_verifies() {
    let d = desktop_secret();
    let a = sign_announce(&d, ADDR, T0).unwrap();
    assert_eq!(a.desktop_id, d.desktop_id());
    verify_announce(&a, T0).unwrap();
    verify_announce(&a, T0 + MAX_CLOCK_SKEW_SECS).unwrap();
    assert_eq!(verify_announce(&a, T0 + MAX_CLOCK_SKEW_SECS + 1), Err(SealError::ClockSkew));
    assert_eq!(verify_announce(&a, T0 - MAX_CLOCK_SKEW_SECS - 1), Err(SealError::ClockSkew));

    let mut moved = a.clone();
    moved.address = "https://evil-site.trycloudflare.com".into();
    assert_eq!(verify_announce(&moved, T0), Err(SealError::BadSignature));

    let mut other_key = a.clone();
    other_key.ed25519_pub = b64(&phone_secret().ed25519_public());
    assert_eq!(verify_announce(&other_key, T0), Err(SealError::BadSignature));

    let mut later = a.clone();
    later.time += 1;
    assert_eq!(verify_announce(&later, T0), Err(SealError::BadSignature));
}

#[test]
fn announce_address_rule() {
    for ok in [ADDR, "https://a.trycloudflare.com", "https://a-1-b.trycloudflare.com"] {
        assert_eq!(check_tunnel_address(ok), Ok(()), "{ok}");
    }
    for bad in [
        "http://a.trycloudflare.com",
        "https://a.trycloudflare.com/",
        "https://a.trycloudflare.com/mobile",
        "https://a.trycloudflare.com:443",
        "https://A.trycloudflare.com",
        "https://a.b.trycloudflare.com",
        "https://.trycloudflare.com",
        "https://-a.trycloudflare.com",
        "https://a.trycloudflare.com.evil.example",
        "https://evil.example/?.trycloudflare.com",
        "https://a\n.trycloudflare.com",
    ] {
        assert_eq!(check_tunnel_address(bad), Err(SealError::BadAddress), "{bad}");
    }
    assert_eq!(sign_announce(&desktop_secret(), "https://x.example", T0).err(), Some(SealError::BadAddress));
}

#[test]
fn signin_signs_and_verifies() {
    let p = phone_secret();
    let code = "Zx9_k-2mQpLr7TbW";
    let sig = sign_signin(&p, code, T0).unwrap();
    let pk = b64(&p.ed25519_public());
    verify_signin(&pk, code, T0, &sig, T0 + 10).unwrap();
    assert_eq!(verify_signin(&pk, code, T0 + 1, &sig, T0), Err(SealError::BadSignature));
    assert_eq!(verify_signin(&pk, "Zx9_k-2mQpLr7TbX", T0, &sig, T0), Err(SealError::BadSignature));
    assert_eq!(verify_signin(&pk, code, T0, &sig, T0 + 301), Err(SealError::ClockSkew));
    let other = b64(&desktop_secret().ed25519_public());
    assert_eq!(verify_signin(&other, code, T0, &sig, T0), Err(SealError::BadSignature));
    assert_eq!(sign_signin(&p, "short", T0), Err(SealError::BadEncoding));
    assert_eq!(sign_signin(&p, "has\nnewline-0000000", T0), Err(SealError::BadEncoding));
}

#[test]
fn signatures_are_domain_separated() {
    // The same key signs announce, sign-in and binding. None of the three
    // signatures verifies as one of the others, even over equal-looking text.
    let s = desktop_secret();
    let pk = s.ed25519_public();
    let pk_b64 = b64(&pk);
    let a = sign_announce(&s, ADDR, T0).unwrap();
    let a_sig = b64_decode_exact::<64>(&a.signature).unwrap();
    let code = "AAAAAAAAAAAAAAAAAAAAAA";
    let signin_sig = sign_signin(&s, code, T0).unwrap();
    let bind_sig = sign_bind(&s);

    assert!(verify_signin(&pk_b64, code, T0, &a.signature, T0).is_err());
    assert!(verify_bind(&pk_b64, &s.x25519_public(), &a.signature).is_err());
    let mut as_announce = a.clone();
    as_announce.signature = signin_sig.clone();
    assert!(verify_announce(&as_announce, T0).is_err());
    as_announce.signature = bind_sig.clone();
    assert!(verify_announce(&as_announce, T0).is_err());
    assert!(verify_signin(&pk_b64, code, T0, &bind_sig, T0).is_err());
    // And the raw messages carry distinct labels.
    let m1 = announce_message(&a.desktop_id, &pk_b64, ADDR, T0).unwrap();
    let m2 = signin_message(code, T0).unwrap();
    let m3 = bind_message(&s.x25519_public());
    assert!(m1.starts_with(b"lu-remote-v1/announce\n"));
    assert!(m2.starts_with(b"lu-remote-v1/signin\n"));
    assert!(m3.starts_with(b"lu-remote-v1/bind\n"));
    assert!(verify_ed25519(&pk, &m1, &a_sig).is_ok());
}

// --------------------------------------------------------- pairing link -----

fn link() -> PairingLink {
    let d = desktop_secret();
    PairingLink {
        desktop_id: d.desktop_id(),
        desktop_x25519: d.x25519_public(),
        ticket: ticket(),
        name: "Studio PC".into(),
        lan: Some("http://192.0.2.10:11435".into()),
        tunnel: Some(ADDR.into()),
    }
}

#[test]
fn pairing_link_round_trip() {
    let uri = link().to_uri().unwrap();
    assert!(uri.starts_with("lu://remote?v=2&id="));
    let back = PairingLink::parse(&uri).unwrap();
    assert_eq!(back.desktop_id, link().desktop_id);
    assert_eq!(back.desktop_x25519, link().desktop_x25519);
    assert_eq!(back.ticket.to_b64(), ticket().to_b64());
    assert_eq!(back.name, "Studio PC");
    assert_eq!(back.lan.as_deref(), Some("http://192.0.2.10:11435"));
    assert_eq!(back.tunnel.as_deref(), Some(ADDR));
    // Unknown keys are ignored (forward compatible).
    assert!(PairingLink::parse(&format!("{uri}&zz=1")).is_ok());
}

#[test]
fn pairing_link_rejects() {
    let uri = link().to_uri().unwrap();
    for bad in [
        uri.replace("v=2", "v=1"),
        uri.replace("lu://remote?", "lu://other?"),
        format!("{uri}&v=2"),
        uri.replace("net=https%3A%2F%2F", "net=http%3A%2F%2F"),
        uri.replace("lan=http%3A%2F%2F192.0.2.10%3A11435", "lan=http%3A%2F%2F192.0.2.10"),
    ] {
        assert!(PairingLink::parse(&bad).is_err(), "{bad}");
    }
    let mut l = link();
    l.lan = None;
    l.tunnel = None;
    assert_eq!(l.to_uri().err(), Some(SealError::BadLink));
    let mut l = link();
    l.name = "a\u{7}b".into();
    assert_eq!(l.to_uri().err(), Some(SealError::BadLink));
}

// -------------------------------------------------------------- vectors -----
//
// Fixed inputs: phone secret 32 x 0x11, desktop secret 32 x 0x22, ticket
// 16 x 0x33, time 1790000000, phone ephemeral 32 x 0x44, desktop ephemeral
// 32 x 0x45. Everything below is deterministic and printed in PROTOKOLL.md.

const V_PHONE_X25519: &str = "768b85zkkOJaXIHyJIRg2e612YrqMgSw9iOfg5kTWxc";
const V_PHONE_ED25519: &str = "QXJWeQNQ-SQ9-vxUYr6oP_y6nSLlKqV4Sk0ptG01gRc";
const V_PHONE_DEVICE_ID: &str = "58rMjVetyvNEolYoD_7S7Q";
const V_DESKTOP_X25519: &str = "BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4";
const V_DESKTOP_ED25519: &str = "sp0jamO9uo3YElgxfMkXIq7CQPmUeT7pwo1yktEt2jk";
const V_DESKTOP_ID: &str = "or24zD2Qk4Z7byxTVSh6WQ";
const V_TICKET_ID_HEX: &str = "e5d565ba8da1da25";
const V_TICKET_PSK_HEX: &str = "11fced63ec3178aa31fdfec976a38fbc8c08c879dfa13e744978e6382b8c3192";
const V_ANNOUNCE_SIG: &str = "QcEB6tTcjkOLl-_l0IHPz9oFUUBmAswu9dQO1458sJPiDnk0-8JDBkePKkZUU3JJtBbiwiLG4puaDXvfDM2FBA";
const V_SIGNIN_CODE: &str = "Zx9_k-2mQpLr7TbW";
const V_SIGNIN_SIG: &str = "1lQOegmy0E6BYpNVvhyC9-pFsJoJe-xr8fdQDsNS1w3qtvSrtIeigA2ETW6OTNaG7-Gx5VIvXuMMsmMoWJRQAQ";
const V_BIND_SIG: &str = "eCfR3elhT_yNRtSRxsR7-Y3yD1PLu753X9NMlpeLxnCkO0oR5D9UogVNS8Sa1gzQyso4ph9rQp6oFkdt91pxCg";
const V_HS1_SHA256_HEX: &str = "9f71e162f5a041515db0b970b32ced1172297822e907a2788c9eafc9e21ea379";
const V_HS2_SHA256_HEX: &str = "29743ecf7c948e309cf8afa6dc6ab4709f0f80e2726036f9568a63d9d9215823";
const V_SID: &str = "o14e4jOrR2JmBdWPRdLLRA";
/// QR path comparison code (label "lu-remote-v1/sas-qr\n").
const V_SAS: &str = "568868";
const V_HANDSHAKE_H_HEX: &str = "2733cd4c8e7fc7129eb3f9da19ca6b62d2dfc60abcfa231c5903ca7bef55d7c2";

fn unhex32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, o) in out.iter_mut().enumerate() {
        *o = u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap();
    }
    out
}
const V_DATA_HEX: &str = "0103a35e1ee233ab47626605d58f45d2cb440000000000000000001e3ba6f74851d62694d4145a22337a67b4ff88d3c038f0ceb4dd2916291605";

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

struct Vectors {
    phone_x: String,
    phone_ed: String,
    phone_dev: String,
    desk_x: String,
    desk_ed: String,
    desk_id: String,
    ticket_id: String,
    ticket_psk: String,
    announce_sig: String,
    signin_sig: String,
    bind_sig: String,
    hs1: String,
    hs2: String,
    sid: String,
    sas: String,
    sas_qr_h: String,
    data: String,
}

fn fixed_hello_phone(p: &DeviceSecret) -> PhoneHello {
    phone_hello(p)
}

fn compute_vectors() -> Vectors {
    let p = phone_secret();
    let d = desktop_secret();
    let t = ticket();
    let (hs, init) = PhoneHandshake::start_inner(
        &p,
        &d.desktop_id(),
        &d.x25519_public(),
        Some(&PairingSecret::Ticket(t.clone())),
        &fixed_hello_phone(&p),
        Some(&[0x44; 32]),
    )
    .unwrap();
    let dh = DesktopHandshake::read_init_inner(&d, &init, |_| Some(PairingSecret::Ticket(t.clone())), Some(&[0x45; 32])).unwrap();
    let (ds, resp) = dh.respond(&desktop_hello(&d, PairState::Pending, T0), T0).unwrap();
    let (ps, _) = hs.finish(&resp, T0).unwrap();
    assert_eq!(ps.id(), ds.id());
    let data = ps.seal(b"hello desktop", T0).unwrap();
    Vectors {
        phone_x: b64(&p.x25519_public()),
        phone_ed: b64(&p.ed25519_public()),
        phone_dev: p.device_id(),
        desk_x: b64(&d.x25519_public()),
        desk_ed: b64(&d.ed25519_public()),
        desk_id: d.desktop_id(),
        ticket_id: hex(&t.id()),
        ticket_psk: hex(&t.psk()[..]),
        announce_sig: sign_announce(&d, ADDR, T0).unwrap().signature,
        signin_sig: sign_signin(&p, V_SIGNIN_CODE, T0).unwrap(),
        bind_sig: sign_bind(&p),
        hs1: hex(&sha256(&[&init])),
        hs2: hex(&sha256(&[&resp])),
        sid: ps.id_b64(),
        sas: ps.sas().unwrap().to_string(),
        sas_qr_h: hex(&ps.h),
        data: hex(&data),
    }
}

/// `cargo test --lib remote_seal::tests::print_vectors -- --ignored --nocapture`
#[test]
#[ignore]
fn print_vectors() {
    let v = compute_vectors();
    println!("phone x25519   {}", v.phone_x);
    println!("phone ed25519  {}", v.phone_ed);
    println!("phone device   {}", v.phone_dev);
    println!("desk x25519    {}", v.desk_x);
    println!("desk ed25519   {}", v.desk_ed);
    println!("desktop_id     {}", v.desk_id);
    println!("ticket id      {}", v.ticket_id);
    println!("ticket psk     {}", v.ticket_psk);
    println!("announce msg   {:?}", String::from_utf8(announce_message(&v.desk_id, &v.desk_ed, ADDR, T0).unwrap()).unwrap());
    println!("announce sig   {}", v.announce_sig);
    println!("signin msg     {:?}", String::from_utf8(signin_message(V_SIGNIN_CODE, T0).unwrap()).unwrap());
    println!("signin sig     {}", v.signin_sig);
    println!("bind msg       {:?}", String::from_utf8(bind_message(&phone_secret().x25519_public())).unwrap());
    println!("bind sig       {}", v.bind_sig);
    println!("hs1 sha256     {}", v.hs1);
    println!("hs2 sha256     {}", v.hs2);
    println!("sid            {}", v.sid);
    println!("sas (qr)       {}", v.sas);
    println!("handshake h    {}", v.sas_qr_h);
    println!("data           {}", v.data);
    println!("hello phone    {}", serde_json::to_string(&fixed_hello_phone(&phone_secret())).unwrap());
    println!("hello desktop  {}", serde_json::to_string(&desktop_hello(&desktop_secret(), PairState::Pending, T0)).unwrap());
    println!("link           {}", link().to_uri().unwrap());
}

#[test]
fn test_vectors_hold() {
    let v = compute_vectors();
    assert_eq!(v.phone_x, V_PHONE_X25519);
    assert_eq!(v.phone_ed, V_PHONE_ED25519);
    assert_eq!(v.phone_dev, V_PHONE_DEVICE_ID);
    assert_eq!(v.desk_x, V_DESKTOP_X25519);
    assert_eq!(v.desk_ed, V_DESKTOP_ED25519);
    assert_eq!(v.desk_id, V_DESKTOP_ID);
    assert_eq!(v.ticket_id, V_TICKET_ID_HEX);
    assert_eq!(v.ticket_psk, V_TICKET_PSK_HEX);
    assert_eq!(v.announce_sig, V_ANNOUNCE_SIG);
    assert_eq!(v.signin_sig, V_SIGNIN_SIG);
    assert_eq!(v.bind_sig, V_BIND_SIG);
    assert_eq!(v.hs1, V_HS1_SHA256_HEX);
    assert_eq!(v.hs2, V_HS2_SHA256_HEX);
    assert_eq!(v.sid, V_SID);
    assert_eq!(v.sas, V_SAS);
    assert_eq!(v.sas_qr_h, V_HANDSHAKE_H_HEX);
    assert_eq!(sas_digits_qr(&unhex32(V_HANDSHAKE_H_HEX)), V_SAS);
    assert_eq!(v.data, V_DATA_HEX);
    // The vectors verify with the public functions alone (what Web runs).
    let a = Announce {
        desktop_id: V_DESKTOP_ID.into(),
        ed25519_pub: V_DESKTOP_ED25519.into(),
        address: ADDR.into(),
        time: T0,
        signature: V_ANNOUNCE_SIG.into(),
    };
    verify_announce(&a, T0).unwrap();
    verify_signin(V_PHONE_ED25519, V_SIGNIN_CODE, T0, V_SIGNIN_SIG, T0).unwrap();
}

#[test]
fn x25519_matches_rfc7748() {
    // RFC 7748 section 6.1, Alice: our X25519 path gives the RFC public key.
    let alice_priv: [u8; 32] = [
        0x77, 0x07, 0x6d, 0x0a, 0x73, 0x18, 0xa5, 0x7d, 0x3c, 0x16, 0xc1, 0x72, 0x51, 0xb2, 0x66, 0x45, 0xdf, 0x4c, 0x2f, 0x87, 0xeb,
        0xc0, 0x99, 0x2a, 0xb1, 0x77, 0xfb, 0xa5, 0x1d, 0xb9, 0x2c, 0x2a,
    ];
    assert_eq!(
        hex(&x25519_public_from_private(&alice_priv)),
        "8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a"
    );
}

#[test]
fn ed25519_matches_rfc8032() {
    // RFC 8032 section 7.1, test 1 (empty message).
    let seed: [u8; 32] = [
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c, 0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b,
        0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae, 0x7f, 0x60,
    ];
    let kp = Ed25519KeyPair::from_seed_unchecked(&seed).unwrap();
    assert_eq!(
        hex(kp.public_key().as_ref()),
        "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"
    );
    assert_eq!(
        hex(kp.sign(b"").as_ref()),
        "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b"
    );
}

// ------------------------------------------------------- review R50b -----

/// What the answering side knows about the comparison code at the moment it
/// sends its answer.
fn responder_prediction(ds: &Session) -> Option<String> {
    ds.sas().map(str::to_string)
}

#[test]
fn responder_cannot_know_the_phone_comparison_code_when_it_answers() {
    // On the code path the answering side moves last: it picks its ephemeral
    // key after it has seen the phone's message. If it could compute the
    // code the phone will show, it could try keys until that code matches
    // the one of its own session with the real desktop.
    let p = phone_secret();
    let m = DeviceSecret::from_bytes([0x66; 32]);
    let code = PairingSecret::code("482913").unwrap();
    let (hs, init) = PhoneHandshake::start(&p, &m.desktop_id(), &m.x25519_public(), Some(&code), &phone_hello(&p)).unwrap();
    let mdh = DesktopHandshake::read_init(&m, &init, |_| Some(code.clone())).unwrap();
    let (m_side, resp) = mdh.respond(&desktop_hello(&m, PairState::Pending, T0), T0).unwrap();
    let prediction = responder_prediction(&m_side);
    let (ps, _) = hs.finish(&resp, T0).unwrap();
    let shown = ps.sas().map(str::to_string);
    assert!(shown.is_some(), "the phone knows its code right away");
    assert!(
        prediction.is_none() || prediction != shown,
        "the answering side knew the phone's comparison code before the phone revealed anything"
    );
}

#[test]
fn encoded_letters_cannot_reach_forbidden_inner_paths() {
    for bad in ["/remote-api/au%74h", "/remote-api/%73ealed", "/remote-api/Au%54H/", "/api/x%", "/api/x%4", "/api/x%zz"] {
        assert_eq!(check_inner_path(bad), Err(SealError::ForbiddenPath), "{bad}");
    }
    for ok in ["/api/files/my%20doc.txt", "/api/files/a%2Bb"] {
        assert_eq!(check_inner_path(ok), Ok(()), "{ok}");
    }
}

#[test]
fn desktop_hello_expiry_does_not_overflow() {
    let h = desktop_hello(&desktop_secret(), PairState::Paired, u64::MAX - 5);
    assert_eq!(h.expires, u64::MAX);
}

#[test]
fn phone_hello_fields_are_checked_at_the_desktop() {
    let p = phone_secret();
    let d = desktop_secret();
    for (platform, version) in [("android\u{1b}[2J", "3.0.7"), ("android", "3.0.7\n"), ("android", &"9".repeat(65)[..])] {
        let hello = PhoneHello::new(&p, "Pixel 8", platform, version);
        let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &hello).unwrap();
        assert_eq!(DesktopHandshake::read_init(&d, &init, |_| None).err(), Some(SealError::BadInner), "{platform:?} {version:?}");
    }
}

#[test]
fn code_pairing_without_commitment_is_refused() {
    // A phone message on the code path that carries no commitment (an old or
    // forged client) is refused before any session exists.
    let p = phone_secret();
    let d = desktop_secret();
    let code = PairingSecret::code("482913").unwrap();
    let psk = code.psk();
    let private = p.x25519_private();
    let desk = d.x25519_public();
    let mut hs = builder(NOISE_IKPSK1)
        .local_private_key(&private[..])
        .and_then(|b| b.remote_public_key(&desk))
        .and_then(|b| b.prologue(PROLOGUE))
        .and_then(|b| b.psk(1, &psk))
        .and_then(|b| b.build_initiator())
        .unwrap();
    let payload = serde_json::to_vec(&phone_hello(&p)).unwrap();
    let mut buf = vec![0u8; NOISE_MAX];
    let n = hs.write_message(&payload, &mut buf).unwrap();
    let mut init = vec![CHANNEL_VERSION, KIND_HS_INIT, 0x02];
    init.extend_from_slice(&buf[..n]);
    assert_eq!(
        DesktopHandshake::read_init(&d, &init, |_| Some(PairingSecret::code("482913").unwrap())).err(),
        Some(SealError::BadInner)
    );
}

// ------------------------------------------------------- review N1, M4 -----

#[test]
fn names_with_format_or_separator_characters_are_refused() {
    let bad = [
        "Pixel\u{200B}8",       // Cf zero width space
        "Pixel\u{200D}8",       // Cf zero width joiner
        "\u{FEFF}Pixel 8",      // Cf byte order mark
        "Pixel \u{00AD}8",      // Cf soft hyphen
        "Pixel \u{202E}8 lexiP", // Cf bidi override
        "Pixel \u{202A}8",      // Cf bidi embedding
        "Pixel \u{2066}8",      // Cf bidi isolate
        "Pixel \u{2069}8",      // Cf pop isolate
        "Pixel \u{200E}8",      // Cf left to right mark
        "Pixel \u{200F}8",      // Cf right to left mark
        "Pixel \u{061C}8",      // Cf arabic letter mark
        "Pixel \u{E0041}8",     // Cf tag character
        "Pixel\u{2028}8",       // Zl line separator
        "Pixel\u{2029}8",       // Zp paragraph separator
        "Pixel\n8",             // Cc
        " \u{7}Pixel 8",        // Cc, also after trimming
    ];
    for name in bad {
        assert_eq!(normalize_name(name), Err(SealError::BadLink), "{name:?}");
        let mut l = link();
        l.name = name.into();
        assert_eq!(l.to_uri().err(), Some(SealError::BadLink), "{name:?}");
        // The same name sent in a phone hello is refused by the desktop.
        let p = phone_secret();
        let d = desktop_secret();
        let hello = PhoneHello::new(&p, name, "android", "3.0.7");
        let (_, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &hello).unwrap();
        assert_eq!(DesktopHandshake::read_init(&d, &init, |_| None).err(), Some(SealError::BadInner), "{name:?}");
    }
}

#[test]
fn names_are_trimmed_and_white_space_runs_collapsed() {
    assert_eq!(normalize_name("  Pixel   8  ").unwrap(), "Pixel 8");
    assert_eq!(normalize_name("Studio\u{00A0}\u{3000} PC").unwrap(), "Studio PC");
    assert_eq!(normalize_name("   "), Err(SealError::BadLink));
    assert_eq!(normalize_name(""), Err(SealError::BadLink));
    // The length limit counts after normalizing.
    let padded = format!("   {}   ", "x".repeat(64));
    assert_eq!(normalize_name(&padded).unwrap().len(), 64);
    assert_eq!(normalize_name(&"x".repeat(65)), Err(SealError::BadLink));
    assert_eq!(normalize_name(&"\u{1F600}".repeat(64)).unwrap().len(), 256);
    assert_eq!(normalize_name(&"\u{1F600}".repeat(65)), Err(SealError::BadLink));
    // The link carries the normalized name, and parse normalizes too.
    let mut l = link();
    l.name = "  Studio    PC ".into();
    let uri = l.to_uri().unwrap();
    assert_eq!(PairingLink::parse(&uri).unwrap().name, "Studio PC");
    let raw = link().to_uri().unwrap().replace("n=Studio+PC", "n=+Studio++PC+");
    assert_eq!(PairingLink::parse(&raw).unwrap().name, "Studio PC");
    // Both hellos come out normalized.
    let p = phone_secret();
    let d = desktop_secret();
    let hello = PhoneHello::new(&p, " Pixel \u{2003} 8 ", "android", "3.0.7");
    let (hs, init) = PhoneHandshake::start(&p, &d.desktop_id(), &d.x25519_public(), None, &hello).unwrap();
    let dh = DesktopHandshake::read_init(&d, &init, |_| None).unwrap();
    assert_eq!(dh.hello().name, "Pixel 8");
    let dhello = DesktopHello::new(&d, "  Studio   PC", PairState::Paired, vec![], T0);
    let (_, resp) = dh.respond(&dhello, T0).unwrap();
    assert_eq!(hs.finish(&resp, T0).unwrap().1.name, "Studio PC");
}

#[test]
fn names_with_umlauts_and_emoji_stay_valid() {
    for name in ["Jürgens Hände-Gerät", "Straße", "Phone \u{1F4F1}", "\u{1F600}\u{1F680}", "Zoë's iPhone", "東京のPC"] {
        assert_eq!(normalize_name(name).unwrap(), name);
        let mut l = link();
        l.name = name.into();
        assert_eq!(PairingLink::parse(&l.to_uri().unwrap()).unwrap().name, name);
    }
}

#[test]
fn qr_pairing_has_a_comparison_code_on_both_sides_right_away() {
    let (ps, ds, _, _) = handshake(true);
    let code = ps.sas().unwrap();
    assert_eq!(ds.sas(), Some(code));
    assert!(code.len() == 6 && code.bytes().all(|b| b.is_ascii_digit()));
    assert_eq!(code, sas_digits_qr(&ps.h));
    assert_eq!(ps.sas_reveal(), None);
}

#[test]
fn known_device_has_no_comparison_code() {
    let (ps, ds, _, _) = handshake(false);
    assert_eq!(ps.sas(), None);
    assert_eq!(ds.sas(), None);
    assert_eq!(ds.accept_sas_reveal(&b64(&[0u8; 32])), Err(SealError::BadReveal));
}

#[test]
fn qr_and_code_paths_never_share_a_comparison_code_for_one_hash() {
    // Own label per path: the hash input differs, so the same handshake hash
    // gives unrelated codes.
    let nonce = [0x55u8; 32];
    for i in 0..=255u8 {
        let h = sha256(&[b"h", &[i]]);
        assert_ne!(sha256(&[L_SAS_QR, &h]), sha256(&[L_SAS, &h, &nonce]));
        assert_ne!(sas_digits_qr(&h), sas_digits(&h, &nonce), "{i}");
        // Nor with the code path's label and no nonce (the old QR rule).
        assert_ne!(sas_digits_qr(&h), digits6(&sha256(&[L_SAS, &h])), "{i}");
    }
}
