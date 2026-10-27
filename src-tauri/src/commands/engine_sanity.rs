// ── Does the engine that just came up produce text at all? (bug a) ───────────
//
// `/health` answers 200 as soon as llama-server has loaded the weights and
// opened its port. It says nothing about whether the numbers coming out of the
// graphics card are numbers. Three reporters have now described the difference:
//
//   * GitHub 128 (2026-09-09): endless question marks.
//   * Discord (2026-09-09): the same runaway stream.
//   * Discord (2026-08-17): character salad.
//
// The only one who named his hardware had a 2 GB card and a 3B model. On the
// 12 GB RTX 3060 here the same upstream Vulkan build answers coherent English
// on the card, on the processor, and with four layers offloaded, so nothing on
// this side of the house can reproduce it. What CAN be done without the card
// is to stop shipping the failure to the user: ask the engine one fixed
// question the moment it reports healthy, look at the answer, and if it is not
// text, take the graphics card out of the picture and start again.
//
// That is the house rule (self-healing before an error message) applied to a
// failure mode that today produces no error at all: a healthy port, a healthy
// process, and a chat full of question marks.
//
// This module is deliberately split in two halves. `judge` is pure and has no
// idea an engine exists, so the reporters' own samples can be run through it
// in a unit test. `probe_engine` is the one place that speaks HTTP, and it
// only ever speaks to 127.0.0.1: a cloud or LAN backend is somebody else's
// server, we did not start it, and restarting it is not ours to decide.

use std::time::{Duration, Instant};

/// How long the probe may take before it is abandoned. A healthy machine
/// answers 24 tokens in a fraction of this; the budget is only here so a
/// wedged engine cannot hold the start open.
///
/// A timeout is NOT a garbled verdict. Slow is not broken, and a machine that
/// needs six seconds for 24 tokens (a big model on a cold processor) must not
/// be dragged off its graphics card for it.
pub(crate) const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

/// How many tokens the probe asks for. Enough text for the shares below to
/// mean something, few enough that the whole probe is shorter than the model
/// load that just happened.
pub(crate) const PROBE_TOKENS: u32 = 24;

/// The question. Fixed, English, and dull on purpose: the answer has to be
/// ordinary prose on every model in the catalogue, because the classifier
/// below judges the SHAPE of the answer and not its content. Temperature 0
/// and a fixed seed make the same engine answer the same way twice, so a
/// verdict in a support log can be argued with.
///
/// LONG on purpose, and this is the part that is easy to get wrong. llama.cpp
/// runs single-token generation through one kernel (`mul_mat_vec`) and batched
/// prompt processing through another (`mul_mm`), and the Vulkan defects that
/// produce this failure live in the batched one. llama.cpp issue 18969 is the
/// clearest case: the quantised matrix-matrix kernel accumulates in f16 where
/// the device advertises it, the dot products overflow f16's 65504, the logits
/// go NaN, and softmax collapses onto the lowest token ids in the vocabulary,
/// which in a byte-level BPE vocabulary are the printable ASCII bytes. That is
/// where the question marks come from. Below a batch of about eight tokens the
/// other kernel is taken and nothing is wrong, so a three-word probe would ask
/// the one path that works and come back clean off a broken card.
///
///   https://github.com/ggml-org/llama.cpp/issues/18969
///   https://github.com/ggml-org/llama.cpp/issues/21888
///
/// Prompt processing is the cheap half of inference, so a hundred tokens in
/// costs far less than the twenty-four tokens out.
pub(crate) const PROBE_PROMPT: &str = "The sea was calm in the morning and the harbour was quiet. Fishing boats left before sunrise and came back in the afternoon with the day's catch. Gulls followed them in, calling over the water, and the market on the quay opened as soon as the first crates came ashore. By evening the wind had turned and the boats were tied up again. Summarise that passage in one short English sentence.";

/// What the user is told when turning flash attention off was enough and the
/// card could be kept.
pub(crate) const HEALED_WITHOUT_FLASH_ATTENTION_NOTE: &str = "The GPU produced unreadable output, the engine was restarted with Flash Attention switched off and reads correctly now. Please send the log file from Settings > Troubleshoot.";

/// What the user is told when the card was taken out and the engine came back
/// readable. Same tone as the other fallback notes in the start path: what
/// happened, what was done about it, and the one thing that would let us fix
/// the cause.
pub(crate) const HEALED_ON_CPU_NOTE: &str = "The GPU produced unreadable output, the engine was restarted on the CPU. Please send the log file from Settings > Troubleshoot.";

/// What the user is told when the processor produced the same soup. Then it is
/// not the graphics card, there is nothing left for us to take away, and
/// saying so beats a third restart that would change nothing.
pub(crate) const GARBLED_ON_CPU_NOTE: &str = "The engine produced unreadable output on the CPU as well, so the graphics card is not the cause. Please send the log file from Settings > Troubleshoot.";

/// What the user is told when the restart itself never came up and the first
/// engine had to be put back.
///
/// This one is NOT a verdict about the hardware. The rung that was aimed for
/// was never measured, because nothing answered on the port to measure: the
/// probe is only ever run on an engine that came up. Saying "on the CPU as
/// well" here would claim a measurement that never happened, and on the flash
/// attention rung the processor was not even the destination.
pub(crate) const RESTART_DID_NOT_COME_BACK_NOTE: &str = "The engine could not be restarted with different settings, so the first engine is running again. Please send the log file from Settings > Troubleshoot.";

/// llama-server's own sentence when no GPU backend came up with a device
/// (common/arg.cpp at the pinned 049326a, printed for `-ngl` with a number,
/// `auto` or `all` alike). It is the only line that says "no card at all":
/// `ggml_vulkan: No devices found.` alone is not, because a build with a
/// second backend can serve on that one.
const NO_USABLE_GPU_LINE: &str = "no usable GPU found, --gpu-layers option will be ignored";

/// What a Linux user is told when the engine started without any card.
///
/// fanezeu (Linux server, RX 7900 XTX, 23.10.2026). The Linux LU Engine is the
/// Vulkan build, and the loader alone (libvulkan1, which the deb pulls in) is
/// not a driver: a server or minimal install often has no Vulkan driver for
/// the card, so the engine comes up, serves on the processor and says it in
/// one line of its log that nobody reads. The package names are the ones that
/// carry RADV and ANV on each family; NVIDIA brings its own with the driver.
pub(crate) const NO_GPU_DEVICE_LINUX_NOTE: &str = "Running on the CPU: the LU Engine found no graphics card it can use. On Linux it runs on Vulkan, so install the Vulkan driver for your card (AMD and Intel: mesa-vulkan-drivers on Debian, Ubuntu and Fedora, vulkan-radeon or vulkan-intel on Arch; NVIDIA: the proprietary driver), check that your user is in the render and video groups, then restart LU.";

/// The same fact on Windows, where the driver is the one thing to update.
pub(crate) const NO_GPU_DEVICE_NOTE: &str = "Running on the CPU: the LU Engine found no graphics card it can use. Update your graphics driver, then restart LU.";

