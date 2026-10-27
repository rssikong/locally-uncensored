import type { ConsoleMessage, Page } from '@playwright/test'

/** The two phone sizes every mobile spec runs in: a current phone and the smallest supported one. */
export const SIZES = [
  { name: '390x844', width: 390, height: 844 },
  { name: '320x568', width: 320, height: 568 },
] as const

export interface OpenOptions {
  /** Route to open on top of the stack, for example /dev/ui. */
  route?: string
  /** Start in the tabs although the onboarding was never done. Default true. */
  skipOnboarding?: boolean
  theme?: 'dark' | 'light'
  /** Text scale in percent. */
  fontScale?: number
  /** Store preset to look at (src/mobile/policy). Works on the developer server only. */
  store?: 'open' | 'play' | 'appstore'
  /** The system the shell takes itself to run on (platform/detect.ts). Without it: none, as in a browser. */
  os?: 'android' | 'ios'
}

/** Address of the mobile shell with the developer switches. */
export function shellUrl(options: OpenOptions = {}): string {
  const q = new URLSearchParams({ mobile: '1', dev: '1' })
  if (options.skipOnboarding !== false) q.set('onboarding', 'skip')
  if (options.route) q.set('route', options.route)
  if (options.theme) q.set('theme', options.theme)
  if (options.fontScale) q.set('fs', String(options.fontScale))
  if (options.store) q.set('store', options.store)
  if (options.os) q.set('os', options.os)
  return `/?${q.toString()}`
}

export async function openShell(page: Page, options: OpenOptions = {}): Promise<void> {
  await page.goto(shellUrl(options))
  await page.getByTestId('m-app').waitFor()
  await screensLoaded(page)
}

/** Wait until no page or sheet shows its loading skeleton any more. */
export async function screensLoaded(page: Page): Promise<void> {
  await page.waitForFunction(() => !document.querySelector('[data-m-loading]'))
}

/** Collects console errors and uncaught errors of a page. Call `errors()` at the end of a test. */
export function watchErrors(page: Page): () => string[] {
  const found: string[] = []
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') found.push(message.text())
  })
  page.on('pageerror', (error) => found.push(String(error)))
  return () => found
}

export interface LayoutReport {
  /** Elements that stick out of the window sideways. */
  overflow: string[]
  /** Targets smaller than 44 by 44 px. */
  small: string[]
  /** The document itself scrolls sideways. */
  pageScrolls: boolean
}

/**
 * Measure what is on screen: nothing sticks out sideways, every target is at
 * least 44 by 44 px. Rows that scroll sideways on purpose (chip rows, the
 * status row of the composer) are left out of the overflow check, and so is
 * the inside of a code block, of a wide table and of anything that carries
 * `data-m-scroll-x`.
 */
export async function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(async () => {
    // Let a page slide in or a sheet come up before measuring. Endless ones (spinner, skeleton) are not waited for.
    // Twice, with a frame in between: an animation that starts when another one ends (press, then slide) is caught too.
    const settle = async () => {
      const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
    await settle()
    await settle()
    const SCROLLS_X = '.m-chat-code pre, .m-chat-table, [data-m-scroll-x]'
    const app = document.querySelector('[data-testid="m-app"], .m-app')
    const width = window.innerWidth
    const overflow: string[] = []
    const small: string[] = []
    if (!app) return { overflow: ['no m-app'], small, pageScrolls: false }
    const visible = (el: Element) => {
      const style = getComputedStyle(el)
      if (style.visibility === 'hidden' || style.display === 'none') return false
      return !el.closest('[data-m-hidden], [hidden]')
    }
    const name = (el: Element) => {
      const text = (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32)
      return `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${text}"`
    }
    app.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !visible(el)) return
      if (el.closest('.m-chips, .m-composer-status, .m-sr')) return
      // A code block, a wide table and anything marked data-m-scroll-x scroll sideways on purpose (DESIGN.md C2.22):
      // the box itself has to fit, what is inside it may be wider.
      if (el.closest(SCROLLS_X) && !el.matches(SCROLLS_X)) return
      if (r.right > width + 1 || r.left < -1) overflow.push(`${name(el)} ${Math.round(r.left)}..${Math.round(r.right)}`)
    })
    app.querySelectorAll('button, [role="radio"], [role="switch"], [role="tab"], input, textarea').forEach((el) => {
      const r = el.getBoundingClientRect()
      if (!r.width || !visible(el)) return
      if (r.height < 43.5 || r.width < 43.5) small.push(`${name(el)} ${Math.round(r.width)}x${Math.round(r.height)}`)
    })
    return {
      overflow: overflow.slice(0, 8),
      small: small.slice(0, 8),
      pageScrolls: document.documentElement.scrollWidth > width + 1,
    }
  })
}

/**
 * Draw the text as an Android WebView with a text zoom does: every text is
 * larger by `zoom`, the root size and with it a rem of LENGTH stay where they
 * are. The font switch of the address (`fs`) cannot show this, it makes the
 * root larger, which is the way of iOS. Here the browser enlarges the text
 * itself (text-size-adjust, which the phone emulation of the project turns
 * on), the shell measures it as it does on a phone (ui/text-zoom.ts) and
 * sets --m-zoom. Resolves when the shell has measured the zoom.
 */
