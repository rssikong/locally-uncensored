/**
 * i18n for this fork (Simplified Chinese), built to survive upstream merges.
 *
 * ── Why the dictionary is keyed by the English source string ─────────────
 *
 * `t('New chat')` takes the English text the upstream code already had, and
 * the dictionary answers with the Chinese one. Three consequences, all of them
 * the point:
 *
 *   1. A string upstream adds tomorrow is not a missing key, a build error or
 *      an empty label: it renders in English until somebody translates it.
 *      Nothing has to be registered before it can be seen.
 *   2. A string upstream *edits* shows up in English again rather than showing
 *      a stale translation of a sentence that no longer exists. Wrong text in
 *      Chinese is worse than right text in English.
 *   3. There is no key naming scheme to keep in sync, so a merge conflict is
 *      limited to the lines that actually carry a translated sentence.
 *
 * ── Why tests keep running English ───────────────────────────────────────
 *
 * The suite is 1326 unit test files and 487 e2e cases, and a large share of
 * them assert on visible copy (`getByText`, accessible names). If the default
 * flipped to Chinese, translating a screen would turn the gate red and the
 * release workflow's `gate` job (which is `uses: ci.yml`) would block every
 * build. So the locale resolution below answers `en` whenever it runs under
 * vitest or under the Playwright web server, and `zh-CN` for the shipped app.
 * Translation never touches the gate.
 */
import { translate } from './pack'
import { installI18nBridge } from './bridge'

export type Locale = 'zh-CN' | 'en'

/** What a build shows when nothing else applies. */
export const DEFAULT_LOCALE: Locale = 'zh-CN'

export const LOCALE_STORAGE_KEY = 'lu:locale'

let pinned: Locale | null = null

function isLocale(value: unknown): value is Locale {
  return value === 'zh-CN' || value === 'en'
}

/**
 * True when this locale is the source language. Kept as a function because
 * callers ask "is the UI translated?" rather than "which dictionary exists?".
 */
export function isTranslated(locale: Locale = resolveLocale()): boolean {
  return locale === 'zh-CN'
}

/**
 * Which language this run speaks, first hit wins:
 *
 *   1. `setLocale()` during this session (a future switch in Settings);
 *   2. `MODE === 'test'` → English. vitest sets this; CI's unit tests are the
 *      reason it is first (see the header);
 *   3. `VITE_LU_LOCALE` → pinned at build/dev time. `playwright.config.ts`
 *      sets `en` for its web server, so e2e keeps its English selectors;
 *   4. the user's saved choice;
 *   5. the default, Chinese.
 */
export function resolveLocale(): Locale {
  if (pinned) return pinned

  const env = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}
  if (env.MODE === 'test') return 'en'

  const forced = env.VITE_LU_LOCALE
  if (isLocale(forced)) return forced

  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY)
    if (isLocale(saved)) return saved
  } catch {
    /* a locked localStorage must not decide the language */
  }

  return DEFAULT_LOCALE
}

export function getLocale(): Locale {
  return resolveLocale()
}

/**
 * Pin the language for this session and remember it. `reload` is the honest
 * default: the tree is already rendered, and re-rendering every text from the
 * top is cheaper to reason about than a subscription on a module variable.
 */
export function setLocale(locale: Locale, options: { reload?: boolean } = {}): void {
  pinned = locale
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* not remembering is acceptable; not switching is not */
  }
  applyDocumentLocale()
  if (options.reload !== false && typeof window !== 'undefined') window.location.reload()
}

/**
 * `<html lang>` and nothing else. The CSS keys off `.dark`, not off the
 * language, so there is no second place to change.
 */
/**
 * Tells the document which language it speaks, and in Chinese mode starts the
 * runtime bridge that translates what is already on screen.
 *
 * Both live here so `src/main.tsx` needs exactly one call: keeping the fork's
 * footprint in upstream files at one line is the whole point (see AGENTS.md).
 * The bridge is idempotent, and it is never installed in English mode — which
 * is why the 1660 existing tests, all English, cannot be affected by it.
 */
export function applyDocumentLocale(): void {
  if (typeof document === 'undefined') return
  const locale = resolveLocale()
  document.documentElement.setAttribute('lang', locale)
  if (locale === 'zh-CN') installI18nBridge()
}

function interpolate(text: string, vars: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  )
}

/**
 * Translate an English source string.
 *
 * `t('Delete {n} items', { n: 3 })` — placeholders are `{name}`, and an
 * unknown placeholder is left as written rather than replaced with
 * "undefined", which is how a half-translated sentence stays readable.
 */
export function t(source: string, vars?: Record<string, string | number>): string {
  // English mode is the identity: the app's own copy is already English, and
  // every one of the 1660 unit tests runs in it.
  const text = resolveLocale() === 'zh-CN' ? (translate(source) ?? source) : source
  return vars ? interpolate(text, vars) : text
}

/** Translation without the fallback, for tooling and tests. */
export function translationFor(source: string, locale: Locale = resolveLocale()): string | null {
  return locale === 'zh-CN' ? translate(source) : null
}