/// The note for an engine that asked for the card and found none, or `None`.
///
/// `layers` is the `-ngl` the process carries: a typed 0 asked for the
/// processor, and then the same warning is no news. The Mac runs Metal and is
/// not asked.
pub(crate) fn no_gpu_device_note(startup: &str, layers: Option<u32>, os: &str) -> Option<&'static str> {
    if os == "macos" || layers == Some(0) || !startup.contains(NO_USABLE_GPU_LINE) {
        return None;
    }
    Some(if os == "linux" { NO_GPU_DEVICE_LINUX_NOTE } else { NO_GPU_DEVICE_NOTE })
}

// ── The classifier ──────────────────────────────────────────────────────────
//
// Every threshold below is set so that it cannot fire on healthy output, and
// is allowed to miss broken output rather than the other way round. A false
// "this is garbage" costs a user his graphics card for the whole session; a
// missed one leaves him exactly where he is today. The negative controls in
// the tests are the ones that decide the numbers: an English sentence, a
// German sentence with umlauts, and a punctuation-heavy code snippet.

/// Below this many non-whitespace characters there is nothing to take a share
/// of. A four-word answer that happens to contain a question mark would sit at
/// 5 percent of a 20 character sample and at 33 percent of a 3 character one.
const MIN_CHARS: usize = 16;

/// Share of question marks that means the stream is the reported failure and
/// not a sentence that ends in a question. Prose tops out near one mark per
/// sentence; the reported failure is at or near 1.0.
const QUESTION_MARK_SHARE: f32 = 0.30;

/// How many U+FFFD it takes. That is the character a decoder writes where the
/// bytes were not valid UTF-8, and llama-server's JSON serialiser puts it
/// there when a byte-fallback token carries no valid sequence. Correct output
/// in any language contains none of them, so three is already generous: it
/// only exists so an answer that happens to be ABOUT the character is not
/// mistaken for one made of it.
const REPLACEMENT_COUNT: usize = 3;

/// How many times one character may repeat back to back. The reported failure
/// runs to the context limit; legitimate text and code run out long before
/// this. Twenty-four clears every rule and separator a code answer draws
/// ("====", "----", "####", "///", "***") with room to spare, and catches the
/// pattern that the share rules miss: a few correct words and then the same
/// character forever, which is llama.cpp issue 10434 exactly.
///
///   https://github.com/ggml-org/llama.cpp/issues/10434
const CHAR_RUN_LIMIT: usize = 24;

/// Share of letters below which the answer is symbols. A dense code snippet
/// still runs above a third letters, so this sits far under anything a working
/// engine produces and only catches output with essentially no words in it.
const LETTER_SHARE_FLOOR: f32 = 0.15;

/// How many distinct non-whitespace characters a real answer has at least.
/// "GGGGGGGGGG" has one, "?!?!?!?!?!" has two. Any sentence in any language
/// has more than three.
const DISTINCT_FLOOR: usize = 4;

/// How often the same word may repeat back to back before it is a stuck
/// sampler rather than emphasis. English tolerates "had had"; it does not
/// tolerate eight in a row.
const WORD_RUN_LIMIT: usize = 8;

/// How many letters an answer needs before its writing systems are counted.
/// Below this a single foreign character is a large share of nothing.
const MIN_LETTERS_FOR_SCRIPTS: usize = 24;

/// The band in which a minority writing system means the tokens are soup.
///
/// This rule exists because of what GitHub 128 actually pasted, which none of
/// the rules above would have caught:
///
///   As íhythm Arm indic  ');?>".dateTimePicker用户的/devices netteCLUerequisite
///   seller son,[code侥幸三是 constksiewaterpcbQ AGAIN定时/-boseuada乎嚅 'field_EOF
///
/// That is Latin with Han scattered through it, plenty of letters, plenty of
/// distinct characters, no runs and one question mark. It reads as prose to
/// every share above. The endless question marks the reporter describes come
/// AFTER this, so a twenty-four token probe sees this part and has to judge
/// it on its own.
///
/// The band is what keeps the rule honest at both ends. Under the floor sits
/// the one Greek letter in a maths answer and the one accented name. Over the
/// ceiling sits a model that simply answered in its own language, which is a
/// model ignoring an instruction and not a broken card, and must not cost
/// anybody his graphics card.
const FOREIGN_SCRIPT_BAND: std::ops::RangeInclusive<f32> = 0.05..=0.50;

/// What the probe made of the answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Sanity {
    /// Reads like language or like code. Nothing to do.
    Readable,
    /// Broken past argument, with the rule that caught it.
    Garbled(Garble),
    /// Too short to take a share of, so no verdict. Treated exactly like
    /// readable everywhere a decision is made: a probe that could not judge
    /// must never be the reason a graphics card is switched off.
    Unjudgeable,
}

/// Which rule fired. Carried into the log so a support file says WHY the app
/// decided the answer was not text, and not merely that it did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Garble {
    QuestionMarks,
    Replacement,
    OneCharacter,
    NoLetters,
    OneWord,
    MixedScripts,
}

impl Sanity {
    /// One word for the log line.
    pub(crate) fn label(self) -> &'static str {
        match self {
            Sanity::Readable => "readable",
            Sanity::Unjudgeable => "too short to judge",
            Sanity::Garbled(g) => g.label(),
        }
    }

    pub(crate) fn is_garbled(self) -> bool {
        matches!(self, Sanity::Garbled(_))
    }
}

impl Garble {
    pub(crate) fn label(self) -> &'static str {
        match self {
            Garble::QuestionMarks => "garbled: question marks",
            Garble::Replacement => "garbled: undecodable bytes",
            Garble::OneCharacter => "garbled: one character repeated",
            Garble::NoLetters => "garbled: no letters",
            Garble::OneWord => "garbled: one word repeated",
            Garble::MixedScripts => "garbled: several alphabets at once",
        }
    }
}

/// Judge one completion. Pure: no engine, no clock, no network.
///
/// What it does NOT catch, said plainly because a probe that oversells itself
/// is worse than none: a salad made of ordinary letters ("hte sae si dna") has
/// letters, spaces and many distinct characters, and passes every rule here.
/// Catching that needs a language model, which is the thing under test.
pub(crate) fn judge(text: &str) -> Sanity {
    let dense: Vec<char> = text.chars().filter(|c| !c.is_whitespace()).collect();
    if dense.len() < MIN_CHARS {
        return Sanity::Unjudgeable;
    }
    let total = dense.len() as f32;

    let share = |hits: usize| hits as f32 / total;

    if dense.iter().filter(|c| **c == '\u{fffd}').count() >= REPLACEMENT_COUNT {
        return Sanity::Garbled(Garble::Replacement);
    }
    if share(dense.iter().filter(|c| **c == '?').count()) >= QUESTION_MARK_SHARE {
        return Sanity::Garbled(Garble::QuestionMarks);
    }
    let distinct: std::collections::BTreeSet<char> = dense.iter().copied().collect();
    if distinct.len() < DISTINCT_FLOOR {
        return Sanity::Garbled(Garble::OneCharacter);
    }
    if longest_char_run(&dense) >= CHAR_RUN_LIMIT {
        return Sanity::Garbled(Garble::OneCharacter);
    }
    if share(dense.iter().filter(|c| c.is_alphabetic()).count()) < LETTER_SHARE_FLOOR {
        return Sanity::Garbled(Garble::NoLetters);
    }
    if longest_word_run(text) >= WORD_RUN_LIMIT {
        return Sanity::Garbled(Garble::OneWord);
    }
    if scripts_are_soup(&dense) {
        return Sanity::Garbled(Garble::MixedScripts);
    }
    Sanity::Readable
}

