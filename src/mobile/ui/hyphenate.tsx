/**
 * Where a long word of a title may break, with a hyphen.
 *
 * At 320 px and 200 percent text a title has room for about eleven letters.
 * "Troubleshooting" then broke wherever the line ended ("Troublesho oting").
 * The engine is not asked to hyphenate on its own (hyphens: manual in the
 * stylesheets): on a phone it then cut words that had a line to themselves
 * ("docu-ments", "pass-word?", "Uncen-sored", acceptance iPhone, K7), and
 * an engine without an English dictionary did nothing at all (headless
 * Chromium on a Mac, 08.10.2026). So the titles of the shell bring their own
 * break points, for long words only: an invisible mark between two
 * syllables that shows, as a hyphen, when the line really breaks there. A
 * shorter word goes to the next line whole. A word wider than a whole line
 * still breaks where the line ends (overflow-wrap), as the last resort.
 *
 * A name of the product is never cut (UNBROKEN below).
 *
 * The mark is an empty element with the soft hyphen as generated content. It
 * is hidden from the accessibility tree and is no text of the document, so
 * the name of a button, a text search and a test still read "Troubleshooting".
 *
 * The rules are a short approximation, not a dictionary: before a known
 * ending, and between or before two consonants that stand between vowels.
 * They only run on words of eleven letters and more.
 */
import { Fragment, type ReactNode } from 'react'

/** Shorter words fit on a line of a 320 px screen at 200 percent and are left alone. */
export const HYPHEN_MIN_WORD = 11
/** Letters that stay together at the start and at the end of a word. */
const EDGE = 3

/** Names that stay in one piece, in lower case. A word that contains one is not cut at all. */
export const UNBROKEN = ['uncensored']

/** Endings a word may break in front of, longest first. */
const ENDINGS = ['ments', 'tions', 'sions', 'ities', 'ment', 'ness', 'tion', 'sion', 'ings', 'able', 'ible', 'ally', 'ized', 'ised', 'ship', 'less', 'ance', 'ence', 'ing', 'ity', 'ful']

/** Two consonants that start a syllable together: the break goes in front of them. */
const ONSETS = new Set(['bl', 'br', 'ch', 'cl', 'cr', 'dr', 'fl', 'fr', 'gl', 'gr', 'ph', 'pl', 'pr', 'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'th', 'tr', 'tw', 'wh', 'wr'])
/** Two consonants that end a syllable together: no break at them. */
const CODAS = new Set(['ck', 'dg', 'gh', 'ng'])

const isVowel = (letter: string | undefined) => !!letter && 'aeiouy'.includes(letter)

/**
 * Pure: the positions inside `word` where it may break, as counts of letters
 * in front of the break, ascending. Empty for a short word and for anything
 * that is not made of letters only.
 */
export function hyphenPoints(word: string): number[] {
  if (word.length < HYPHEN_MIN_WORD || !/^[A-Za-z]+$/.test(word)) return []
  const w = word.toLowerCase()
  if (UNBROKEN.some((name) => w.includes(name))) return []
  const points = new Set<number>()
  const ending = ENDINGS.find((e) => w.endsWith(e) && w.length - e.length >= EDGE + 1)
  const stemEnd = ending ? w.length - ending.length : w.length
  if (ending) points.add(stemEnd)
  // vowel, consonant, consonant, vowel: "per|mis", "trou|ble".
  for (let i = 1; i + 2 < stemEnd; i += 1) {
    if (!isVowel(w[i - 1]) || isVowel(w[i]) || isVowel(w[i + 1]) || !isVowel(w[i + 2])) continue
    const pair = w.slice(i, i + 2)
    if (CODAS.has(pair)) continue
    points.add(ONSETS.has(pair) ? i : i + 1)
  }
  return [...points].filter((at) => at >= EDGE && w.length - at >= EDGE).sort((a, b) => a - b)
}

/** Pure: a word cut at its break points. One part for a word that does not break. */
export function hyphenParts(word: string): string[] {
  const parts: string[] = []
  let from = 0
  for (const at of hyphenPoints(word)) {
    parts.push(word.slice(from, at))
    from = at
  }
  parts.push(word.slice(from))
  return parts
}

const LONG_WORD = new RegExp(`[A-Za-z]{${HYPHEN_MIN_WORD},}`)
const WORDS = /[A-Za-z]+|[^A-Za-z]+/g

/**
 * A title with its break points. Gives the text back unchanged when no word
 * in it is long enough, which is nearly always.
 */
export function hyphenated(text: string): ReactNode {
  if (!LONG_WORD.test(text)) return text
  const out: ReactNode[] = []
  let key = 0
  for (const chunk of text.match(WORDS) ?? []) {
    const parts = hyphenParts(chunk)
    parts.forEach((part, i) => {
      if (i > 0) out.push(<span key={`s${key++}`} className="m-shy" aria-hidden="true" />)
      out.push(<Fragment key={`t${key++}`}>{part}</Fragment>)
    })
  }
  return out
}
