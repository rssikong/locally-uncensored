/**
 * Little content stands in the middle (MOBILE-ZIEL.md 3.5, round 20).
 *
 * A page that shows only a hint, an empty state or one action has it in the
 * middle of the free area, not at the top with the room below it. The rule is
 * in the kit (styles/components.css, "Little content stands in the middle":
 * data-m-sparse on the block, EmptyState and ErrorState carry it). This file
 * holds it for every state a browser can reach without a backend:
 *
 *  - at 390x844, 360x640 and 320x568 the block sits in the middle of its free
 *    area, 12 percent of that area as tolerance,
 *  - on its side and at 200 percent text the same holds while the block fits;
 *    where it does not, it starts at the top of the free area and the page
 *    scrolls to its end, so nothing is cut at either edge.
 *
 * The free area is what the kit shares out: from the lower edge of what stands
 * above the block (a segmented control, a row of chips, a notice) to the upper
 * edge of what stands below it (a footnote, a footer at the end of the
 * content), inside the scrolling body between header and footer, tab bar or
 * composer.
 */
import { expect, test, type Browser, type Page, type TestInfo } from '@playwright/test'
import { openShell, screensLoaded, topPage } from './support'

const PORTRAIT = [
  { name: '390x844', width: 390, height: 844 },
  { name: '360x640', width: 360, height: 640 },
  { name: '320x568', width: 320, height: 568 },
] as const

interface State {
  name: string
  /** Route on top of the stack. Without it the shell starts in the new chat. */
  route?: string
  /** Taps after the start, by test id. */
  taps?: readonly string[]
  /** The block that has to stand in the middle, inside the page on top. Default: the first marked one. */
  block?: string
  /** Under this height of the window the block is higher than the room (measured): there it starts at the top and scrolls. */
  tallUnder?: number
}

const ROOT = ['m-page-back'] as const

/** Every state with little content that opens in a browser without an account, a model or a desktop. */
const STATES: readonly State[] = [
  // The two David named.
  { name: 'new chat before the first message', route: '/chat/new', block: '[data-testid="m-chat-empty"]' },
  { name: 'remote, not paired', taps: [...ROOT, 'm-chats-segment-remote'], block: '[data-testid="m-remote-middle"]', tallUnder: 700 },
  { name: 'remote, address and passcode', route: '/remote/connect', block: '.m-remote-form', tallUnder: 600 },
  { name: 'remote, no scanner', route: '/remote/scan' },
  { name: 'remote chat that is gone', route: '/remote/chat/none' },
  // Chat.
  { name: 'no chats yet', taps: ROOT, block: '[data-testid="m-chats-empty"]' },
  { name: 'chat that is gone', route: '/chat/none' },
  { name: 'message to edit that is gone', route: '/chat/none/message/none/edit' },
  { name: 'message text that is gone', route: '/chat/none/message/none/text' },
  { name: 'documents of a chat that is gone', route: '/chat/none/documents' },
  { name: 'tasks, none', route: '/chat/none/tasks' },
  { name: 'compare, nothing asked', route: '/chat/none/compare' },
  { name: 'preview that is gone', route: '/chat/none/preview/none' },
  { name: 'group of a chat that is gone', route: '/chat/none/group' },
  // Create.
  { name: 'create, signed out', taps: [...ROOT, 'm-nav-create'], block: '[data-testid="m-create-gate"]' },
  { name: 'gallery, empty', route: '/create/gallery' },
  { name: 'gallery to pick from, empty', route: '/create/gallery/pick/source' },
  { name: 'mask without a picture', route: '/create/mask' },
  { name: 'characters, signed out', route: '/create/characters' },
  { name: 'presets, signed out', route: '/create/presets' },
  { name: 'preset that is gone', route: '/create/presets/none' },
  { name: 'batch, nothing chosen', route: '/create/batch' },
  // Models.
  { name: 'downloads, none', route: '/models/downloads' },
  { name: 'benchmark without a model', route: '/models/benchmark' },
  { name: 'model that is gone', route: '/models/none' },
  // Settings: pages that are gone, and the one page that is a single action.
  { name: 'provider that is gone', route: '/settings/providers/none' },
  { name: 'persona that is gone', route: '/settings/personas/none' },
  { name: 'memory entry that is gone', route: '/settings/memory/none' },
  { name: 'workflow that is gone', route: '/settings/workflows/none' },
  { name: 'workflow step that is gone', route: '/settings/workflows/none/step/none' },
  { name: 'import chats, pick a file', route: '/settings/data/import' },
  // Onboarding.
  { name: 'welcome', route: '/welcome', block: '[data-testid="m-onboarding-intro"]' },
  { name: 'setup, documents', route: '/setup/documents' },
  { name: 'setup, done', route: '/setup/done' },
]