/// The coarse writing systems this rule tells apart. Coarse on purpose: the
/// question is "is one answer written in several alphabets at once", not which
/// ones, and a full Unicode script table would be a dependency and a
/// maintenance job for a yes or no.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
enum Script {
    Latin,
    Greek,
    Cyrillic,
    Hebrew,
    Arabic,
    Devanagari,
    Thai,
    Han,
    Kana,
    Hangul,
    Other,
}

fn script_of(c: char) -> Option<Script> {
    if !c.is_alphabetic() {
        return None;
    }
    let u = c as u32;
    Some(match u {
        0x0041..=0x005A | 0x0061..=0x007A => Script::Latin,
        0x00C0..=0x024F | 0x1E00..=0x1EFF | 0x2C60..=0x2C7F | 0xA720..=0xA7FF => Script::Latin,
        0x0370..=0x03FF | 0x1F00..=0x1FFF => Script::Greek,
        0x0400..=0x052F => Script::Cyrillic,
        0x0590..=0x05FF => Script::Hebrew,
        0x0600..=0x06FF | 0x0750..=0x077F | 0xFB50..=0xFDFF => Script::Arabic,
        0x0900..=0x097F => Script::Devanagari,
        0x0E00..=0x0E7F => Script::Thai,
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0x20000..=0x2A6DF => Script::Han,
        0x3040..=0x30FF | 0x31F0..=0x31FF => Script::Kana,
        0x1100..=0x11FF | 0x3130..=0x318F | 0xAC00..=0xD7AF => Script::Hangul,
        _ => Script::Other,
    })
}

/// True when one answer is written in several alphabets at once.
///
/// Two shapes count. Three or more writing systems in a single short answer is
/// soup outright. Exactly one foreign system alongside Latin is judged by how
/// much of it there is, against the band above: a sprinkle is a quotation, a
/// half is a translation, and the space between the two is what a broken
/// decoder produces.
///
/// A system that appears exactly once is ignored throughout. One stray
/// character is a name, a symbol or a unit, and never evidence of anything.
fn scripts_are_soup(dense: &[char]) -> bool {
    let mut counts: std::collections::BTreeMap<Script, usize> = std::collections::BTreeMap::new();
    for c in dense {
        if let Some(s) = script_of(*c) {
            *counts.entry(s).or_default() += 1;
        }
    }
    let letters: usize = counts.values().sum();
    if letters < MIN_LETTERS_FOR_SCRIPTS {
        return false;
    }
    let foreign: Vec<usize> = counts
        .iter()
        .filter(|(s, n)| **s != Script::Latin && **n >= 2)
        .map(|(_, n)| *n)
        .collect();
    match foreign.len() {
        0 => false,
        1 => {
            // Latin has to be the majority for this half of the rule to mean
            // anything. Without Latin present at all there is no mixture, just
            // an answer in another language.
            let latin = counts.get(&Script::Latin).copied().unwrap_or(0);
            latin >= 2 && FOREIGN_SCRIPT_BAND.contains(&(foreign[0] as f32 / letters as f32))
        }
        _ => true,
    }
}

/// The longest run of one identical character, whitespace already removed.
///
/// Measured on the DENSE text on purpose: the reported streams arrive both as
/// "????????" and as "? ? ? ? ? ?", and a run counter that stops at every
/// space would see the second one as sixty runs of length one.
fn longest_char_run(dense: &[char]) -> usize {
    let mut best = 0usize;
    let mut run = 0usize;
    let mut last: Option<char> = None;
    for c in dense {
        run = if last == Some(*c) { run + 1 } else { 1 };
        last = Some(*c);
        best = best.max(run);
    }
    best
}

/// How many times the same whitespace-separated word repeats back to back, at
/// its longest run.
fn longest_word_run(text: &str) -> usize {
    let mut best = 0usize;
    let mut run = 0usize;
    let mut last: Option<&str> = None;
    for word in text.split_whitespace() {
        run = if last == Some(word) { run + 1 } else { 1 };
        last = Some(word);
        best = best.max(run);
    }
    best
}

/// The first `max` characters of an answer, newlines flattened, for the log.
/// The answer to OUR prompt, never a user's conversation, so there is nothing
/// in here a support file may not carry.
pub(crate) fn sample_for_log(text: &str, max: usize) -> String {
    let flat: String = text
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(max)
        .collect();
    flat.trim().to_string()
}

// ── What to do about a verdict ──────────────────────────────────────────────

/// The decision the start path takes after the probe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AfterProbe {
    /// Leave the engine exactly as it is.
    Serve,
    /// This card runs the scalar attention kernel and that kernel is the one
    /// upstream report actually points at: try again with the flag off before
    /// giving the card up altogether.
    RestartWithoutFlashAttention,
    /// The card is the suspect and can be taken away: restart on the processor.
    RestartOnCpu,
    /// Already on the processor and still unreadable. Say so, stop retrying.
    GiveUp,
}

/// What the engine that just answered was actually told to do, and what it
/// said about the machine it is on.
///
/// Read back OUT of the argv that was spawned and out of the engine's own
/// startup lines, never worked out a second time, so a decision here can never
/// disagree with what the engine did (same rule as the died-on-start retry).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct EngineFacts {
    /// `-ngl` as it stood in the argv.
    pub gpu_layers: Option<u32>,
    /// Whether flash attention is on. "auto" counts as on: on a device that
    /// supports the scalar kernel, which is every device in the class below,
    /// the binary's own default turns it on.
    pub flash_attention_on: bool,
    /// True when llama-server printed a device line and EVERY device on it
    /// said `matrix cores: none`, and on the Vulkan build also when it printed
    /// no device line at all (`may_lack_matrix_cores`).
    pub every_device_without_matrix_cores: bool,
}

/// Decide what to do about a verdict.
///
/// The ladder has three rungs and takes the cheapest one that the evidence
/// supports, so a user keeps as much of his machine as he can:
///
///  1. Flash attention off, but ONLY on a card that reports no matrix cores.
///     That is the one lever with real citations behind it. Two reporters
///     bisected garbled output on exactly that class of card to the Vulkan
///     scalar flash attention rewrite (PR 19625, commit aa6f918c, 24.02.2026),
///     and neither report was ever fixed, so the pinned sidecar carries it.
///     A card WITH matrix cores takes a different kernel and this rung would
///     be a guess, so it is skipped there.
///
///     https://github.com/ggml-org/llama.cpp/issues/20465
///     https://github.com/ggml-org/llama.cpp/issues/20029
///     https://github.com/ggml-org/llama.cpp/issues/19128
///     https://github.com/ggml-org/llama.cpp/issues/19327
///
///  2. The processor. Slower, and correct on every report we have: in each of
///     them `-ngl 0` reads fine while the card does not.
///
///  3. Nothing. Unreadable on the processor is not a graphics problem, and a
///     fourth restart would only cost time.
pub(crate) fn decide(verdict: Sanity, facts: &EngineFacts) -> AfterProbe {
    if !verdict.is_garbled() {
        return AfterProbe::Serve;
    }
    if facts.gpu_layers.is_none_or(|n| n == 0) {
        return AfterProbe::GiveUp;
    }
    if facts.flash_attention_on && facts.every_device_without_matrix_cores {
        return AfterProbe::RestartWithoutFlashAttention;
    }
    AfterProbe::RestartOnCpu
}

