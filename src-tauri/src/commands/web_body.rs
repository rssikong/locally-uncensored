//! The body of a fetched page, before it becomes text for a model.
//!
//! Two things went wrong on a phone (acceptance on Android with 8 GB, B2):
//! `web_fetch` on python.org answered "Status: 200" and then unreadable
//! characters. The server sends its page gzip-packed whether the request asks
//! for that or not, which HTTP allows: a request without `Accept-Encoding`
//! accepts every coding. Our HTTP client is built without its unpacking
//! features (they would change every download of the app, not only this
//! one), so the packed bytes were read as text and handed to the model.
//!
//! So this file unpacks what a server may send (`gzip`, `deflate`, `br`,
//! `zstd`, also stacked), and it says when a body is no text at all: a PDF, an
//! image, an archive. A model never gets bytes dressed up as a page.
//!
//! Pure: no network, no client. `search.rs` does the request and asks here.
//! The three crates are in the build already (png, tauri-utils and zip bring
//! them), so naming them adds none.

use std::io::Read;

/// The most a body may grow to when it is unpacked. The reader keeps 24 000
/// characters of a page, so this is generous, and it is what stops a small
/// packed body from unfolding into gigabytes.
pub(crate) const MAX_UNPACKED: usize = 8 * 1024 * 1024;

/// The most codings a server may stack on one body. Nobody sends more than
/// two. Each layer may unfold to `MAX_UNPACKED`, so without this number a
/// header with hundreds of entries buys hundreds of rounds of unpacking.
pub(crate) const MAX_CODINGS: usize = 3;

const TOO_LARGE: &str = "it unpacks to more than";

/// Unpack one layer, counting what comes out as it comes out. One byte more
/// than `MAX_UNPACKED` ends it with a reason: a body that unfolds past the
/// limit is refused, the same as a body that is too large on the wire. The
/// decoders are streams, so no more than the limit is ever held.
fn read_capped<R: Read>(mut reader: R, what: &str) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut limited = (&mut reader).take(MAX_UNPACKED as u64 + 1);
    let read = limited.read_to_end(&mut out);
    if out.len() > MAX_UNPACKED {
        return Err(format!("{TOO_LARGE} {} MB", MAX_UNPACKED / (1024 * 1024)));
    }
    match read {
        Ok(_) => Ok(out),
        // A stream that breaks after it gave real content (a cut connection)
        // still carries the top of the page, and the top is what gets read.
        Err(_) if out.len() >= 1024 => Ok(out),
        Err(e) => Err(format!("the {what} packing of the page could not be opened ({})", crate::os_error::english(&e))),
    }
}

fn unpack_one(raw: &[u8], coding: &str) -> Result<Vec<u8>, String> {
    match coding {
        "" | "identity" => Ok(raw.to_vec()),
        "gzip" | "x-gzip" => read_capped(flate2::read::MultiGzDecoder::new(raw), "gzip"),
        // "deflate" means the zlib wrapper, and some servers send the bare
        // stream instead. Both are tried, the wrapper first.
        // A body that opened and grew past the limit is refused as that, and
        // not tried a second way.
        "deflate" => match read_capped(flate2::read::ZlibDecoder::new(raw), "deflate") {
            Err(reason) if !reason.starts_with(TOO_LARGE) => {
                read_capped(flate2::read::DeflateDecoder::new(raw), "deflate")
            }
            other => other,
        },
        "br" => read_capped(brotli::Decompressor::new(raw, 4096), "brotli"),
        "zstd" => match zstd::stream::read::Decoder::new(raw) {
            Ok(decoder) => read_capped(decoder, "zstd"),
            Err(e) => Err(format!("the zstd packing of the page could not be opened ({})", crate::os_error::english(&e))),
        },
        other => Err(format!("the page is packed with \"{other}\", which cannot be opened here")),
    }
}

/// Undo the `Content-Encoding` of a body. The header lists the codings in the
/// order they were applied, so they are undone from the last to the first.
pub(crate) fn unpack(raw: &[u8], content_encoding: &str) -> Result<Vec<u8>, String> {
    let codings: Vec<String> = content_encoding
        .split(',')
        .map(|c| c.trim().to_ascii_lowercase())
        .filter(|c| !c.is_empty() && c != "identity")
        .collect();
    if codings.len() > MAX_CODINGS {
        return Err(format!(
            "it is packed {} times over, and more than {} layers are not opened",
            codings.len(),
            MAX_CODINGS
        ));
    }
    let mut body = raw.to_vec();
    for coding in codings.iter().rev() {
        body = unpack_one(&body, coding)?;
    }
    Ok(body)
}

