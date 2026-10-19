/**
 * The one token estimate of the app, script aware (GH #167).
 *
 * Leaf module by contract: no imports. The provider layer
 * (openai-provider.ts) needs this number too, and context-compaction.ts
 * imports the provider layer, so the function lives here and
 * context-compaction.ts re-exports it under its old name and signature.
 *
 * WHY NOT chars / 4 ANY MORE
 *
 * chars / 4 is a rule of thumb for English prose. A user writing Japanese
 * (GH #167, Gemma via LM Studio) measured the real cost: with a history budget
 * of 16,384 the server received 41,000 to 43,000 prompt tokens, with 4,096 it
 * received 9,000 to 10,000. Gemma needs about 1.4 Japanese characters per
 * token, chars / 4 counted 4, so every budget was undercounted about 2.8 times
 * and the trim (and auto compact) only fired after the backend had overflowed.
 *
 * Each character is now charged by its script:
 *
 *   - ASCII (Latin text, code, JSON):      1/4 token as the base, with
 *     surcharges for digits and encoded runs (3.0.7, below). Text without
 *     digits keeps exactly the old ceil(len / 4) + 1.
 *   - Han, Kana, Hangul, CJK punctuation and fullwidth forms: 0.8 token, that
 *     is 1.25 characters per token. The measured Gemma rate is 1.4 characters
 *     per token (0.71 token each), so this overestimates that tokenizer by
 *     about 12 percent. On purpose: an estimate that is too high trims a little
 *     early, one that is too low sends a prompt the server cannot hold.
 *   - Other non ASCII letters below U+0900 (accented Latin, Greek, Cyrillic,
 *     Hebrew, Arabic): 0.4 token, 2.5 characters per token.
 *   - U+0900 to U+1FFF (Indic scripts, Thai, Georgian, Ethiopic and so on):
 *     0.6 token. Common tokenizers split these scripts finely.
 *   - Everything else in the BMP (general punctuation, arrows, math and box
 *     symbols, dingbats, private use, variation selectors): 1 token each.
 *   - Characters outside the BMP (emoji, rare Han extensions): 2 tokens per
 *     code point, a byte fallback typically costs that or more.
 *
 * DIGITS AND ENCODED RUNS (3.0.7)
 *
 * A Windows run with Qwen2.5 on a 32K window got HTTP 400 "request (38214
 * tokens) exceeds the available context size (32768 tokens)" from three
 * messages of a numeric log, while the estimate said about 26,000: the
 * budget never trimmed. Qwen, Gemma, Llama 2 and Mistral give every digit a
 * token of its own, and the space or sign in front of a number one more.
 * Measured with the Qwen2.5 and Gemma 3 tokenizers (characters per token):
 * the log 2.7, a digit block 1.0, hex 1.1, Base64 1.4, a UUID list 1.1,
 * JSON with numbers 1.9, English prose 3.6 to 3.7, TypeScript 3.6 to 3.9.
 * chars / 4 undercounted the first five three to four times. So, on top of
 * the 1/4 every ASCII character pays:
 *
 *   - a digit costs 1 token;
 *   - a space or sign directly before a digit costs 1 token;
 *   - inside an encoded run (16 or more of [A-Za-z0-9+/=_-] in a row, with
 *     digits in it and the character class changing at least every fourth
 *     character: hex, Base64, UUIDs, hashes) every non digit costs 3/4 token.
 *
 * Measured against both tokenizers a digit block, a CSV of numbers, hex,
 * Base64, UUIDs and the log of the run now land at 1.0 to 1.15 times the real
 * count. Prose and code keep the old rate (0.95 to 1.05). JSON full of short
 * numbers is still under (about 0.7, was 0.47): its quotes and brackets are
 * tokens of their own, and charging punctuation would overcount the tool
 * catalogues, which are mostly prose, by a third. Tokenizers that group three
 * digits (Llama 3, GPT 4) are overestimated on numbers, which only trims
 * early.
 */
/** Tokens per character, by script. Exported for the tests that pin them. */
export const TOKENS_PER_CHAR = {
  ascii: 1 / 4,
  digit: 1,
  beforeDigit: 1,
  encodedRun: 3 / 4,
  cjk: 0.8,
  latinExtended: 0.4,
  denseScript: 0.6,
  symbol: 1,
  astral: 2,
} as const

