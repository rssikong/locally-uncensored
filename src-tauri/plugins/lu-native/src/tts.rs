//! Read aloud with the voice of the system.
//!
//! The page reads aloud through `speechSynthesis` where the webview has it.
//! The Android WebView has none, so there the page found no voice at all and
//! said "This phone has no voice installed" on a phone that speaks. Here the
//! system is asked directly: `TextToSpeech` on Android (Tts.kt) and
//! `AVSpeechSynthesizer` on iOS (Tts.swift), where it is the way back when
//! `speechSynthesis` is missing or stays silent.
//!
//! Three commands (`tts_voices`, `tts_speak`, `tts_stop`) and three events
//! (`tts-start`, `tts-end`, `tts-error`). One text is spoken at a time: a
//! new `tts_speak` ends the running one first, and that one still gets its
//! `tts-end` with `stopped: true`. Signatures: mobile-docs/r3/rust.md.
//!
//! What is pure lives here and is tested on the desktop: what a request may
//! look like before it reaches native code, and how the list of voices is
//! put in order.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

use crate::error::{Error, Result};
use crate::LuNativeExt;

/// Longer texts are cut here. A chat answer is far below it, and a text
/// without end would keep the phone talking for an hour.
pub const MAX_TEXT_CHARS: usize = 32_000;
/// 1.0 is the normal speed of the voice.
pub const RATE_MIN: f32 = 0.5;
pub const RATE_MAX: f32 = 2.0;

pub const NO_TEXT: &str = "There is no text to read aloud.";
pub const BAD_VOICE: &str = "That voice is not valid.";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoice {
    /// What `tts_speak` takes as `voice`.
    pub id: String,
    pub name: String,
    /// BCP 47, for example `en-US`.
    pub lang: String,
    /// True when the voice speaks without a network.
    #[serde(default)]
    pub local: bool,
    /// True for the voice the system uses when none is named.
    #[serde(default)]
    pub default: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsVoices {
    /// False when the device has no speech engine at all.
    pub available: bool,
    #[serde(default)]
    pub voices: Vec<TtsVoice>,
}

/// What reaches native code.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TtsRequest {
    pub id: String,
    pub text: String,
    pub voice: Option<String>,
    pub lang: Option<String>,
    pub rate: f32,
}

/// Check and tidy one request to speak.
pub fn prepare(
    id: String,
    text: &str,
    voice: Option<String>,
    rate: Option<f32>,
    lang: Option<String>,
) -> Result<TtsRequest> {
    // Control characters are nothing a voice can say, and some engines stop
    // at a NUL. Line breaks stay: they are pauses.
    let cleaned: String = text
        .chars()
        .map(|c| if c.is_control() && c != '\n' { ' ' } else { c })
        .collect();
    let cleaned = cleaned.trim();
    if cleaned.is_empty() {
        return Err(Error::new(NO_TEXT));
    }
    let text: String = cleaned.chars().take(MAX_TEXT_CHARS).collect();

    let voice = match voice.map(|v| v.trim().to_string()) {
        Some(v) if v.is_empty() => None,
        Some(v) if v.chars().count() > 200 || v.chars().any(char::is_control) => {
            return Err(Error::new(BAD_VOICE));
        }
        other => other,
    };
    // A language tag that is not one is left out, the voice or the system
    // decides then.
    let lang = lang.map(|l| l.trim().to_string()).filter(|l| {
        (2..=35).contains(&l.len()) && l.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    });
    let rate = match rate {
        Some(r) if r.is_finite() => r.clamp(RATE_MIN, RATE_MAX),
        _ => 1.0,
    };
    Ok(TtsRequest { id, text, voice, lang, rate })
}

/// One entry per voice, in the order a list shows them: by language, then
/// by name. Entries without an id or a language cannot be chosen and go.
pub fn tidy_voices(mut voices: Vec<TtsVoice>) -> Vec<TtsVoice> {
    voices.retain(|v| !v.id.trim().is_empty() && !v.lang.trim().is_empty());
    for v in &mut voices {
        v.lang = v.lang.replace('_', "-");
        if v.name.trim().is_empty() {
            v.name = v.id.clone();
        }
    }
    voices.sort_by(|a, b| {
        (a.lang.to_lowercase(), a.name.to_lowercase(), &a.id).cmp(&(b.lang.to_lowercase(), b.name.to_lowercase(), &b.id))
    });
    voices.dedup_by(|a, b| a.id == b.id);
    voices
}

/// The voices of the system. On a desktop: not available, no voices.
pub async fn voices<R: Runtime>(app: &AppHandle<R>) -> Result<TtsVoices> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(TtsVoices { available: false, voices: Vec::new() });
    }
    let answer: TtsVoices = native.call("ttsVoices", json!({})).await?;
    Ok(TtsVoices { available: answer.available, voices: tidy_voices(answer.voices) })
}