/**
 * Every route of the shell (nav/routes.ts and the strands), with a made up id where one is asked for. The four tab
 * roots are reached by their tabs. A unit test would not do: what counts is what stands on the screen.
 */
const ALL_ROUTES: readonly string[] = [
  '/settings/workflows/none/step/none', '/welcome', '/setup/model', '/setup/documents', '/setup/done', '/chat/none', '/chat/none/file/none',
  '/chat/none/message/none/edit', '/chat/none/message/none/text', '/chat/none/documents', '/chat/none/compare', '/chat/none/tasks',
  '/chat/none/preview/none', '/chat/none/group', '/remote/connect', '/remote/scan', '/remote/chat/none', '/remote/help', '/create/gallery',
  '/create/item/none', '/create/mask', '/create/characters', '/create/characters/new', '/create/presets', '/create/showcase', '/create/batch',
  '/models/downloads', '/models/benchmark', '/models/none', '/settings/engine', '/settings/storage', '/settings/account', '/cloud',
  '/settings/appearance', '/settings/chat', '/settings/voice', '/settings/providers', '/settings/providers/none', '/settings/remote',
  '/settings/data', '/settings/data/import', '/settings/privacy', '/settings/content-policy', '/settings/troubleshooting', '/settings/about',
  '/whats-new', '/settings/personas', '/settings/personas/none', '/settings/memory', '/settings/memory/none', '/settings/agent', '/settings/search',
  '/settings/workflows', '/settings/workflows/none', '/dev/ui', '/dev/routes', '/dev/frame', '/dev/composer', '/dev/viewer', '/create/styles',
  '/create/presets/none', '/create/gallery/pick/none', '/settings/engine/advanced',
]
const TABS = ['m-nav-chat', 'm-nav-create', 'm-nav-models', 'm-nav-settings'] as const

/** The name of the product in both spellings: what must not stand alone under the mark. */
const NAMES = ['LU', 'Locally Uncensored']

/** Marks on the page on top whose next neighbour is nothing but the name, and marks without an accessible name where they stand alone. */
async function wordmarks(page: Page): Promise<string[]> {
  return page.evaluate((names) => {
    const out: string[] = []
    document.querySelectorAll('.m-mono-mark, img[src*="LU-monogram"]').forEach((mark) => {
      if (mark.closest('[data-m-hidden], [hidden]')) return
      for (const near of [mark.nextElementSibling, mark.parentElement?.nextElementSibling]) {
        const text = (near?.textContent ?? '').trim()
        if (near && names.includes(text)) out.push(`"${text}" under the mark in ${String(mark.parentElement?.className || mark.parentElement?.tagName)}`)
      }
    })
    return out
  }, NAMES)
}

interface Measure {
  found: boolean
  /** Upper and lower edge of the free area and of the block, in px of the window. */
  freeTop: number
  freeBottom: number
  top: number
  bottom: number
  /** The body scrolls. */
  scrolls: boolean
  /** Edges of the scrolling body. */
  bodyTop: number
  bodyBottom: number
  /** Lower edge of the block with the body scrolled to its end. */
  bottomAtEnd: number
}

async function settle(page: Page): Promise<void> {
  await screensLoaded(page)
  await page.evaluate(async () => {
    // No keyboard in a browser, and a field that took the focus scrolls its page: measured without.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    await document.fonts.ready
    for (let i = 0; i < 2; i++) {
      const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
      await Promise.all(finite.map((a) => a.finished.catch(() => undefined)))
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    }
  })
}

async function open(page: Page, state: State, fontScale?: number): Promise<void> {
  await openShell(page, { route: state.route, fontScale })
  for (const id of state.taps ?? []) {
    // The tab bar is not part of a page; everything else is looked for in the page on top (two pages stay mounted).
    const target = id.startsWith('m-nav-') ? page.getByTestId(id) : topPage(page).getByTestId(id)
    await target.first().tap({ timeout: 15_000 })
    await settle(page)
  }
  await settle(page)
}

