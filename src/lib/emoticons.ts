// Emoticons become emojis in the chat composer (3.0.7), the way chat apps do
// it: ":)" turns into 🙂 once the word is over. The list is the common one of
// Slack and Discord, kept small on purpose: every entry below is a face
// people type as a face, and none of them reads as anything else at the start
// of a word. "B)", "8)", ":/" and ":S" are left out, since "option B)", a
// numbered "8)" and "http:/" are not faces.

/** Emoticon to emoji. The longer spellings are tried first. */
export const EMOTICONS: Readonly<Record<string, string>> = {
  ':-)': '🙂', ':)': '🙂',
  ':-D': '😃', ':D': '😃',
  ';-)': '😉', ';)': '😉',
  ':-(': '🙁', ':(': '🙁',
  ":'(": '😢',
  ':-P': '😛', ':P': '😛', ':-p': '😛', ':p': '😛',
  ':-O': '😮', ':O': '😮', ':-o': '😮', ':o': '😮',
  ':-|': '😐', ':|': '😐',
  ':-*': '😘', ':*': '😘',
  'XD': '😆', 'xD': '😆',
  '</3': '💔', '<3': '❤️',
}

const BY_LENGTH = Object.keys(EMOTICONS).sort((a, b) => b.length - a.length)

/** What ends a word and lets the emoticon before it turn. */
export function endsWord(ch: string | undefined): boolean {
  return ch !== undefined && /[\s.,!?]/.test(ch)
}

/** Is position `at` of `text` inside code: a fenced block (```) or an inline
 *  span (`)? Counted from the start, the way Markdown reads it. */
export function insideCode(text: string, at: number): boolean {
  const before = text.slice(0, at)
  const fences = before.split('```').length - 1
  if (fences % 2 === 1) return true
  const afterLastFence = fences > 0 ? before.slice(before.lastIndexOf('```') + 3) : before
  return (afterLastFence.split('`').length - 1) % 2 === 1
}

/** The emoticon that ends at `end` of `text`, standing as a word of its own
 *  (at the start or after whitespace, so never inside a word, a URL or a
 *  path), and not inside code. */
export function emoticonEndingAt(text: string, end: number): string | null {
  for (const face of BY_LENGTH) {
    const start = end - face.length
    if (start < 0 || text.slice(start, end) !== face) continue
    if (start > 0 && !/\s/.test(text[start - 1])) continue
    if (insideCode(text, start)) return null
    return face
  }
  return null
}

/** One turn: the text before and after, and where the caret goes. */
export interface EmojiTurn {
  before: string
  after: string
  caret: number
}

/**
 * The turn a keystroke makes. `text` is the field after the keystroke and
 * `caret` stands right behind the character just typed. When that character
 * ends a word and the word before it is an emoticon, the emoticon becomes its
 * emoji; otherwise null.
 */
export function turnOnType(text: string, caret: number): EmojiTurn | null {
  if (caret < 1 || !endsWord(text[caret - 1])) return null
  const face = emoticonEndingAt(text, caret - 1)
  if (!face) return null
  const start = caret - 1 - face.length
  const emoji = EMOTICONS[face]
  return {
    before: text,
    after: text.slice(0, start) + emoji + text.slice(caret - 1),
    caret: start + emoji.length + 1,
  }
}

/** The text a send goes out with: an emoticon that ends the message turns
 *  too, as Enter ends its word. */
export function turnOnSend(text: string): string {
  const trimmed = text.replace(/\s+$/, '')
  const face = emoticonEndingAt(trimmed, trimmed.length)
  if (!face) return text
  return trimmed.slice(0, trimmed.length - face.length) + EMOTICONS[face] + text.slice(trimmed.length)
}