/// The media type of a `Content-Type` header, without its parameters.
fn media_type(content_type: &str) -> String {
    content_type.split(';').next().unwrap_or("").trim().to_ascii_lowercase()
}

/// A type that is text whatever its bytes look like to a sniffer.
fn is_text_type(media: &str) -> bool {
    media.starts_with("text/")
        || media.ends_with("+xml")
        || media.ends_with("+json")
        || matches!(
            media,
            "application/json"
                | "application/xml"
                | "application/xhtml+xml"
                | "application/javascript"
                | "application/x-javascript"
                | "application/ld+json"
                | "application/rss+xml"
                | "application/atom+xml"
                | "application/x-www-form-urlencoded"
        )
}

/// A type that is never text.
fn is_binary_type(media: &str) -> bool {
    media.starts_with("image/") && media != "image/svg+xml"
        || media.starts_with("audio/")
        || media.starts_with("video/")
        || media.starts_with("font/")
        || matches!(
            media,
            "application/pdf"
                | "application/zip"
                | "application/gzip"
                | "application/x-gzip"
                | "application/x-tar"
                | "application/x-7z-compressed"
                | "application/x-rar-compressed"
                | "application/vnd.rar"
                | "application/x-bzip2"
                | "application/x-xz"
                | "application/zstd"
                | "application/octet-stream"
                | "application/wasm"
                | "application/msword"
                | "application/vnd.ms-excel"
                | "application/vnd.ms-powerpoint"
                | "application/epub+zip"
                | "application/x-apple-diskimage"
                | "application/vnd.android.package-archive"
                | "application/x-msdownload"
        )
        || media.starts_with("application/vnd.openxmlformats-officedocument")
}

/// What the first bytes say the body is, for the kinds that are never text.
fn magic_kind(bytes: &[u8]) -> Option<&'static str> {
    const MAGIC: &[(&[u8], &str)] = &[
        (b"%PDF-", "a PDF"),
        (b"PK\x03\x04", "an archive"),
        (b"\x1f\x8b", "a packed file"),
        (b"\x28\xb5\x2f\xfd", "a packed file"),
        (b"\x89PNG\r\n", "an image"),
        (b"\xff\xd8\xff", "an image"),
        (b"GIF87a", "an image"),
        (b"GIF89a", "an image"),
        (b"RIFF", "a media file"),
        (b"\x00\x00\x00\x18ftyp", "a media file"),
        (b"\x00\x00\x00\x1cftyp", "a media file"),
        (b"\x00\x00\x00\x20ftyp", "a media file"),
        (b"ID3", "an audio file"),
        (b"OggS", "a media file"),
        (b"\x7fELF", "a program"),
        (b"MZ\x90\x00", "a program"),
        (b"7z\xbc\xaf\x27\x1c", "an archive"),
        (b"Rar!", "an archive"),
        (b"wOFF", "a font"),
        (b"wOF2", "a font"),
    ];
    MAGIC.iter().find(|(magic, _)| bytes.starts_with(magic)).map(|(_, kind)| *kind)
}

/// The share of the first bytes that no text contains: NUL and the control
/// characters other than tab, line feed, form feed and carriage return.
fn control_share(bytes: &[u8]) -> f32 {
    let head = &bytes[..bytes.len().min(4096)];
    if head.is_empty() {
        return 0.0;
    }
    let odd = head.iter().filter(|b| matches!(**b, 0..=8 | 11 | 14..=31 | 127)).count();
    odd as f32 / head.len() as f32
}

fn declares_wide_charset(content_type: &str) -> bool {
    let lower = content_type.to_ascii_lowercase();
    lower.contains("utf-16") || lower.contains("utf-32") || lower.contains("ucs-2")
}

/// Is this body something other than text? `Some(kind)` names what it is in
/// two or three words, for the sentence the model reads.
///
/// The header decides where it is clear. Where it is silent or vague, the
/// bytes are asked: a known file signature, or control characters no page of
/// text has. A body that says it is UTF-16 is full of NUL bytes and is text.
pub(crate) fn not_text(content_type: &str, bytes: &[u8]) -> Option<String> {
    let media = media_type(content_type);
    if is_binary_type(&media) {
        return Some(match magic_kind(bytes) {
            Some(kind) => kind.to_string(),
            None if media == "application/octet-stream" => "a file".to_string(),
            None => format!("a file of the type {media}"),
        });
    }
    if let Some(kind) = magic_kind(bytes) {
        return Some(kind.to_string());
    }
    if declares_wide_charset(content_type) || bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        return None;
    }
    if is_text_type(&media) && control_share(bytes) < 0.10 {
        return None;
    }
    if control_share(bytes) >= 0.02 {
        return Some("a file that is not text".to_string());
    }
    None
}