async function measure(page: Page, state: State): Promise<Measure> {
  const selector = state.block ?? '[data-m-sparse]'
  const block = topPage(page).locator(selector).first()
  await block.waitFor({ state: 'attached', timeout: 10_000 }).catch(() => undefined)
  return topPage(page).evaluate((root, sel) => {
    const none = { found: false, freeTop: 0, freeBottom: 0, top: 0, bottom: 0, scrolls: false, bodyTop: 0, bodyBottom: 0, bottomAtEnd: 0 }
    const el = root.querySelector(sel)
    const body = el?.closest('.m-body')
    if (!el || !body) return none
    body.scrollTop = 0
    const shown = (node: Element) => {
      const style = getComputedStyle(node)
      const box = node.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && style.position !== 'absolute' && style.position !== 'fixed' && box.height > 0 && !node.matches('.m-sr')
    }
    const b = body.getBoundingClientRect()
    let freeTop = b.top
    let freeBottom = b.bottom
    // What stands above and below the block, at every level up to the scrolling body, is not free.
    for (let node: Element = el; node !== body && node.parentElement; node = node.parentElement) {
      for (let prev = node.previousElementSibling; prev; prev = prev.previousElementSibling) {
        if (shown(prev)) freeTop = Math.max(freeTop, prev.getBoundingClientRect().bottom)
      }
      for (let next = node.nextElementSibling; next; next = next.nextElementSibling) {
        if (shown(next)) freeBottom = Math.min(freeBottom, next.getBoundingClientRect().top)
      }
    }
    const r = el.getBoundingClientRect()
    const scrolls = body.scrollHeight > body.clientHeight + 1
    body.scrollTop = body.scrollHeight
    const bottomAtEnd = el.getBoundingClientRect().bottom
    body.scrollTop = 0
    return { found: true, freeTop, freeBottom, top: r.top, bottom: r.bottom, scrolls, bodyTop: b.top, bodyBottom: b.bottom, bottomAtEnd }
  }, selector)
}

/** What is wrong with a measured state, or null. `mustFit`: the block has to fit and stand in the middle. */
function verdict(m: Measure, mustFit: boolean): string | null {
  if (!m.found) return 'the block was not found'
  const px = (n: number) => Math.round(n)
  if (!m.scrolls) {
    const free = m.freeBottom - m.freeTop
    const off = (m.top + m.bottom) / 2 - (m.freeTop + m.freeBottom) / 2
    if (m.top < m.freeTop - 1) return `starts ${px(m.freeTop - m.top)} px above its free area`
    if (m.bottom > m.freeBottom + 1) return `ends ${px(m.bottom - m.freeBottom)} px below its free area`
    if (Math.abs(off) > free * 0.12) return `is ${px(Math.abs(off))} px ${off < 0 ? 'above' : 'below'} the middle of ${px(free)} px (room above ${px(m.top - m.freeTop)}, below ${px(m.freeBottom - m.bottom)})`
    return null
  }
  if (mustFit) return `does not fit: the page scrolls (block ${px(m.bottom - m.top)} px, free ${px(m.freeBottom - m.freeTop)} px)`
  // Higher than the room: from the top, and the end can be reached.
  if (m.top < m.bodyTop - 1) return `its start is cut: ${px(m.bodyTop - m.top)} px above the body`
  if (m.bottomAtEnd > m.bodyBottom + 1) return `its end cannot be reached: ${px(m.bottomAtEnd - m.bodyBottom)} px below the body`
  return null
}

interface Run {
  browser: Browser
  info: TestInfo
  width: number
  height: number
  /** The block has to fit and stand in the middle. Where not, it may also start at the top and scroll. */
  mustFit: (state: State) => boolean
  fontScale?: number
}

/** Every state in a window of its own: the shell remembers its stack and its tab, and a state must not start in the one before. */
async function run({ browser, info, width, height, mustFit, fontScale }: Run): Promise<string[]> {
  const wrong: string[] = []
  for (const state of STATES) {
    const context = await browser.newContext({ ...info.project.use, viewport: { width, height } })
    const page = await context.newPage()
    try {
      await open(page, state, fontScale)
      const problem = verdict(await measure(page, state), mustFit(state))
      if (problem) wrong.push(`${state.name}: ${problem}`)
    } catch (error) {
      wrong.push(`${state.name}: ${String(error).split('\n')[0]}`)
    } finally {
      await context.close()
    }
  }
  return wrong
}

