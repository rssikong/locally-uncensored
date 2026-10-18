/**
 * The dictionary and the only place a translation is looked up.
 *
 * Keys are the English text the app already renders; values are the Chinese
 * copy. `scripts/i18n-apply.mjs` writes `zh-CN.ts`; nothing else in the app
 * knows or cares where a sentence came from.
 *
 * Two lookups, in this order:
 *   1. exact match  — the overwhelming majority
 *   2. pattern      — `Tasks ({0})`, `Remove {0}`: a count or a name inside a
 *                     sentence, captured and substituted back
 *
 * A miss returns `null`, never the source string. The caller decides what a
 * miss means; the runtime bridge leaves the English text alone, and that is
 * deliberate: a wrong Chinese sentence is worse than a right English one.
 */
import { ZH_CN, ZH_PATTERNS } from './zh-CN'

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
}

/** Restore the bundled dictionary. */
export function resetDictionary(): void {
  dictionary = ZH_CN
  activePatterns = ZH_PATTERNS
  compiledPatterns = null
}

/** Chinese for an English source string, or `null` when none is known. */
export function translate(source: string): string | null {
  // `Object.hasOwn` and not `dictionary[source]`: a rendered word like
  // "constructor" would otherwise hit Object.prototype and return a function.
  if (Object.hasOwn(dictionary, source)) return dictionary[source]

  for (const pattern of patterns()) {
    const match = pattern.regex.exec(source)
    if (!match) continue
    return pattern.replacement.replace(/\{(\d+)\}/g, (whole, index: string) => {
      const captured = match[Number(index) + 1]
      return captured ?? whole
    })
  }

  return null
}

/** How many exact entries the dictionary carries (for the settings/diagnostic line). */
export function dictionarySize(): number {
  return Object.keys(dictionary).length
}

/** Pattern count, same reason. */
export function patternCount(): number {
  return activePatterns.length
}
