//! Going on with an answer that was cut (engine_inproc.rs).
//!
//! "Continue" on a phone used to send a new question ("Continue your answer
//! exactly where it stopped ...") and the model wrote a new answer. A small
//! model then began the essay again from its first sentence (round 9, N8 on
//! Android: Qwen3 1.7B). Nothing in the prompt can force it not to.
//!
//! What does force it is the prompt itself: the conversation up to the
//! question, the open turn of the assistant, and in that turn the text that
//! is already there. The model then has no new turn to begin. It writes the
//! next token of its own answer.
//!
//! The request says so with `"continue_final_message": true` and a last
//! message of the assistant (the name vLLM uses for the same thing). Without
//! the field nothing here does anything, and a request of the desktop never
//! carries it.
//!
//! This file is the part of it that needs no model: reading the request,
//! taking the text off the conversation, what to do with the blank a text
//! ends in, and how a text that is too long for the window is shortened. It
//! is built everywhere so its tests run on any machine; only the in-process
//! engine calls it.

// Only called where the in-process engine is built.
#![cfg_attr(not(any(mobile, all(target_os = "macos", feature = "inproc-engine"))), allow(dead_code))]

/// The text of the answer that is already there, ready for the prompt.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Prefill {
    /// Without the blanks it ended in, see [`Prefill::drop_lead`].
    pub(crate) text: String,
    /// The text ended in blanks or line breaks. A tokenizer writes a blank
    /// as the start of the NEXT word, so a prompt ending in one makes the
    /// model stumble. The blanks are left out of the prompt, the model
    /// writes its own, and those are dropped from the output: the caller
    /// still holds the text with its blanks and would get them twice.
    pub(crate) drop_lead: bool,
}

/// Does the request ask to go on with its last message?
pub(crate) fn wants_continue(body: &serde_json::Value) -> bool {
    body.get("continue_final_message").and_then(serde_json::Value::as_bool) == Some(true)
}

/// Take the answer to go on with off the end of the conversation.
///
/// Only when the request asked for it, the last message is one of the
/// assistant with text in it, and a message of the user stands before it.
/// In every other case the conversation comes back as it was and the engine
/// answers it the way it always did.
pub(crate) fn split_prefill(
    mut msgs: Vec<(String, String)>,
    wanted: bool,
) -> (Vec<(String, String)>, Option<Prefill>) {
    if !wanted || msgs.len() < 2 {
        return (msgs, None);
    }
    let last_is_answer = msgs.last().is_some_and(|(role, text)| {
        (role == "assistant" || role == "model") && !text.trim().is_empty()
    });
    let asked = msgs[..msgs.len() - 1].iter().any(|(role, _)| role == "user");
    if !last_is_answer || !asked {
        return (msgs, None);
    }
    let (_, text) = msgs.pop().unwrap_or_default();
    let kept = text.trim_end();
    let prefill = Prefill { text: kept.to_string(), drop_lead: kept.len() != text.len() };
    (msgs, Some(prefill))
}

/// Drops the blanks and line breaks the model opens with, once.
#[derive(Debug)]
pub(crate) struct LeadTrim {
    active: bool,
}

impl LeadTrim {
    pub(crate) fn new(active: bool) -> Self {
        Self { active }
    }

    /// Feed a piece of the answer, get what is to be shown of it.
    pub(crate) fn push(&mut self, piece: &str) -> String {
        if !self.active {
            return piece.to_string();
        }
        let rest = piece.trim_start();
        if !rest.is_empty() {
            self.active = false;
        }
        rest.to_string()
    }
}

/// The shortest text the engine still goes on from. Below it the request is
/// answered with the sentence about the window instead.
pub(crate) const PREFILL_MIN_CHARS: usize = 200;