test.describe('little content stands in the middle', () => {
  for (const size of PORTRAIT) {
    test(`${size.name}: every sparse state is in the middle of its free area`, async ({ browser }, info) => {
      test.setTimeout(300_000)
      // The explanation of Remote with its three steps and three buttons, and the form with two fields and two notes, are
      // higher than the room of a small phone (490 px of 457 at 360x640): there they start at the top.
      const mustFit = (state: State) => !(state.tallUnder && size.height < state.tallUnder)
      expect(await run({ browser, info, width: size.width, height: size.height, mustFit })).toEqual([])
    })
  }

  test('844x390 on its side: in the middle where it fits, from the top where it does not', async ({ browser }, info) => {
    test.setTimeout(300_000)
    expect(await run({ browser, info, width: 844, height: 390, mustFit: () => false })).toEqual([])
  })

  test('320x568 at 200 percent text: nothing is cut, what does not fit starts at the top and scrolls', async ({ browser }, info) => {
    test.setTimeout(300_000)
    expect(await run({ browser, info, width: 320, height: 568, mustFit: () => false, fontScale: 200 })).toEqual([])
  })

  test('keyboard open: the greeting of a new chat is in the middle of the area above the keyboard', async ({ page }) => {
    // The window loses the height of the keyboard while the field has the focus, as on Android with adjustResize
    // (platform/keyboard.ts); the shell is as high as what is left.
    const state = STATES[0]
    await page.setViewportSize({ width: 390, height: 844 })
    await openShell(page, { route: state.route })
    await topPage(page).getByTestId('m-chat-input').focus()
    await page.setViewportSize({ width: 390, height: 844 - 336 })
    await expect(page.locator('html')).toHaveClass(/m-kb-open/)
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
    const m = await measure(page, state)
    expect(verdict(m, false)).toBeNull()
    // Above the keyboard and under the header: inside the body, which ends over the composer.
    expect(m.top).toBeGreaterThanOrEqual(m.bodyTop - 1)
    expect(m.scrolls ? m.bottomAtEnd : m.bottom).toBeLessThanOrEqual(m.bodyBottom + 1)
    expect(m.bodyBottom).toBeLessThanOrEqual(844 - 336)
  })

  test('the mark stands alone: no "LU" and no product name as a line of its own under it, on any route', async ({ browser }, info) => {
    test.setTimeout(300_000)
    const found: string[] = []
    // A window of its own per route, as above: the shell remembers its stack from one start to the next.
    const fresh = async (work: (page: Page) => Promise<void>) => {
      const context = await browser.newContext({ ...info.project.use })
      try {
        await work(await context.newPage())
      } finally {
        await context.close()
      }
    }
    for (const route of ALL_ROUTES) {
      await fresh(async (page) => {
        await openShell(page, { route })
        await settle(page)
        for (const hit of await wordmarks(page)) found.push(`${route}: ${hit}`)
      })
    }
    await fresh(async (page) => {
      await openShell(page)
      await topPage(page).getByTestId('m-page-back').tap()
      for (const tab of TABS) {
        await page.getByTestId(tab).tap()
        await settle(page)
        for (const hit of await wordmarks(page)) found.push(`${tab}: ${hit}`)
      }
    })
    expect(found).toEqual([])
    // A screen reader still hears whose mark it is where the mark is all there is of the name.
    for (const route of ['/welcome', '/settings/about']) {
      await fresh(async (page) => {
        await openShell(page, { route })
        await expect(topPage(page).getByRole('img', { name: 'LU', exact: true }), route).toHaveCount(1)
      })
    }
  })

  test('a page of settings with a few rows starts at the top', async ({ page }) => {
    // Lists and forms keep the convention of a phone: they begin under the header.
    for (const route of ['/settings/appearance', '/settings/remote', '/settings/content-policy']) {
      await openShell(page, { route })
      await settle(page)
      const gap = await topPage(page).evaluate((root) => {
        const body = root.querySelector('.m-body')
        const first = body?.querySelector('.m-body-inner > *')
        return body && first ? first.getBoundingClientRect().top - body.getBoundingClientRect().top : -1
      })
      expect(gap, route).toBeGreaterThanOrEqual(0)
      expect(gap, route).toBeLessThan(40)
      expect(await topPage(page).locator('[data-m-sparse]').count(), route).toBe(0)
    }
  })
})