/// The one sentence a model reads in place of a body that is no text.
pub(crate) fn not_text_sentence(kind: &str) -> String {
    format!(
        "This address returned {kind}, not a page of text, so it cannot be read here. Use a different address, or tell the user what the link points to."
    )
}

/// The same for a body whose packing could not be undone.
pub(crate) fn unpack_failed_sentence(reason: &str) -> String {
    format!("This page cannot be read: {reason}. Use a different address.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const PAGE: &str = "<!doctype html><html><head><title>Python Release</title></head><body><p>Python 3.15.0 is the newest release.</p></body></html>";

    fn gzip(data: &[u8]) -> Vec<u8> {
        let mut e = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    fn zlib(data: &[u8]) -> Vec<u8> {
        let mut e = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    fn raw_deflate(data: &[u8]) -> Vec<u8> {
        let mut e = flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        e.write_all(data).unwrap();
        e.finish().unwrap()
    }

    fn br(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        {
            let mut w = brotli::CompressorWriter::new(&mut out, 4096, 5, 22);
            w.write_all(data).unwrap();
        }
        out
    }

    fn zst(data: &[u8]) -> Vec<u8> {
        zstd::stream::encode_all(data, 3).unwrap()
    }

    #[test]
    fn a_gzip_page_is_unpacked() {
        let packed = gzip(PAGE.as_bytes());
        assert_ne!(packed, PAGE.as_bytes());
        assert_eq!(unpack(&packed, "gzip").unwrap(), PAGE.as_bytes());
        assert_eq!(unpack(&packed, "x-gzip").unwrap(), PAGE.as_bytes());
        assert_eq!(unpack(&packed, " GZIP ").unwrap(), PAGE.as_bytes());
    }

    #[test]
    fn a_deflate_page_is_unpacked_with_and_without_the_zlib_wrapper() {
        assert_eq!(unpack(&zlib(PAGE.as_bytes()), "deflate").unwrap(), PAGE.as_bytes());
        assert_eq!(unpack(&raw_deflate(PAGE.as_bytes()), "deflate").unwrap(), PAGE.as_bytes());
    }

    #[test]
    fn a_brotli_page_is_unpacked() {
        assert_eq!(unpack(&br(PAGE.as_bytes()), "br").unwrap(), PAGE.as_bytes());
    }

    #[test]
    fn a_zstd_page_is_unpacked() {
        assert_eq!(unpack(&zst(PAGE.as_bytes()), "zstd").unwrap(), PAGE.as_bytes());
    }

    #[test]
    fn stacked_codings_are_undone_from_the_last_to_the_first() {
        let packed = br(&gzip(PAGE.as_bytes()));
        assert_eq!(unpack(&packed, "gzip, br").unwrap(), PAGE.as_bytes());
    }

    #[test]
    fn no_coding_and_identity_leave_the_body_alone() {
        assert_eq!(unpack(PAGE.as_bytes(), "").unwrap(), PAGE.as_bytes());
        assert_eq!(unpack(PAGE.as_bytes(), "identity").unwrap(), PAGE.as_bytes());
    }

    #[test]
    fn an_unknown_coding_and_a_broken_body_are_refused_with_a_reason() {
        let unknown = unpack(PAGE.as_bytes(), "compress").unwrap_err();
        assert!(unknown.contains("\"compress\""), "{unknown}");
        // Text that claims to be gzip: the reason names the coding, the bytes never come back as text.
        let broken = unpack(PAGE.as_bytes(), "gzip").unwrap_err();
        assert!(broken.contains("gzip"), "{broken}");
        assert!(unpack(PAGE.as_bytes(), "zstd").is_err());
    }

    #[test]
    fn a_small_body_cannot_unfold_without_end() {
        let zeros = vec![b'a'; MAX_UNPACKED + 4096];
        let packed = gzip(&zeros);
        assert!(packed.len() < 64 * 1024);
        let refused = unpack(&packed, "gzip").unwrap_err();
        assert_eq!(refused, "it unpacks to more than 8 MB");
        // Exactly the limit is still a page.
        let full = gzip(&vec![b'a'; MAX_UNPACKED]);
        assert_eq!(unpack(&full, "gzip").unwrap().len(), MAX_UNPACKED);
        // Every coding counts what it gives out, not only gzip.
        let zeros = vec![0u8; MAX_UNPACKED + 1];
        for (packed, coding) in [
            (zlib(&zeros), "deflate"),
            (raw_deflate(&zeros), "deflate"),
            (br(&zeros), "br"),
            (zst(&zeros), "zstd"),
        ] {
            assert_eq!(unpack(&packed, coding).unwrap_err(), "it unpacks to more than 8 MB", "{coding}");
        }
    }

    /// A bomb in layers: every layer is small, the innermost unfolds past the
    /// limit. The count is per layer, so it ends at the layer that grows.
    #[test]
    fn a_bomb_in_layers_ends_at_the_layer_that_grows() {
        let inner = gzip(&vec![0u8; 3 * MAX_UNPACKED]);
        let outer = gzip(&gzip(&inner));
        assert!(outer.len() < 64 * 1024, "{}", outer.len());
        assert_eq!(unpack(&outer, "gzip, gzip, gzip").unwrap_err(), "it unpacks to more than 8 MB");
    }

    #[test]
    fn more_than_three_stacked_codings_are_refused_before_any_is_opened() {
        let three = gzip(&gzip(&gzip(PAGE.as_bytes())));
        assert_eq!(unpack(&three, "gzip, gzip, gzip").unwrap(), PAGE.as_bytes());
        // identity is no layer and does not count.
        assert_eq!(unpack(&three, "identity, gzip, gzip, identity, gzip").unwrap(), PAGE.as_bytes());
        let four = gzip(&three);
        let refused = unpack(&four, "gzip, gzip, gzip, gzip").unwrap_err();
        assert_eq!(refused, "it is packed 4 times over, and more than 3 layers are not opened");
        // Hundreds of entries cost nothing: the body is not even looked at.
        let many = vec!["gzip"; 500].join(", ");
        assert!(unpack(b"not gzip at all", &many).unwrap_err().contains("500 times"));
    }

    #[test]
    fn a_packed_body_that_was_never_unpacked_is_not_text() {
        // The case of the acceptance run: gzip bytes under a text/html header.
        let packed = gzip(PAGE.as_bytes());
        assert_eq!(not_text("text/html; charset=utf-8", &packed).as_deref(), Some("a packed file"));
        assert_eq!(not_text("text/html", &zst(PAGE.as_bytes())).as_deref(), Some("a packed file"));
    }

    #[test]
    fn files_are_named_for_what_they_are() {
        assert_eq!(not_text("application/pdf", b"%PDF-1.7\n...").as_deref(), Some("a PDF"));
        assert_eq!(not_text("", b"%PDF-1.7\n...").as_deref(), Some("a PDF"));
        assert_eq!(not_text("image/png", b"\x89PNG\r\n\x1a\n").as_deref(), Some("an image"));
        assert_eq!(not_text("image/webp", b"RIFF....WEBP").as_deref(), Some("a media file"));
        assert_eq!(not_text("application/octet-stream", b"\x01\x02\x03").as_deref(), Some("a file"));
        assert_eq!(not_text("video/mp4", b"").as_deref(), Some("a file of the type video/mp4"));
        assert_eq!(not_text("text/plain", &[0u8, 1, 2, 3, 4, 5, 6, 7, 8, 9]).as_deref(), Some("a file that is not text"));
        assert_eq!(not_text("", &[b'a', 0, b'b', 0, 1, 2]).as_deref(), Some("a file that is not text"));
    }

    #[test]
    fn pages_and_data_stay_text() {
        assert_eq!(not_text("text/html; charset=utf-8", PAGE.as_bytes()), None);
        assert_eq!(not_text("", PAGE.as_bytes()), None);
        assert_eq!(not_text("application/json", br#"{"a": 1}"#), None);
        assert_eq!(not_text("image/svg+xml", b"<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), None);
        assert_eq!(not_text("text/plain", "Gr\u{fc}\u{df}e aus K\u{f6}ln, \u{65e5}\u{672c}\u{8a9e}".as_bytes()), None);
        // Latin-1 bytes are not UTF-8 and still a page.
        assert_eq!(not_text("text/html; charset=iso-8859-1", b"Gr\xfc\xdfe aus K\xf6ln"), None);
        // UTF-16 is full of NUL bytes and is text.
        let wide: Vec<u8> = "hello".encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        assert_eq!(not_text("text/html; charset=utf-16le", &wide), None);
        assert_eq!(not_text("text/plain", b""), None);
    }

    #[test]
    fn the_sentences_say_what_happened_and_what_to_do() {
        let s = not_text_sentence("a PDF");
        assert!(s.starts_with("This address returned a PDF, not a page of text"));
        assert!(s.contains("different address"));
        let u = unpack_failed_sentence("the page is packed with \"compress\", which cannot be opened here");
        assert!(u.starts_with("This page cannot be read: the page is packed with"));
        for text in [s, u] {
            assert!(!text.contains('\u{2014}') && !text.contains('\u{2013}'));
        }
    }
}
