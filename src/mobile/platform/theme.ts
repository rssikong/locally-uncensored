/**
 * Theme: System, Dark, Light. Default is System (DESIGN.md 2.5).
 *
 * The desktop setting `settings.theme` only knows dark and light, and its
 * type is not ours to widen. So the phone keeps its own preference under
 * `lu-mobile-theme` and puts the class `dark` or `light` on html, exactly
 * where the desktop puts it; the reused renderers (MarkdownRenderer,
 * CodeBlock) read their `dark:` variants from there.
 */
export type ThemePref = 'system' | 'dark' | 'light'
export type ResolvedTheme = 'dark' | 'light'

export const THEME_KEY = 'lu-mobile-theme'
/** Sent on window after the user chose a theme. */
export const THEME_EVENT = 'lu-mobile-theme-change'

type Listener = (pref: ThemePref, resolved: ResolvedTheme) => void
const listeners = new Set<Listener>()
let sessionOverride: ResolvedTheme | null = null
let watching = false

export function parseThemePref(value: string | null | undefined): ThemePref {
  return value === 'dark' || value === 'light' || value === 'system' ? value : 'system'
}

export function resolveTheme(pref: ThemePref, systemIsDark: boolean): ResolvedTheme {
  if (pref === 'system') return systemIsDark ? 'dark' : 'light'
  return pref
}

function systemIsDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function getThemePref(): ThemePref {
  try {
    return parseThemePref(localStorage.getItem(THEME_KEY))
  } catch {
    return 'system'
  }
}

export function currentTheme(): ResolvedTheme {
  return sessionOverride ?? resolveTheme(getThemePref(), systemIsDark())
}

function paint(): void {
  const resolved = currentTheme()
  const root = document.documentElement
  root.classList.toggle('dark', resolved === 'dark')
  root.classList.toggle('light', resolved === 'light')
  // The mark of the first frame (public/first-paint.js) keeps the page behind the shell light. It follows the theme from here on.
  root.classList.toggle('lu-first-light', resolved === 'light')
  root.classList.toggle('lu-first-dark', resolved === 'dark')
  root.style.background = resolved === 'dark' ? '#141414' : '#f3f4f6'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#141414' : '#f3f4f6')
  for (const fn of listeners) fn(getThemePref(), resolved)
}

/**
 * Put the theme on html before the first frame and follow the system from
 * then on. `override` pins a theme for this page load (developer switch).
 */
export function applyTheme(override: ResolvedTheme | null = null): ResolvedTheme {
  sessionOverride = override
  paint()
  if (!watching && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    watching = true
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', paint)
  }
  return currentTheme()
}

export function setThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    /* storage full or blocked: the theme still applies for this session */
  }
  sessionOverride = null
  paint()
  // The native side keeps the choice for the next cold start, where it has
  // to colour the window before this page runs (src/lib/lu-native.ts,
  // syncSystemBars). Going from a fixed theme back to System can leave the
  // page looking the same, so this event is what tells it.
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(THEME_EVENT))
}

export function onThemeChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