/// What llama-server's own startup lines say about matrix cores.
///
/// The Vulkan backend prints one line per device, in this shape:
///
///   ggml_vulkan: 0 = NVIDIA GeForce GTX 1050 Ti (NVIDIA) | uma: 0 | fp16: 0
///   | bf16: 0 | warp size: 32 | shared memory: 49152 | int dot: 1
///   | matrix cores: none
///
/// `Some(true)` means every device it named said `none`, which is the class
/// the rung above is for (Maxwell, Pascal, old AMD, MoltenVK). `Some(false)`
/// means at least one device has them. `None` means nothing said anything,
/// which is every non-Vulkan build, Metal and CPU included, and is treated as
/// "we do not know" and never acted on.
///
/// Measured, not guessed: nothing here maps a marketing name to a chip
/// generation. The device says what it has and this reads it back.
///
///   https://github.com/ggml-org/llama.cpp/issues/15272
pub(crate) fn device_without_matrix_cores(startup: &str) -> Option<bool> {
    let mut seen = false;
    let mut all_none = true;
    for line in startup.lines() {
        let Some((_, rest)) = line.split_once("matrix cores:") else { continue };
        seen = true;
        let value = rest.split('|').next().unwrap_or("").trim();
        if !value.eq_ignore_ascii_case("none") {
            all_none = false;
        }
    }
    seen.then_some(all_none)
}

/// Whether the flash attention rung may be tried on this engine.
///
/// GH #156. The pinned llama-server (049326a) does not print the device line
/// above: there it is a debug line (`GGML_LOG_DEBUG` in ggml-vulkan.cpp) and
/// llama-server runs at verbosity 3. Measured on the shipped Windows sidecar
/// with an RTX 3060, 15.10.2026: no `matrix cores:` line at the default
/// verbosity, nor at `-lv 4`, `-lv 5` or `-v` (so raising the verbosity is
/// no way to get it back either), while the same run offloads every layer to
/// Vulkan0. So on the
/// Vulkan build `device_without_matrix_cores` always answered `None`, the rung
/// for cards without matrix cores (Pascal, GCN, RDNA 1 and 2 on RADV) could
/// never be taken, and a garbled card went straight to the processor.
///
/// Where the Vulkan build says nothing, the rung is tried: it costs one
/// restart and keeps the card when it helps, and when it does not, the
/// processor rung follows as before. A line that IS printed (an older or a
/// newer engine) is still believed. The Metal build is not Vulkan, the reports
/// behind the rung are all Vulkan, so there an unknown stays unknown.
pub(crate) fn may_lack_matrix_cores(startup: &str, vulkan_build: bool) -> bool {
    device_without_matrix_cores(startup).unwrap_or(vulkan_build)
}

/// The log word for what the startup lines said about matrix cores.
pub(crate) fn matrix_cores_label(startup: &str) -> &'static str {
    match device_without_matrix_cores(startup) {
        Some(true) => "none",
        Some(false) => "present",
        None => "not reported",
    }
}

// ── The one place that speaks HTTP ──────────────────────────────────────────

/// Where the probe sends its question. Loopback and a port, built here and
/// nowhere else, so "the probe never touches a remote backend" is a property
/// of the code and not of a caller remembering to check.
pub(crate) fn probe_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/v1/chat/completions")
}

/// One probe run.
pub(crate) struct ProbeOutcome {
    pub verdict: Sanity,
    /// The answer, trimmed for the log line.
    pub sample: String,
    pub took: Duration,
    /// D3: true when `verdict` is `Unjudgeable` AND the engine reported a
    /// non-empty `reasoning_content` alongside the (empty or near-empty)
    /// visible `content`. A thinking model (GLM-5.3, ...) spends the probe's
    /// small `PROBE_TOKENS` budget on the `<think>` block, so the VISIBLE
    /// answer this probe judges is genuinely short or empty while the model
    /// is not broken at all, the chat answers fine once the user's own,
    /// much larger, budget lets the thinking finish. `judge()` alone cannot
    /// tell this apart from any other short answer, because it only ever
    /// sees `content`; this is decided one level up, in `probe_engine`,
    /// which still has the whole response body.
    pub still_thinking: bool,
}

/// Ask the engine on `port` the fixed question and judge the answer.
///
/// `None` means the probe could not be run at all (no answer, a refused
/// connection, a body that was not the expected shape). That is not a verdict
/// and must not move the engine: an engine we cannot ask is an engine we know
/// nothing about, and today's behaviour is to serve it.
pub(crate) fn probe_engine(port: u16, timeout: Duration) -> Option<ProbeOutcome> {
    let started = Instant::now();
    let body = serde_json::json!({
        // llama-server ignores the model field (one process, one GGUF), but
        // the OpenAI schema requires it.
        "model": "lu",
        "messages": [{ "role": "user", "content": PROBE_PROMPT }],
        "temperature": 0,
        "seed": 0,
        "max_tokens": PROBE_TOKENS,
        "stream": false,
    });
    let client = reqwest::blocking::Client::builder().timeout(timeout).build().ok()?;
    // The probe asks an engine this app just started: on the desktop with the
    // engine's key (engine_key.rs), on a phone with the token of its
    // in-process engine (engine_token.rs).
    #[cfg(desktop)]
    let request = client.post(probe_url(port)).header(reqwest::header::AUTHORIZATION, super::engine_key::bearer());
    #[cfg(mobile)]
    let request = super::engine_token::attach_blocking(client.post(probe_url(port)), port);
    let response = request
        .json(&body)
        .send()
        .ok()
        .filter(|r| r.status().is_success())?
        .json::<serde_json::Value>()
        .ok()?;
    let text = answer_text(&response)?;
    let verdict = judge(&text);
    Some(ProbeOutcome {
        verdict,
        sample: sample_for_log(&text, 120),
        took: started.elapsed(),
        still_thinking: verdict == Sanity::Unjudgeable && reasoning_text(&response).is_some(),
    })
}

/// Pull the assistant's words out of an OpenAI-shaped completion body.
pub(crate) fn answer_text(body: &serde_json::Value) -> Option<String> {
    body.get("choices")?
        .get(0)?
        .get("message")?
        .get("content")?
        .as_str()
        .map(str::to_string)
}