function isCjk(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x11ff) || // Hangul Jamo
    (c >= 0x2e80 && c <= 0x2fdf) || // CJK radicals, Kangxi radicals
    (c >= 0x3000 && c <= 0x303f) || // CJK symbols and punctuation
    (c >= 0x3040 && c <= 0x30ff) || // Hiragana, Katakana
    (c >= 0x3100 && c <= 0x31ff) || // Bopomofo, Hangul compat Jamo, Kanbun, Katakana ext
    (c >= 0x3200 && c <= 0x33ff) || // Enclosed CJK, CJK compatibility
    (c >= 0x3400 && c <= 0x4dbf) || // CJK ext A
    (c >= 0x4e00 && c <= 0x9fff) || // CJK unified ideographs
    (c >= 0xa960 && c <= 0xa97f) || // Hangul Jamo ext A
    (c >= 0xac00 && c <= 0xd7ff) || // Hangul syllables, Jamo ext B
    (c >= 0xf900 && c <= 0xfaff) || // CJK compatibility ideographs
    (c >= 0xfe30 && c <= 0xfe4f) || // CJK compatibility forms
    (c >= 0xff00 && c <= 0xffef) // Halfwidth and fullwidth forms
  )
}

/** Character classes of ASCII for the run rules. */
const Ascii = {
  Space: 0,
  Digit: 1,
  Lower: 2,
  Upper: 3,
  /** One of + / = _ - : punctuation that belongs to an encoded run. */
  RunSign: 4,
  Punct: 5,
} as const
type Ascii = (typeof Ascii)[keyof typeof Ascii]

function asciiClass(c: number): Ascii {
  if (c >= 0x30 && c <= 0x39) return Ascii.Digit
  if (c >= 0x61 && c <= 0x7a) return Ascii.Lower
  if (c >= 0x41 && c <= 0x5a) return Ascii.Upper
  if (c === 0x20 || (c >= 0x09 && c <= 0x0d)) return Ascii.Space
  if (c === 0x2b || c === 0x2f || c === 0x3d || c === 0x5f || c === 0x2d) return Ascii.RunSign
  return Ascii.Punct
}

/** Shortest run of [A-Za-z0-9+/=_-] that can count as encoded. */
const ENCODED_RUN_MIN = 16

/** Unrounded token weight of a string, without the +1 per call. */
function weigh(text: string): number {
  let ascii = 0
  let digits = 0
  let beforeDigit = 0
  let encoded = 0
  let cjk = 0
  let latinExtended = 0
  let dense = 0
  let symbol = 0
  let astral = 0
  // The current run of [A-Za-z0-9+/=_-]: length, digits, class changes.
  let runLen = 0
  let runDigits = 0
  let runChanges = 0
  let prev: Ascii | null = null
  const endRun = () => {
    if (
      runLen >= ENCODED_RUN_MIN &&
      runDigits * 20 >= runLen &&
      runChanges * 4 >= runLen
    ) {
      encoded += runLen - runDigits
    }
    runLen = 0
    runDigits = 0
    runChanges = 0
  }
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c < 0x80) {
      ascii++
      const k = asciiClass(c)
      if (k === Ascii.Digit) {
        digits++
        if (prev === Ascii.Space || prev === Ascii.Punct || prev === Ascii.RunSign) beforeDigit++
      }
      if (k === Ascii.Space || k === Ascii.Punct) {
        endRun()
      } else {
        if (runLen > 0 && k !== prev) runChanges++
        runLen++
        if (k === Ascii.Digit) runDigits++
      }
      prev = k
      continue
    }
    endRun()
    prev = null
    if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: one code point outside the BMP. Its low half is
      // skipped so the pair is charged once.
      astral++
      const next = text.charCodeAt(i + 1)
      if (next >= 0xdc00 && next <= 0xdfff) i++
    } else if (isCjk(c)) cjk++
    else if (c < 0x0900) latinExtended++
    else if (c < 0x2000) dense++
    else symbol++
  }
  endRun()
  const base = TOKENS_PER_CHAR.ascii
  return (
    ascii * base +
    digits * (TOKENS_PER_CHAR.digit - base) +
    beforeDigit * (TOKENS_PER_CHAR.beforeDigit - base) +
    encoded * (TOKENS_PER_CHAR.encodedRun - base) +
    cjk * TOKENS_PER_CHAR.cjk +
    latinExtended * TOKENS_PER_CHAR.latinExtended +
    dense * TOKENS_PER_CHAR.denseScript +
    symbol * TOKENS_PER_CHAR.symbol +
    astral * TOKENS_PER_CHAR.astral
  )
}

/**
 * Estimated tokens of `text`. Text without digits keeps the old ceil(len / 4) + 1
 * to the token, so English prose and every budget built on it behave as
 * before; digits, encoded runs and other scripts are charged as
 * described above.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(weigh(text)) + 1
}

/**
 * Characters per estimated token in `text`: 4 for text without digits, about
 * 1.25 for Japanese, about 1 for a digit block. For the places that hold a
 * budget in TOKENS but have to cut a string in CHARACTERS.
 */
export function charsPerToken(text: string): number {
  const w = weigh(text)
  return w > 0 ? Math.min(4, text.length / w) : 4
}
