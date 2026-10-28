/**
 * The dictionary and the only place a translation is looked up.
 *
 * Keys are the English text the app already renders; values are the Chinese
 * copy. `scripts/i18n-apply.mjs` writes `zh-CN.ts`; nothing else in the app
 * knows or cares where a sentence came from.
 *
 * Three lookups, in this order:
 *   1. override     — `overrides.ts`: hand-maintained corrections. They come
 *                     first because nothing automated writes that file, so a
 *                     manual fix cannot be retranslated away or pruned.
 *   2. exact match  — the generated dictionary, the overwhelming majority
 *   3. pattern      — `Tasks ({0})`, `Remove {0}`: a count or a name inside a
 *                     sentence, captured and substituted back
 *
 * A miss returns `null`, never the source string. The caller decides what a
 * miss means; the runtime bridge leaves the English text alone, and that is
 * deliberate: a wrong Chinese sentence is worse than a right English one.
 */
import { ZH_CN, ZH_PATTERNS } from './zh-CN'
import { ZH_OVERRIDES } from './overrides'

interface CompiledPattern {
  readonly replacement: string
  readonly regex: RegExp
}

const PATTERN_SLOT = /\{\d+\}/g

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * `Tasks ({0})` → `/^Tasks \((.+?)\)$/`.
 *
 * Each `{n}` becomes one non-greedy capture, so `Remove a, b` still matches a
 * pattern written for `Remove {0}` — the captured span is whatever the app put
 * there, not a guess about its shape.
 */
export function compilePattern(pattern: string): RegExp {
  const body = pattern
    .split(PATTERN_SLOT)
    .map(escapeRegex)
    .join('(.+?)')
  return new RegExp(`^${body}$`)
}

let compiledPatterns: CompiledPattern[] | null = null

/**
 * The dictionary in force. Bundled by default; `setDictionary` replaces it,
 * which is the seam a downloaded language pack will use later (see AGENTS.md,
 * phase P5) and what the tests use to exercise patterns.
 */
let dictionary: Record<string, string> = ZH_CN
let activePatterns: ReadonlyArray<readonly [string, string]> = ZH_PATTERNS

function patterns(): CompiledPattern[] {
  if (compiledPatterns) return compiledPatterns
  compiledPatterns = activePatterns.map(([pattern, replacement]) => ({
    replacement,
    regex: compilePattern(pattern),
  }))
  return compiledPatterns
}

/** Replace the dictionary (a downloaded pack, or a test fixture). */
export function setDictionary(
  strings: Record<string, string>,
  patterns: ReadonlyArray<readonly [string, string]> = [],
): void {
  dictionary = strings
  activePatterns = patterns
  compiledPatterns = null
  sortedKeys = null
}

/** Restore the bundled dictionary. */
export function resetDictionary(): void {
  dictionary = ZH_CN
  activePatterns = ZH_PATTERNS
  compiledPatterns = null
  sortedKeys = null
}

let sortedKeys: string[] | null = null

/**
 * Look up a string that was cut before we saw it.
 *
 * Model cards shorten catalogue copy to 89 characters plus `…` inside
 * `shortBlurb` (ModelTiles.tsx), i.e. before the text reaches the DOM. A cut
 * sentence matches nothing in a dictionary keyed by whole sentences, so the two
 * longest blurbs stayed English on the card while their translations sat
 * unused in zh-CN.ts.
 *
 * A head this long (16+ characters, usually ~89) is unambiguous, and the card
 * is `line-clamp-2`, so the longer Chinese cannot break the layout the way a
 * fixed-height box would.
 */
function lookupTruncated(source: string): string | null {
  if (source.length < 17 || !source.endsWith('…')) return null
  const head = source.slice(0, -1)
  if (sortedKeys === null) sortedKeys = Object.keys(dictionary).sort()
  // Binary search for the first key that is not ordered before `head`.
  let lo = 0
  let hi = sortedKeys.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (sortedKeys[mid] < head) lo = mid + 1
    else hi = mid
  }
  const candidate = sortedKeys[lo]
  if (candidate !== undefined && candidate.startsWith(head)) return dictionary[candidate]
  return null
}

/** Chinese for an English source string, or `null` when none is known. */
export function translate(source: string, depth = 0): string | null {
  // Overrides first, and `Object.hasOwn` for the same reason as the dictionary
  // below: a rendered word like "constructor" would otherwise reach
  // Object.prototype and return a function instead of a string.
  if (Object.hasOwn(ZH_OVERRIDES, source)) return ZH_OVERRIDES[source]

  // `Object.hasOwn` and not `dictionary[source]`: a rendered word like
  // "constructor" would otherwise hit Object.prototype and return a function.
  if (Object.hasOwn(dictionary, source)) return dictionary[source]

  // Nested lookups (depth > 0) only accept exact entries. Running patterns
  // again on a fragment is what produced "Large 个对话模型": the outer pattern
  // `{0} {1} run on LU Cloud.` splits lazily, so `{1}` was "big for this
  // graphics card. Large chat models", and `{0} chat models` happily matched
  // that half-sentence. A captured value is a name or a phrase, never a
  // sentence to be re-parsed.
  if (depth > 0) return lookupTruncated(source)

  for (const pattern of patterns()) {
    const match = pattern.regex.exec(source)
    if (!match) continue
    return pattern.replacement.replace(/\{(\d+)\}/g, (whole, index: string) => {
      const captured = match[Number(index) + 1]
      if (captured === undefined) return whole
      // A slot often holds English of its own — `将 [[0]] 重置为默认` with [[0]]
      // = "Voice & Remote", or `[[0]] [[1]] run on LU Cloud.`. Inserting it raw
      // produced half-Chinese sentences: "将 Voice & Remote 重置为默认".
      // Translate the captured value once, and only once: the guard against
      // `captured === source` keeps a slot-only pattern from recursing forever,
      // and `depth` stops a second nested lookup from starting a chain.
      if (depth === 0 && captured !== source) {
        const inner = translate(captured, 1)
        if (inner !== null) return inner
      }
      return captured
    })
  }

  return lookupTruncated(source)
}

/** How many exact entries the dictionary carries (for the settings/diagnostic line). */
export function dictionarySize(): number {
  return Object.keys(dictionary).length
}

/** Pattern count, same reason. */
export function patternCount(): number {
  return activePatterns.length
}