/// Pull the assistant's REASONING out of an OpenAI-shaped completion body,
/// when the engine reports one separately from `content` (llama-server with
/// a chat template that supports native reasoning parsing, e.g. GLM-5.3).
/// `reasoning` is the older field name some backends still use;
/// `reasoning_content` is tried first. `None` when neither is present or
/// both are empty, the ordinary case for a model that does not think.
pub(crate) fn reasoning_text(body: &serde_json::Value) -> Option<String> {
    let message = body.get("choices")?.get(0)?.get("message")?;
    let raw = message
        .get("reasoning_content")
        .or_else(|| message.get("reasoning"))?
        .as_str()?;
    (!raw.trim().is_empty()).then(|| raw.to_string())
}

/// D3: the word for the log line, refined for the one case `Sanity::label()`
/// alone cannot tell apart, see [`ProbeOutcome::still_thinking`]. Every
/// other verdict reads exactly as it did before.
pub(crate) fn verdict_label(verdict: Sanity, still_thinking: bool) -> &'static str {
    if still_thinking && verdict == Sanity::Unjudgeable {
        "too short to judge (still inside a <think> block)"
    } else {
        verdict.label()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── An engine without any card (fanezeu, 23.10.2026) ───────────────────

    /// The three lines common/arg.cpp prints at the pinned commit, as they
    /// stand in the engine's stderr.
    const NO_GPU_STDERR: &str = "load_backend: loaded CPU backend from /usr/lib/lu/libggml-cpu-haswell.so\nload_backend: loaded Vulkan backend from /usr/lib/lu/libggml-vulkan.so\nggml_vulkan: No devices found.\nwarning: no usable GPU found, --gpu-layers option will be ignored\nwarning: one possible reason is that llama.cpp was compiled without GPU support\nwarning: consult docs/build.md for compilation instructions\n";

    #[test]
    fn an_engine_that_found_no_card_says_which_driver_is_missing() {
        let linux = no_gpu_device_note(NO_GPU_STDERR, Some(998), "linux").expect("note on linux");
        assert!(linux.contains("mesa-vulkan-drivers"), "{linux}");
        assert!(linux.contains("render and video groups"), "{linux}");
        assert_eq!(no_gpu_device_note(NO_GPU_STDERR, None, "windows"), Some(NO_GPU_DEVICE_NOTE));
        assert!(!NO_GPU_DEVICE_NOTE.contains("mesa"), "no Linux package names on Windows");
    }

    #[test]
    fn a_card_that_came_up_or_a_typed_zero_gets_no_note() {
        // A healthy Vulkan start on the reported card: no warning, no note.
        let healthy = "ggml_vulkan: Found 1 Vulkan devices:\nggml_vulkan: 0 = AMD Radeon RX 7900 XTX (RADV NAVI31) (radv) | uma: 0 | fp16: 1\nload_tensors: offloaded 49/49 layers to GPU\n";
        assert_eq!(no_gpu_device_note(healthy, Some(998), "linux"), None);
        // Vulkan without devices next to a backend that has one is not "no card".
        let cuda_too = "ggml_vulkan: No devices found.\nggml_cuda_init: found 1 CUDA devices:\n";
        assert_eq!(no_gpu_device_note(cuda_too, Some(999), "windows"), None);
        // GPU Layers 0 asked for the processor, so the warning is no news.
        assert_eq!(no_gpu_device_note(NO_GPU_STDERR, Some(0), "linux"), None);
        // The Mac runs Metal.
        assert_eq!(no_gpu_device_note(NO_GPU_STDERR, Some(999), "macos"), None);
    }

    // ── The reporters' samples ──────────────────────────────────────────────

    #[test]
    fn the_runaway_question_mark_stream_is_garbled() {
        assert_eq!(
            judge("????????????????????????????????????????"),
            Sanity::Garbled(Garble::QuestionMarks)
        );
    }

    #[test]
    fn question_marks_mixed_into_a_few_words_are_still_garbled() {
        // Not a pure stream: what the second reporter pasted had the odd
        // fragment of a word left in it.
        assert_eq!(
            judge("The ?????? sea ???????? is ?????????? ????????"),
            Sanity::Garbled(Garble::QuestionMarks)
        );
    }

    #[test]
    fn undecodable_bytes_are_garbled() {
        assert_eq!(
            judge("The s\u{fffd}\u{fffd}a is \u{fffd}\u{fffd}\u{fffd} and \u{fffd}\u{fffd}"),
            Sanity::Garbled(Garble::Replacement)
        );
    }

    #[test]
    fn one_character_repeated_forever_is_garbled() {
        assert_eq!(judge("GGGGGGGGGGGGGGGGGGGGGGGGGGGG"), Sanity::Garbled(Garble::OneCharacter));
    }

    #[test]
    fn two_characters_alternating_are_garbled() {
        assert_eq!(judge("!?!?!?!?!?!?!?!?!?!?!?!?"), Sanity::Garbled(Garble::QuestionMarks));
    }

    #[test]
    fn a_few_correct_words_and_then_one_character_forever_is_garbled() {
        // llama.cpp issue 10434: the answer starts out fine and degenerates a
        // few tokens in. Every share rule above it is diluted by the healthy
        // opening, so without the run rule this reads as normal prose.
        assert_eq!(
            judge("The sea was calm in the morning GGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG"),
            Sanity::Garbled(Garble::OneCharacter)
        );
    }

    #[test]
    fn a_run_broken_up_by_spaces_is_still_a_run() {
        assert_eq!(
            judge("The sea ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ? ?"),
            Sanity::Garbled(Garble::QuestionMarks)
        );
        assert_eq!(
            judge("The sea was calm G G G G G G G G G G G G G G G G G G G G G G G G G G"),
            Sanity::Garbled(Garble::OneCharacter)
        );
    }

    #[test]
    fn the_verbatim_opening_from_github_128_is_garbled() {
        // Copied out of the issue, unchanged. The reporter's question marks
        // come after this; this is the part a 24 token probe would see, and
        // every share rule reads it as prose.
        let reported = "As íhythm Arm indic  ');?>\".dateTimePicker用户的/devices netteCLUerequisiteseller son,[code侥幸三是 constksiewaterpcbQ AGAIN定时/-boseuada乎嚅 'field_EOFnesota";
        assert_eq!(judge(reported), Sanity::Garbled(Garble::MixedScripts));
        assert_eq!(decide(judge(reported), &a_modern_card()), AfterProbe::RestartOnCpu);
    }

    #[test]
    fn three_alphabets_in_one_short_answer_are_garbled() {
        assert_eq!(
            judge("The sea was calm привет and the harbour ελληνικά was quiet at dawn"),
            Sanity::Garbled(Garble::MixedScripts)
        );
    }

    #[test]
    fn a_salad_of_symbols_has_no_letters() {
        assert_eq!(
            judge("#@$%^&*()_+=[]{}|\\/<>~`#@$%^&*()"),
            Sanity::Garbled(Garble::NoLetters)
        );
    }

    #[test]
    fn one_word_repeated_is_garbled() {
        assert_eq!(
            judge("ocean ocean ocean ocean ocean ocean ocean ocean ocean"),
            Sanity::Garbled(Garble::OneWord)
        );
    }

    // ── The negative controls, which set every threshold above ──────────────

    #[test]
    fn an_ordinary_english_answer_is_readable() {
        assert_eq!(
            judge("The sea stretches out to the horizon, grey and restless under a low sky."),
            Sanity::Readable
        );
    }

    #[test]
    fn the_answer_a_real_engine_gave_to_this_prompt_is_readable() {
        // Captured on 2026-09-11 from the shipped sidecar on this machine
        // (Qwen2.5-0.5B-Instruct-Q8_0, Metal, ctx 8192), once with all layers
        // on the card and once with `-ngl 0`. Both runs answered this, byte
        // for byte, in 0.126 s and 0.201 s.
        //
        // It is not a summary. It is the passage again, because a 0.5B model
        // is a 0.5B model, and that is exactly why the classifier judges the
        // SHAPE of an answer and never its content: the smallest model in the
        // catalogue must not be able to fail this probe by being small.
        assert_eq!(
            judge("The sea was calm in the morning, and the harbour was quiet. Fishing boats left before sunrise and came back in the"),
            Sanity::Readable
        );
    }

    #[test]
    fn a_german_sentence_with_umlauts_is_readable() {
        assert_eq!(
            judge("Das Meer ist heute grau und ruhig, und die Möwen ziehen über die Bucht."),
            Sanity::Readable
        );
    }

    #[test]
    fn a_code_snippet_is_readable() {
        assert_eq!(
            judge("for (let i = 0; i < 10; i++) { total += arr[i]; }"),
            Sanity::Readable
        );
    }

    #[test]
    fn code_full_of_ternaries_survives_the_question_mark_rule() {
        assert_eq!(
            judge("const a = x ? 1 : 2; const b = y ? 3 : 4; const c = z ? 5 : 6;"),
            Sanity::Readable
        );
    }

    #[test]
    fn a_code_answer_with_rules_and_separators_is_readable() {
        // The counter-check to the run rule. A code answer draws lines; this
        // is what the twenty-four is set above.
        assert_eq!(
            judge("// -------------------- helpers --------------------\nconst n = 0;"),
            Sanity::Readable
        );
        assert_eq!(
            judge("### Result\n\n====================\n\nThe function returns zero."),
            Sanity::Readable
        );
    }

    #[test]
    fn a_single_replacement_character_is_not_yet_a_broken_stream() {
        assert_eq!(
            judge("The replacement character \u{fffd} marks bytes a decoder could not read."),
            Sanity::Readable
        );
    }

    #[test]
    fn an_answer_written_entirely_in_another_language_is_readable() {
        // The counter-check at the top of the band. A model that ignores the
        // instruction and answers in its own language is a model ignoring an
        // instruction, and must not cost its owner his graphics card.
        assert_eq!(
            judge("早上的海很平静，港口也很安静。渔船在日出前出海，下午带着当天的渔获回来。"),
            Sanity::Readable
        );
        assert_eq!(
            judge("Море было спокойным утром, и гавань была тихой, а лодки вернулись днём."),
            Sanity::Readable
        );
    }

    #[test]
    fn one_foreign_word_quoted_in_an_english_answer_is_readable() {
        // The counter-check at the bottom of the band, and the reason a single
        // character of a writing system is ignored outright.
        assert_eq!(
            judge("The angle θ is measured from the horizon, and the sea stays calm below it."),
            Sanity::Readable
        );
        assert_eq!(
            judge("The harbour was quiet, and the word for sea in that language is 海 there."),
            Sanity::Readable
        );
    }

    #[test]
    fn a_sentence_that_is_a_question_is_readable() {
        assert_eq!(judge("What does the sea look like from here?"), Sanity::Readable);
    }

    #[test]
    fn a_short_answer_is_not_judged_either_way() {
        assert_eq!(judge("The sea is blue."), Sanity::Unjudgeable);
        assert_eq!(judge(""), Sanity::Unjudgeable);
        assert_eq!(judge("   \n  "), Sanity::Unjudgeable);
    }

    #[test]
    fn a_short_run_of_question_marks_is_not_enough_to_judge() {
        // The counter-check to the rule above: the same three characters that
        // would be 100 percent of a tiny sample never reach a verdict at all.
        assert_eq!(judge("???"), Sanity::Unjudgeable);
    }

    // ── The decision ────────────────────────────────────────────────────────

    /// A card with matrix cores, flash attention on, all layers offloaded.
    fn a_modern_card() -> EngineFacts {
        EngineFacts {
            gpu_layers: Some(999),
            flash_attention_on: true,
            every_device_without_matrix_cores: false,
        }
    }

    /// The reporters' class: no matrix cores, flash attention on by default.
    fn an_old_card() -> EngineFacts {
        EngineFacts { every_device_without_matrix_cores: true, ..a_modern_card() }
    }

    fn on_the_processor() -> EngineFacts {
        EngineFacts { gpu_layers: Some(0), ..a_modern_card() }
    }

    #[test]
    fn garbage_from_the_graphics_card_restarts_on_the_processor() {
        assert_eq!(
            decide(Sanity::Garbled(Garble::QuestionMarks), &a_modern_card()),
            AfterProbe::RestartOnCpu
        );
        assert_eq!(
            decide(Sanity::Garbled(Garble::NoLetters), &EngineFacts { gpu_layers: Some(4), ..a_modern_card() }),
            AfterProbe::RestartOnCpu
        );
    }

    #[test]
    fn a_card_without_matrix_cores_drops_flash_attention_before_it_is_given_up() {
        assert_eq!(
            decide(Sanity::Garbled(Garble::MixedScripts), &an_old_card()),
            AfterProbe::RestartWithoutFlashAttention
        );
        // And once that rung has been taken, the next unreadable answer goes
        // to the processor rather than round the same loop again.
        assert_eq!(
            decide(
                Sanity::Garbled(Garble::MixedScripts),
                &EngineFacts { flash_attention_on: false, ..an_old_card() }
            ),
            AfterProbe::RestartOnCpu
        );
    }

    #[test]
    fn a_card_with_matrix_cores_never_takes_the_flash_attention_rung() {
        // The counter-check to the rung. The citations behind it are all about
        // the SCALAR attention kernel, which a card with matrix cores does not
        // run, so on that card it would be a guess dressed as a fix.
        assert_eq!(
            decide(Sanity::Garbled(Garble::QuestionMarks), &a_modern_card()),
            AfterProbe::RestartOnCpu
        );
    }

    #[test]
    fn garbage_from_the_processor_stops_instead_of_retrying() {
        assert_eq!(
            decide(Sanity::Garbled(Garble::QuestionMarks), &on_the_processor()),
            AfterProbe::GiveUp
        );
        assert_eq!(
            decide(
                Sanity::Garbled(Garble::OneCharacter),
                &EngineFacts { gpu_layers: None, ..an_old_card() }
            ),
            AfterProbe::GiveUp
        );
    }

    #[test]
    fn a_healthy_engine_is_left_alone() {
        assert_eq!(decide(Sanity::Readable, &a_modern_card()), AfterProbe::Serve);
        assert_eq!(decide(Sanity::Readable, &an_old_card()), AfterProbe::Serve);
        assert_eq!(decide(Sanity::Readable, &on_the_processor()), AfterProbe::Serve);
    }

    #[test]
    fn a_probe_that_could_not_judge_never_moves_the_engine() {
        assert_eq!(decide(Sanity::Unjudgeable, &a_modern_card()), AfterProbe::Serve);
        assert_eq!(decide(Sanity::Unjudgeable, &an_old_card()), AfterProbe::Serve);
        assert_eq!(decide(Sanity::Unjudgeable, &on_the_processor()), AfterProbe::Serve);
    }

    // ── Reading the device line ─────────────────────────────────────────────

    #[test]
    fn the_device_line_of_a_pascal_card_says_it_has_no_matrix_cores() {
        // Verbatim from llama.cpp issue 15272.
        let startup = "ggml_vulkan: Found 1 Vulkan devices:\nggml_vulkan: 0 = NVIDIA GeForce GTX 1050 Ti (NVIDIA) | uma: 0 | fp16: 0 | bf16: 0 | warp size: 32 | shared memory: 49152 | int dot: 1 | matrix cores: none\n";
        assert_eq!(device_without_matrix_cores(startup), Some(true));
    }

    #[test]
    fn the_device_line_of_a_modern_card_says_it_has_them() {
        let startup = "ggml_vulkan: 0 = NVIDIA GeForce RTX 3060 (NVIDIA) | uma: 0 | fp16: 1 | bf16: 1 | warp size: 32 | shared memory: 49152 | int dot: 1 | matrix cores: KHR_coopmat\n";
        assert_eq!(device_without_matrix_cores(startup), Some(false));
    }

    #[test]
    fn one_capable_card_among_several_is_enough_to_skip_the_rung() {
        let startup = "ggml_vulkan: 0 = Intel(R) UHD Graphics (Intel) | uma: 1 | fp16: 1 | matrix cores: none\nggml_vulkan: 1 = NVIDIA GeForce RTX 4070 (NVIDIA) | uma: 0 | fp16: 1 | matrix cores: NV_coopmat2\n";
        assert_eq!(device_without_matrix_cores(startup), Some(false));
    }

    #[test]
    fn a_build_that_names_no_device_is_left_unknown() {
        // Metal and a processor-only build print no such line at all, and an
        // unknown machine is never acted on.
        assert_eq!(device_without_matrix_cores(""), None);
        // Verbatim from the shipped sidecar on this machine, 2026-09-11. The
        // Metal build names no device at all, so the rung is never taken here,
        // which is the counter-check to the two tests above: on Metal the flag
        // is only ever set where llama-server itself said the card has no
        // matrix cores (the Vulkan build, which says nothing, see GH #156 below).
        let mac = "0.00.075.755 I srv    load_model: loading model '/Users/x/models/Qwen2.5-0.5B-Instruct-Q8_0.gguf'\n0.00.715.606 I srv    load_model: initializing, n_slots = 4, n_ctx_slot = 8192, kv_unified = 'true'\n0.00.719.437 I srv  llama_server: model loaded\n";
        assert_eq!(device_without_matrix_cores(mac), None);
    }

    // GH #156: what the pinned Vulkan build really prints. Verbatim from the
    // shipped Windows sidecar (049326a, RTX 3060, -lv 4), 15.10.2026: the
    // device is named, the matrix cores are not.
    const PINNED_VULKAN_STARTUP: &str = "0.00.140.028 I cmn  common_param:   - Vulkan0 : NVIDIA GeForce RTX 3060 (12329 MiB, 11559 MiB free)\n0.00.696.228 I llama_prepare_model_devices: using device Vulkan0 (NVIDIA GeForce RTX 3060) (0000:01:00.0) - 11557 MiB free\n0.00.921.576 I load_tensors: offloaded 25/25 layers to GPU\n";

    /// The device line of a Navi 10 card on Mesa RADV, built from the format
    /// string in ggml-vulkan.cpp (ggml_vk_print_gpu_info) with the values
    /// RADV reports for RDNA 1: fp16 yes, wave64 subgroups, no cooperative
    /// matrix extension (RADV exposes it from RDNA 3 on).
    const RDNA1_RADV_LINE: &str = "ggml_vulkan: 0 = AMD Radeon RX 5700 XT (RADV NAVI10) (radv) | uma: 0 | fp16: 1 | bf16: 0 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: none\n";

    #[test]
    fn gh156_the_pinned_vulkan_build_names_no_matrix_cores() {
        assert_eq!(device_without_matrix_cores(PINNED_VULKAN_STARTUP), None);
        assert_eq!(matrix_cores_label(PINNED_VULKAN_STARTUP), "not reported");
    }

    #[test]
    fn gh156_a_silent_vulkan_build_may_take_the_flash_attention_rung() {
        assert!(may_lack_matrix_cores(PINNED_VULKAN_STARTUP, true));
        let facts = EngineFacts {
            gpu_layers: Some(998),
            flash_attention_on: true,
            every_device_without_matrix_cores: may_lack_matrix_cores(PINNED_VULKAN_STARTUP, true),
        };
        assert_eq!(decide(Sanity::Garbled(Garble::QuestionMarks), &facts), AfterProbe::RestartWithoutFlashAttention);
        // Still garbled without flash attention: the processor, as before.
        let without = EngineFacts { flash_attention_on: false, ..facts };
        assert_eq!(decide(Sanity::Garbled(Garble::QuestionMarks), &without), AfterProbe::RestartOnCpu);
        // NEGATIVE CONTROL: the rule before this change read the silence as
        // "has matrix cores" and skipped the rung.
        let before = EngineFacts {
            every_device_without_matrix_cores: device_without_matrix_cores(PINNED_VULKAN_STARTUP).unwrap_or(false),
            ..facts
        };
        assert_eq!(decide(Sanity::Garbled(Garble::QuestionMarks), &before), AfterProbe::RestartOnCpu);
    }

    #[test]
    fn gh156_a_printed_line_is_still_believed() {
        assert!(may_lack_matrix_cores(RDNA1_RADV_LINE, true));
        assert_eq!(matrix_cores_label(RDNA1_RADV_LINE), "none");
        let rdna3 = "ggml_vulkan: 0 = AMD Radeon RX 7900 XTX (RADV NAVI31) (radv) | uma: 0 | fp16: 1 | bf16: 0 | warp size: 64 | shared memory: 65536 | int dot: 1 | matrix cores: KHR_coopmat\n";
        assert!(!may_lack_matrix_cores(rdna3, true), "a card that says it has them skips the rung");
        assert_eq!(matrix_cores_label(rdna3), "present");
    }

    #[test]
    fn gh156_the_metal_build_keeps_an_unknown_as_unknown() {
        assert!(!may_lack_matrix_cores("", false));
        assert!(!may_lack_matrix_cores(PINNED_VULKAN_STARTUP, false));
    }

    // ── The transport ───────────────────────────────────────────────────────

    #[test]
    fn the_probe_only_ever_asks_loopback() {
        assert_eq!(probe_url(8127), "http://127.0.0.1:8127/v1/chat/completions");
        assert!(probe_url(9999).starts_with("http://127.0.0.1:"));
    }

    #[test]
    fn the_answer_is_read_out_of_an_openai_shaped_body() {
        let body = serde_json::json!({
            "choices": [{ "message": { "role": "assistant", "content": "The sea is loud today." } }]
        });
        assert_eq!(answer_text(&body).as_deref(), Some("The sea is loud today."));
    }

    #[test]
    fn a_body_of_another_shape_yields_no_answer() {
        assert_eq!(answer_text(&serde_json::json!({ "error": "no model" })), None);
        assert_eq!(answer_text(&serde_json::json!({ "choices": [] })), None);
    }

    // ── D3: telling a thinking model apart from a genuinely short answer ────

    #[test]
    fn reasoning_content_is_read_when_the_engine_reports_it_separately() {
        let body = serde_json::json!({
            "choices": [{ "message": { "role": "assistant", "content": "", "reasoning_content": "Okay, let me think about this passage..." } }]
        });
        assert_eq!(
            reasoning_text(&body).as_deref(),
            Some("Okay, let me think about this passage...")
        );
    }

    #[test]
    fn the_older_reasoning_field_name_is_read_too() {
        let body = serde_json::json!({
            "choices": [{ "message": { "content": "", "reasoning": "hmm" } }]
        });
        assert_eq!(reasoning_text(&body).as_deref(), Some("hmm"));
    }

    #[test]
    fn an_ordinary_model_with_no_reasoning_field_yields_none() {
        // Negative control: most models, most of the time.
        let body = serde_json::json!({
            "choices": [{ "message": { "content": "The sea is loud today." } }]
        });
        assert_eq!(reasoning_text(&body), None);
        // And an empty or whitespace-only reasoning field counts as none too.
        let blank = serde_json::json!({
            "choices": [{ "message": { "content": "", "reasoning_content": "   " } }]
        });
        assert_eq!(reasoning_text(&blank), None);
    }

    #[test]
    fn verdict_label_names_the_think_block_only_when_both_conditions_hold() {
        assert_eq!(
            verdict_label(Sanity::Unjudgeable, true),
            "too short to judge (still inside a <think> block)"
        );
        // Negative controls: either condition missing falls back to the
        // ordinary label, unchanged from before D3.
        assert_eq!(verdict_label(Sanity::Unjudgeable, false), "too short to judge");
        assert_eq!(verdict_label(Sanity::Readable, true), "readable");
        assert_eq!(
            verdict_label(Sanity::Garbled(Garble::OneWord), true),
            "garbled: one word repeated"
        );
    }

    // ── The probe against a real socket ─────────────────────────────────────
    //
    // The pure half above proves the rules. These prove the other half: that
    // the probe really posts, really reads the body back, and really turns a
    // reporter's answer into a verdict, over a loopback socket rather than a
    // mock. The stub stands in for llama-server, which is not on a CI runner.

    /// A one-shot HTTP server on a free port. `body` is the JSON it answers
    /// with; `status` the line it answers it under. Returns the port.
    fn stub_engine(status: &'static str, body: &'static str) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let Ok((mut socket, _)) = listener.accept() else { return };
            // Read until the headers are done, then whatever body fits in one
            // read. Enough to keep the client from seeing a reset.
            let mut buf = [0u8; 8192];
            let _ = socket.read(&mut buf);
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = socket.write_all(response.as_bytes());
            let _ = socket.flush();
        });
        port
    }

    #[test]
    fn the_probe_calls_a_real_socket_and_judges_prose_readable() {
        let port = stub_engine(
            "200 OK",
            r#"{"choices":[{"message":{"role":"assistant","content":"The sea rolls in grey and heavy under a low sky."}}]}"#,
        );
        let out = probe_engine(port, Duration::from_secs(5)).expect("the stub answered");
        assert_eq!(out.verdict, Sanity::Readable);
        assert!(out.sample.starts_with("The sea rolls in"));
    }

    #[test]
    fn the_probe_calls_a_real_socket_and_judges_the_reported_stream_garbled() {
        let port = stub_engine(
            "200 OK",
            r#"{"choices":[{"message":{"role":"assistant","content":"????????????????????????????????"}}]}"#,
        );
        let out = probe_engine(port, Duration::from_secs(5)).expect("the stub answered");
        assert_eq!(out.verdict, Sanity::Garbled(Garble::QuestionMarks));
        assert_eq!(decide(out.verdict, &a_modern_card()), AfterProbe::RestartOnCpu);
    }

    #[test]
    fn a_thinking_model_that_used_up_its_budget_reasoning_is_marked_still_thinking() {
        // D3: the visible answer is empty (the probe's small PROBE_TOKENS
        // budget went entirely into the <think> block), so judge() correctly
        // calls it Unjudgeable, but `still_thinking` is what turns the log
        // line from a generic "too short to judge" into a sentence that
        // names the actual, harmless reason.
        let port = stub_engine(
            "200 OK",
            r#"{"choices":[{"message":{"role":"assistant","content":"","reasoning_content":"Okay, the passage describes a fishing harbour"}}]}"#,
        );
        let out = probe_engine(port, Duration::from_secs(5)).expect("the stub answered");
        assert_eq!(out.verdict, Sanity::Unjudgeable);
        assert!(out.still_thinking, "a non-empty reasoning_content next to empty content should be recognised");
        assert_eq!(
            verdict_label(out.verdict, out.still_thinking),
            "too short to judge (still inside a <think> block)"
        );
        // And decide() still serves it, D3 requires this stays true no
        // matter how the log line is worded.
        assert_eq!(decide(out.verdict, &a_modern_card()), AfterProbe::Serve);
    }

    #[test]
    fn a_short_answer_with_no_reasoning_field_is_not_marked_still_thinking() {
        // Negative control: an ordinary short/odd answer (no reasoning_content
        // at all) must not be mislabelled as a thinking model.
        let port = stub_engine(
            "200 OK",
            r#"{"choices":[{"message":{"role":"assistant","content":"Hi."}}]}"#,
        );
        let out = probe_engine(port, Duration::from_secs(5)).expect("the stub answered");
        assert_eq!(out.verdict, Sanity::Unjudgeable);
        assert!(!out.still_thinking);
        assert_eq!(verdict_label(out.verdict, out.still_thinking), "too short to judge");
    }

    #[test]
    fn an_error_answer_is_no_verdict_at_all() {
        let port = stub_engine("500 Internal Server Error", r#"{"error":"no slot"}"#);
        assert!(probe_engine(port, Duration::from_secs(5)).is_none());
    }

    #[test]
    fn nothing_listening_is_no_verdict_at_all() {
        // A port that refuses the connection: nothing answers, and the probe
        // must come back empty rather than call that garbled.
        let (port, _held) = crate::test_support::refusing_port();
        assert!(probe_engine(port, Duration::from_secs(2)).is_none());
    }

    #[test]
    fn the_log_sample_is_flat_and_bounded() {
        let s = sample_for_log("line one\nline two\ttabbed", 200);
        assert!(!s.contains('\n'));
        assert!(!s.contains('\t'));
        assert_eq!(sample_for_log(&"x".repeat(500), 120).len(), 120);
    }
}