/// The end of `text`, about three quarters of it, cut at a blank where one
/// is near. `None` when the text is too short to shorten.
///
/// An answer that filled the window cannot be handed back whole with room
/// to go on. The model reads its question and the end of what it wrote, and
/// that is enough to write the next sentence. The caller keeps the whole
/// text, only the prompt is shorter.
pub(crate) fn shorter_tail(text: &str) -> Option<&str> {
    let chars = text.chars().count();
    if chars <= PREFILL_MIN_CHARS {
        return None;
    }
    let keep = (chars * 3 / 4).max(PREFILL_MIN_CHARS);
    let cut = text.char_indices().nth(chars - keep).map_or(0, |(at, _)| at);
    let tail = &text[cut..];
    // Start at a word, when the next blank is close.
    let start = tail
        .char_indices()
        .take(40)
        .find(|(_, c)| c.is_whitespace())
        .map_or(0, |(at, c)| at + c.len_utf8());
    Some(tail[start..].trim_start())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn msgs(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(r, c)| (r.to_string(), c.to_string())).collect()
    }

    #[test]
    fn only_the_field_set_to_true_asks_for_it() {
        assert!(wants_continue(&serde_json::json!({"continue_final_message": true})));
        assert!(!wants_continue(&serde_json::json!({"continue_final_message": false})));
        assert!(!wants_continue(&serde_json::json!({"continue_final_message": "true"})));
        assert!(!wants_continue(&serde_json::json!({"messages": []})));
    }

    #[test]
    fn the_cut_answer_leaves_the_conversation_and_becomes_the_text_to_go_on_from() {
        let all = msgs(&[("system", "Be brief."), ("user", "Write about lighthouses."), ("assistant", "Lighthouses guide ships navigating the")]);
        let (rest, prefill) = split_prefill(all, true);
        assert_eq!(rest, msgs(&[("system", "Be brief."), ("user", "Write about lighthouses.")]));
        assert_eq!(prefill, Some(Prefill { text: "Lighthouses guide ships navigating the".into(), drop_lead: false }));
    }

    #[test]
    fn a_request_that_did_not_ask_is_left_alone() {
        let all = msgs(&[("user", "Hi"), ("assistant", "Hello")]);
        let (rest, prefill) = split_prefill(all.clone(), false);
        assert_eq!(rest, all);
        assert_eq!(prefill, None);
    }

    #[test]
    fn without_a_cut_answer_at_the_end_the_request_is_answered_as_always() {
        for all in [
            msgs(&[("user", "Hi")]),
            msgs(&[("user", "Hi"), ("assistant", "Hello"), ("user", "And?")]),
            msgs(&[("user", "Hi"), ("assistant", "  \n")]),
            msgs(&[("system", "Be brief."), ("assistant", "Hello")]),
            msgs(&[("assistant", "Hello")]),
            msgs(&[]),
        ] {
            let (rest, prefill) = split_prefill(all.clone(), true);
            assert_eq!(rest, all);
            assert_eq!(prefill, None, "{all:?}");
        }
    }

    #[test]
    fn blanks_at_the_end_stay_out_of_the_prompt_and_the_models_own_are_dropped() {
        let (_, prefill) = split_prefill(msgs(&[("user", "List three."), ("assistant", "1. One\n2. Two\n\n")]), true);
        let prefill = prefill.unwrap();
        assert_eq!(prefill.text, "1. One\n2. Two");
        assert!(prefill.drop_lead);

        let mut lead = LeadTrim::new(prefill.drop_lead);
        let shown: String = ["\n", "\n", "3", ".", " Three", "\n\n", "Done"].iter().map(|p| lead.push(p)).collect();
        // What the caller holds plus what comes out is the answer, once.
        assert_eq!(format!("1. One\n2. Two\n\n{shown}"), "1. One\n2. Two\n\n3. Three\n\nDone");
    }

    #[test]
    fn a_text_that_ends_in_a_word_keeps_every_character_of_what_follows() {
        let (_, prefill) = split_prefill(msgs(&[("user", "Go"), ("assistant", "navigating the")]), true);
        let prefill = prefill.unwrap();
        assert!(!prefill.drop_lead);
        let mut lead = LeadTrim::new(prefill.drop_lead);
        assert_eq!(lead.push(" Lighthouses"), " Lighthouses");
        // And in the middle of a word nothing is put between the halves.
        let mut lead = LeadTrim::new(false);
        assert_eq!(format!("Light{}", lead.push("houses")), "Lighthouses");
    }

    #[test]
    fn a_long_text_is_shortened_from_the_front_at_a_word_and_a_short_one_is_not() {
        let text = "word ".repeat(400);
        let text = text.trim_end();
        let tail = shorter_tail(text).unwrap();
        assert!(text.ends_with(tail));
        assert!(tail.starts_with("word"));
        let (all, kept) = (text.chars().count(), tail.chars().count());
        assert!(kept < all && kept >= all * 7 / 10, "{kept} of {all}");
        // Again and again it gets shorter, and it ends.
        let mut now = text;
        let mut rounds = 0;
        while let Some(next) = shorter_tail(now) {
            assert!(next.len() < now.len());
            now = next;
            rounds += 1;
        }
        assert!(rounds > 3 && now.chars().count() <= PREFILL_MIN_CHARS + 40, "{rounds} rounds, {} left", now.chars().count());
        assert_eq!(shorter_tail("Short answer."), None);
    }

    #[test]
    fn a_text_without_blanks_or_with_wide_characters_is_cut_at_a_character() {
        let text = "\u{706f}\u{5854}".repeat(300);
        let tail = shorter_tail(&text).unwrap();
        assert!(text.ends_with(tail));
        assert_eq!(tail.chars().count(), 450);
    }
}