export async function androidTextZoom(page: Page, zoom: number = 2): Promise<void> {
  const percent = `${Math.round(zoom * 100)}%`
  await page.addStyleTag({ content: `html{-webkit-text-size-adjust:${percent} !important;text-size-adjust:${percent} !important}` })
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')))
  await page.waitForFunction((want) => document.documentElement.style.getPropertyValue('--m-zoom') === want, String(zoom))
}

/**
 * Symbols that something cuts: every ring and every icon on screen has to lie
 * inside each ancestor that hides what leaves it. An ancestor that scrolls in
 * a direction is left out for that direction (what is outside can be reached),
 * and so is anything that is hidden on purpose. A ring turns, so its drawn
 * circle is measured, not the box around the turned square.
 */
export async function clippedSymbols(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = []
    const app = document.querySelector('[data-testid="m-app"], .m-app')
    if (!app) return ['no m-app']
    const cuts = (v: string) => v === 'hidden' || v === 'clip'
    app.querySelectorAll<HTMLElement | SVGElement>('.m-ring, svg').forEach((el) => {
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden' || el.closest('[data-m-hidden], [hidden], .m-sr, [aria-hidden="true"]:not(.m-ring):not(svg)')) return
      const box = el.getBoundingClientRect()
      if (!box.width || !box.height) return
      let r = { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
      if (el.matches('.m-ring')) {
        const half = (parseFloat(style.width) || box.width) / 2
        const cx = (box.left + box.right) / 2
        const cy = (box.top + box.bottom) / 2
        r = { left: cx - half, right: cx + half, top: cy - half, bottom: cy + half }
      }
      // From a scrolling ancestor on, what lies outside in that direction is a matter of scrolling, not of cutting.
      let scrollsX = false
      let scrollsY = false
      const scrolls = (v: string) => v === 'auto' || v === 'scroll'
      for (let a = el.parentElement; a && a !== app.parentElement; a = a.parentElement) {
        const s = getComputedStyle(a)
        const c = a.getBoundingClientRect()
        const name = `${el.matches('.m-ring') ? 'ring' : 'icon'} in ${a.tagName.toLowerCase()}.${String(a.className).split(' ')[0]}`
        if (!scrollsX && cuts(s.overflowX) && (r.left < c.left - 0.5 || r.right > c.right + 0.5)) out.push(`${name} sideways ${Math.round(r.left)}..${Math.round(r.right)} of ${Math.round(c.left)}..${Math.round(c.right)}`)
        if (!scrollsY && cuts(s.overflowY) && (r.top < c.top - 0.5 || r.bottom > c.bottom + 0.5)) out.push(`${name} upright ${Math.round(r.top)}..${Math.round(r.bottom)} of ${Math.round(c.top)}..${Math.round(c.bottom)}`)
        if (scrolls(s.overflowX)) scrollsX = true
        if (scrolls(s.overflowY)) scrollsY = true
      }
    })
    return [...new Set(out)].slice(0, 12)
  })
}

/** What measureLayout answers when nothing sticks out, nothing is too small and the page does not scroll sideways. */
export const CLEAN_LAYOUT: LayoutReport = { overflow: [], small: [], pageScrolls: false }

/** The page of the stack that is on top and not on its way out. Two pages stay mounted, so a test looks inside this one. */
export function topPage(page: Page) {
  return page.locator('.m-stack > .m-page:not([data-m-hidden]):not([data-m-exit])')
}

/**
 * How many lines a text takes, and whether any word in it is torn: a run of
 * letters that the browser broke without a break point. A word that breaks
 * at one of the break points of ui/hyphenate.tsx is not torn, it shows a
 * hyphen there.
 */
export async function textLines(page: Page, selector: string): Promise<{ lines: number; torn: string[]; text: string }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return { lines: 0, torn: [`no element for ${sel}`], text: '' }
    const tops = new Set<number>()
    const torn: string[] = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? ''
      for (const match of text.matchAll(/\S+/g)) {
        const range = document.createRange()
        range.setStart(node, match.index)
        range.setEnd(node, match.index + match[0].length)
        const rects = [...range.getClientRects()].filter((r) => r.width > 0)
        const own = new Set(rects.map((r) => Math.round(r.top)))
        for (const top of own) tops.add(top)
        if (own.size > 1) torn.push(match[0])
      }
    }
    return { lines: tops.size, torn, text: el.textContent ?? '' }
  }, selector)
}

/** The address of the network probe in the native app (resilience/useOnline.ts): the front page of the cloud, with a time. */
export const CLOUD_PROBE = /^https:\/\/lu-labs\.ai\/\?t=\d+$/

/**
 * A spec that fakes the native bridge makes the app probe the network at the
 * cloud of LU instead of at its own server. Answer that probe in the page, so
 * no test run leaves the machine. Call before the first goto.
 */
export async function answerCloudProbe(page: Page): Promise<void> {
  await page.route(CLOUD_PROBE, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '' }))
}

/** The store presets "play" and "appstore" ask for the age first (policy/AgeGate). Answer once, as an adult. Call before the first goto. */
export async function declareAdult(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem('lu-mobile-age', 'adult'))
}