/// Start reading aloud. Answers the id the three events carry.
pub async fn speak<R: Runtime>(
    app: &AppHandle<R>,
    text: &str,
    voice: Option<String>,
    rate: Option<f32>,
    lang: Option<String>,
) -> Result<String> {
    let request = prepare(uuid::Uuid::new_v4().to_string(), text, voice, rate, lang)?;
    let id = request.id.clone();
    let _: Value = app.lu_native().call("ttsSpeak", request).await?;
    Ok(id)
}

/// Stop reading aloud. Nothing running is not an error.
pub async fn stop<R: Runtime>(app: &AppHandle<R>) -> Result<()> {
    let native = app.lu_native();
    if !native.available() {
        return Ok(());
    }
    let _: Value = native.call("ttsStop", json!({})).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn voice(id: &str, name: &str, lang: &str) -> TtsVoice {
        TtsVoice { id: id.into(), name: name.into(), lang: lang.into(), local: true, default: false }
    }

    #[test]
    fn a_plain_request_passes_with_normal_speed() {
        let r = prepare("a".into(), "  Hello there.  ", None, None, None).unwrap();
        assert_eq!(r, TtsRequest { id: "a".into(), text: "Hello there.".into(), voice: None, lang: None, rate: 1.0 });
    }

    #[test]
    fn nothing_to_say_is_refused() {
        assert_eq!(prepare("a".into(), "", None, None, None).unwrap_err().0, NO_TEXT);
        assert_eq!(prepare("a".into(), " \n\t\u{0} ", None, None, None).unwrap_err().0, NO_TEXT);
    }

    #[test]
    fn control_characters_go_and_line_breaks_stay() {
        let r = prepare("a".into(), "one\u{0}two\nthree\u{7}", None, None, None).unwrap();
        assert_eq!(r.text, "one two\nthree");
    }

    #[test]
    fn a_text_without_end_is_cut_at_a_character() {
        let long = "ä".repeat(MAX_TEXT_CHARS + 50);
        let r = prepare("a".into(), &long, None, None, None).unwrap();
        assert_eq!(r.text.chars().count(), MAX_TEXT_CHARS);
    }

    #[test]
    fn speed_stays_between_half_and_double() {
        let rate = |r: Option<f32>| prepare("a".into(), "x", None, r, None).unwrap().rate;
        assert_eq!(rate(Some(0.1)), RATE_MIN);
        assert_eq!(rate(Some(9.0)), RATE_MAX);
        assert_eq!(rate(Some(1.25)), 1.25);
        assert_eq!(rate(Some(f32::NAN)), 1.0);
        assert_eq!(rate(Some(f32::INFINITY)), 1.0);
    }

    #[test]
    fn voice_and_language_are_tidied() {
        let r = prepare("a".into(), "x", Some("  ".into()), None, Some(" de-DE ".into())).unwrap();
        assert_eq!(r.voice, None);
        assert_eq!(r.lang.as_deref(), Some("de-DE"));
        let r = prepare("a".into(), "x", Some("en-us-x-sfg#male_1-local".into()), None, Some("not a tag!".into())).unwrap();
        assert_eq!(r.voice.as_deref(), Some("en-us-x-sfg#male_1-local"));
        assert_eq!(r.lang, None);
        assert_eq!(prepare("a".into(), "x", Some("v".repeat(201)), None, None).unwrap_err().0, BAD_VOICE);
    }

    #[test]
    fn the_request_reaches_native_code_in_camel_case() {
        let r = prepare("id-1".into(), "x", Some("v".into()), Some(1.5), Some("en-US".into())).unwrap();
        assert_eq!(
            serde_json::to_value(&r).unwrap(),
            json!({ "id": "id-1", "text": "x", "voice": "v", "lang": "en-US", "rate": 1.5 })
        );
    }

    #[test]
    fn voices_are_sorted_by_language_then_name_and_named_once() {
        let list = tidy_voices(vec![
            voice("b", "Zoe", "en_US"),
            voice("a", "Anna", "de-DE"),
            voice("c", "", "en-US"),
            voice("", "No id", "en-US"),
            voice("d", "No language", " "),
            voice("a", "Anna", "de-DE"),
        ]);
        let ids: Vec<&str> = list.iter().map(|v| v.id.as_str()).collect();
        assert_eq!(ids, ["a", "c", "b"]);
        assert_eq!(list[1].name, "c", "a voice without a name is called by its id");
        assert_eq!(list[2].lang, "en-US");
    }

    #[test]
    fn a_list_from_native_code_is_read_with_missing_fields() {
        let v: TtsVoices = serde_json::from_value(json!({
            "available": true,
            "voices": [{ "id": "x", "name": "X", "lang": "en-US" }]
        }))
        .unwrap();
        assert!(v.available);
        assert!(!v.voices[0].local && !v.voices[0].default);
        let none: TtsVoices = serde_json::from_value(json!({ "available": false })).unwrap();
        assert!(none.voices.is_empty());
    }
}
