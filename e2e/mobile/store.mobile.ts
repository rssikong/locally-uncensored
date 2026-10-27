/**
 * The store building blocks (src/mobile/policy), one smoke run per preset:
 * the age question, the consent to LU Cloud and the report sheet.
 * No report leaves the browser: this build has no report address.
 */
import { expect, test, type Page } from '@playwright/test'
import { androidTextZoom, measureLayout, openShell, screensLoaded, shellUrl, watchErrors } from './support'

test.use({ hasTouch: true, viewport: { width: 320, height: 568 } })

const CLEAN = { overflow: [], small: [], pageScrolls: false }

/** Every request that is not the developer server itself. */
function watchOutside(page: Page): () => string[] {
  const outside: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1' && request.method() !== 'GET') outside.push(`${request.method()} ${url.origin}${url.pathname}`)
  })
  return () => outside
}

async function openScaffold(page: Page, store: 'open' | 'play' | 'appstore'): Promise<void> {
  await openShell(page, { route: '/dev/ui', store })
  await page.getByTestId('m-dev-ui-policy').scrollIntoViewIfNeeded()
}

test.describe('store preset open', () => {
  test('starts without an age question and says which preset it is', async ({ page }) => {
    const errors = watchErrors(page)
    await openScaffold(page, 'open')
    await expect(page.getByTestId('m-age-gate')).toHaveCount(0)
    await expect(page.getByTestId('m-dev-ui-policy')).toContainText('Store preset: open. Age gate none, content levels all, purchase links.')
    expect(errors()).toEqual([])
  })

  test('a report needs a reason, is saved on the phone and says so honestly', async ({ page }) => {
    const errors = watchErrors(page)
    const outside = watchOutside(page)
    await openScaffold(page, 'open')
    await page.getByTestId('m-dev-ui-report').tap()
    const sheet = page.getByTestId('m-sheet-report')
    await expect(sheet).toBeVisible()
    await screensLoaded(page)
    await expect(sheet).toContainText('Report this content')
    await expect(page.getByTestId('m-report-intro')).toContainText('made on this phone')
    await expect(page.getByTestId('m-report-intro')).toContainText('saved on this phone and sent once the report service is available')
    await expect(page.getByTestId('m-report-intro')).not.toContainText('goes to the LU team')
    const send = page.getByTestId('m-report-send')
    await expect(send).toBeDisabled()
    await expect(send).toContainText('Pick what is wrong first')
    expect(await measureLayout(page)).toEqual(CLEAN)

    await page.getByTestId('m-report-reason-hate').tap()
    await expect(page.getByTestId('m-report-reason-hate')).toHaveAttribute('aria-checked', 'true')
    await page.getByTestId('m-report-note').fill('It insults a group of people.')
    await expect(send).toBeEnabled()
    await send.tap()
    // No report service in this build: the sheet and the toast say what really happens (M4).
    await expect(page.getByTestId('m-toast-report-queued')).toContainText('Report saved on this phone. It is sent once the report service is available.')
    await expect(sheet).toHaveCount(0)

    const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('lu-mobile-report-queue') ?? '[]') as Array<Record<string, unknown>>)
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({ kind: 'message', contentId: 'dev-message', model: 'Gemma 3 4B', source: 'local', reason: 'hate', note: 'It insults a group of people.', excerpt: 'An answer the user wants to report.', preset: 'open' })
    expect(outside()).toEqual([])
    expect(errors()).toEqual([])
  })

  test('the reported text can be left out', async ({ page }) => {
    await openScaffold(page, 'open')
    await page.getByTestId('m-dev-ui-report').tap()
    await screensLoaded(page)
    await page.getByTestId('m-report-reason-other').tap()
    await page.getByTestId('m-report-include-text').tap()
    await page.getByTestId('m-report-send').tap()
    await expect(page.getByTestId('m-toast-report-queued')).toBeVisible()
    const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('lu-mobile-report-queue') ?? '[]') as Array<Record<string, unknown>>)
    expect(queue[0]).toMatchObject({ reason: 'other', excerpt: '' })
  })

  test('LU Cloud is asked for once: no, then yes, then never again until it is taken back', async ({ page }) => {
    const errors = watchErrors(page)
    await openScaffold(page, 'open')
    const policy = page.getByTestId('m-dev-ui-policy')
    const result = page.getByTestId('m-dev-ui-scaffold-result')
    await expect(policy).toContainText('Cloud consent not given')

    await page.getByTestId('m-dev-ui-consent').tap()
    const sheet = page.getByTestId('m-sheet-ai-consent')
    await expect(sheet).toBeVisible()
    await screensLoaded(page)
    await expect(page.getByTestId('m-consent-text')).toContainText('passes them to third-party AI providers that run its models')
    expect(await measureLayout(page)).toEqual(CLEAN)
    await page.getByTestId('m-consent-decline').tap()
    await expect(result).toHaveText('Cloud consent declined')
    await expect(policy).toContainText('Cloud consent not given')

    // Closing the sheet with back is a no as well.
    await page.getByTestId('m-dev-ui-consent').tap()
    await expect(sheet).toBeVisible()
    await page.goBack()
    await expect(sheet).toHaveCount(0)
    await expect(policy).toContainText('Cloud consent not given')

    await page.getByTestId('m-dev-ui-consent').tap()
    await page.getByTestId('m-consent-agree').tap()
    await expect(result).toHaveText('Cloud consent given')
    await expect(policy).toContainText('Cloud consent given')

    await page.reload()
    await page.getByTestId('m-app').waitFor()
    await screensLoaded(page)
    // The reload opened the catalogue on top of the restored one; the visible page is the one to use.
    const top = page.locator('.m-page:not([data-m-hidden])')
    await top.getByTestId('m-dev-ui-consent').scrollIntoViewIfNeeded()
    await top.getByTestId('m-dev-ui-consent').tap()
    await expect(top.getByTestId('m-dev-ui-scaffold-result')).toHaveText('Cloud consent given')
    await expect(page.getByTestId('m-sheet-ai-consent')).toHaveCount(0)

    await top.getByTestId('m-dev-ui-consent-revoke').tap()
    await expect(top.getByTestId('m-dev-ui-policy')).toContainText('Cloud consent not given')
    await top.getByTestId('m-dev-ui-consent').tap()
    await expect(page.getByTestId('m-sheet-ai-consent')).toBeVisible()
    expect(errors()).toEqual([])
  })

  // Round 30, H1, Android at 320x568 dp with text at 1.0: the link to the privacy policy lay half under the
  // footer of the sheet, and a tap on its middle hit the footer. Between the bars of Android the WebView there
  // is about 480 px high (the text box of the sheet measured 242 px), so this runs at that height.
  for (const height of [480, 568]) {
    test(`the link to the privacy policy is whole and on top without scrolling, 320x${height}`, async ({ page }) => {
      await page.setViewportSize({ width: 320, height })
      await openScaffold(page, 'open')
      await page.getByTestId('m-dev-ui-consent').tap()
      const sheet = page.getByTestId('m-sheet-ai-consent')
      await expect(sheet).toBeVisible()
      await screensLoaded(page)
      // Measured once the sheet stands still: on its way in it is moved down by its animation.
      await expect(sheet).not.toHaveAttribute('data-m-settling')
      const link = page.getByTestId('m-consent-privacy')
      const seen = await link.evaluate((el) => {
        const r = el.getBoundingClientRect()
        const on = (y: number) => {
          const hit = document.elementFromPoint(r.left + r.width / 2, y)
          return !!hit && el.contains(hit)
        }
        return { inView: r.top >= 0 && r.bottom <= window.innerHeight, top: on(r.top + 2), middle: on(r.top + r.height / 2), bottom: on(r.bottom - 2) }
      })
      expect(seen).toEqual({ inView: true, top: true, middle: true, bottom: true })
      // Agree and Not now stay whole as well.
      for (const id of ['m-consent-agree', 'm-consent-decline']) await expect(page.getByTestId(id)).toBeInViewport({ ratio: 1 })
      expect(await measureLayout(page)).toEqual(CLEAN)
    })
  }

  // Round 35, E1 (iOS check of package 15): on its side at text 1.0 the top of the footer with the link
  // was on screen, both answers under the edge, and no round button pointed to them.
  for (const view of [
    { name: 'iPhone 17 on its side', width: 874, height: 402 },
    { name: 'iPhone SE on its side', width: 667, height: 375 },
    { name: 'small on its side', width: 568, height: 320 },
  ]) {
    test(`both answers are on screen or the round button leads to them, ${view.name}`, async ({ page }) => {
      await page.setViewportSize({ width: view.width, height: view.height })
      await openScaffold(page, 'open')
      await page.getByTestId('m-dev-ui-consent').tap()
      const sheet = page.getByTestId('m-sheet-ai-consent')
      await expect(sheet).toBeVisible()
      await screensLoaded(page)
      await expect(sheet).not.toHaveAttribute('data-m-settling')
      const answers = [page.getByTestId('m-consent-agree'), page.getByTestId('m-consent-decline')]
      const whole = async () => {
        const inView = await Promise.all(
          answers.map((a) => a.evaluate((el) => {
            const r = el.getBoundingClientRect()
            const box = el.closest('.m-sheet-body')?.getBoundingClientRect()
            const bottom = Math.min(window.innerHeight, box ? box.bottom : window.innerHeight)
            return r.top >= 0 && r.bottom <= bottom + 0.5
          })),
        )
        return inView.every(Boolean)
      }
      const jump = page.getByTestId('m-foot-jump')
      if (!(await whole())) {
        await expect(jump).toBeInViewport({ ratio: 1 })
        await jump.tap()
        await expect.poll(whole).toBe(true)
      }
      await expect(jump).toHaveCount(0)
      for (const a of answers) await expect(a).toBeInViewport({ ratio: 1 })
      expect(await measureLayout(page)).toEqual(CLEAN)
    })
  }
})

// Check Android package 16, H4: 320x568 on its side at the text zoom of Android 2.0 (between the bars of the system
// the WebView had 511x272). After the round button the privacy link lay under the standing title of the sheet: the
// button rolled to the very end, and the footer is higher than the box it scrolls in. The button now stops with the
// top of the footer just under the title; while the answers are still below the edge it stays, and the next tap
// brings them. 568x320 and 480x272 on either side of it.
test.describe('the consent sheet on its side at the text zoom of Android 2.0', () => {
  for (const view of [
    { width: 511, height: 272 },
    { width: 480, height: 272 },
    { width: 568, height: 320 },
  ]) {
    test(`the round button shows the privacy link below the title, and then the answers, ${view.width}x${view.height}`, async ({ page }) => {
      await page.setViewportSize(view)
      await openShell(page, { route: '/dev/ui', store: 'open', os: 'android' })
      await androidTextZoom(page, 2)
      await page.getByTestId('m-dev-ui-policy').scrollIntoViewIfNeeded()
      await page.getByTestId('m-dev-ui-consent').tap()
      const sheet = page.getByTestId('m-sheet-ai-consent')
      await expect(sheet).toBeVisible()
      await screensLoaded(page)
      await expect(sheet).not.toHaveAttribute('data-m-settling')
      /** Whole inside the part of the text box that is seen, and its middle is reached (not the title above it). */
      const seen = (id: string) => page.getByTestId(id).evaluate((el) => {
        const r = el.getBoundingClientRect()
        const box = el.closest('.m-sheet-body')!.getBoundingClientRect()
        const bottom = Math.min(window.innerHeight, box.bottom)
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return r.top >= box.top - 0.5 && r.bottom <= bottom + 0.5 && !!hit && el.contains(hit)
      })
      const jump = page.getByTestId('m-foot-jump')
      // The scroll of the round button is smooth: wait until the box has stood still for a few polls, counted afresh each time.
      const settle = async () => {
        await page.evaluate(() => { const w = window as unknown as { __luLast?: number; __luSame?: number }; w.__luLast = undefined; w.__luSame = 0 })
        await page.waitForTimeout(100)
        await page.waitForFunction(() => {
          const box = document.querySelector('[data-testid="m-sheet-ai-consent"] .m-sheet-body')
          const w = window as unknown as { __luLast?: number; __luSame?: number }
          const now = box ? box.scrollTop : -1
          w.__luSame = w.__luLast === now ? (w.__luSame ?? 0) + 1 : 0
          w.__luLast = now
          return w.__luSame >= 3
        }, undefined, { polling: 100 })
      }
      await expect(jump).toBeInViewport({ ratio: 1 })
      await jump.tap()
      await settle()
      expect(await seen('m-consent-privacy'), 'the privacy link is whole under the title and reached').toBe(true)
      // The answers: whole now, or the button is still there and brings them.
      if (!((await seen('m-consent-agree')) && (await seen('m-consent-decline')))) {
        await expect(jump).toBeInViewport({ ratio: 1 })
        await jump.tap()
        await settle()
      }
      expect(await seen('m-consent-agree'), 'Agree and continue is whole and reached').toBe(true)
      expect(await seen('m-consent-decline'), 'Not now is whole and reached').toBe(true)
      await expect(jump).toHaveCount(0)
    })
  }
})

test.describe('store preset play', () => {
  test('asks for the age before anything else, yes lets the app in for good', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(shellUrl({ route: '/dev/ui', store: 'play' }))
    const gate = page.getByTestId('m-age-gate')
    await expect(gate).toBeVisible()
    await expect(gate).toContainText('Are you 18 or older?')
    await expect(page.getByTestId('m-app')).toHaveCount(0)
    await expect(page.getByRole('tablist')).toHaveCount(0)
    expect(await measureLayout(page)).toEqual(CLEAN)

    await page.getByTestId('m-age-yes').tap()
    await page.getByTestId('m-app').waitFor()
    await expect(gate).toHaveCount(0)
    await screensLoaded(page)
    await page.getByTestId('m-dev-ui-policy').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('m-dev-ui-policy')).toContainText('Store preset: play. Age gate declare-18, content levels no-off, purchase text-only.')
    expect(await page.evaluate(() => localStorage.getItem('lu-mobile-age'))).toBe('adult')

    await page.reload()
    await page.getByTestId('m-app').waitFor()
    await expect(page.getByTestId('m-age-gate')).toHaveCount(0)
    expect(errors()).toEqual([])
  })

  test('the age question comes before the onboarding too', async ({ page }) => {
    await page.goto(shellUrl({ skipOnboarding: false, store: 'play' }))
    await expect(page.getByTestId('m-age-ask')).toBeVisible()
    await expect(page.getByTestId('m-onboarding-screen')).toHaveCount(0)
    await page.getByTestId('m-age-yes').tap()
    await expect(page.getByTestId('m-onboarding-screen')).toBeVisible()
  })
})

test.describe('store preset appstore', () => {
  test('no leads to a quiet page that stays after a restart', async ({ page }) => {
    const errors = watchErrors(page)
    await page.goto(shellUrl({ route: '/dev/ui', store: 'appstore' }))
    await expect(page.getByTestId('m-age-ask')).toBeVisible()
    await expect(page.getByTestId('m-age-ask')).toContainText('Your answer is saved on this phone and stays on this device.')
    // "No" is asked a second time and saves nothing yet (round 10).
    await page.getByTestId('m-age-no').tap()
    const second = page.getByTestId('m-age-confirm')
    await expect(second).toContainText('You said you are under 18')
    await expect(second).toContainText('LU will stay closed on this device. Is that right?')
    await expect(page.getByTestId('m-age-confirm-back')).toHaveText('Go back')
    await expect(page.getByTestId('m-age-confirm-minor')).toHaveText('Yes, I am under 18')
    await expect(page.getByTestId('m-age-confirm-minor')).toHaveAttribute('data-m-risk', 'destructive')
    expect(await page.evaluate(() => localStorage.getItem('lu-mobile-age'))).toBeNull()
    expect(await measureLayout(page)).toEqual(CLEAN)
    // A restart in the middle of the doubt asks the first question again.
    await page.reload()
    await expect(page.getByTestId('m-age-ask')).toBeVisible()
    await page.getByTestId('m-age-no').tap()
    // "Go back" returns to the first question, still nothing saved.
    await page.getByTestId('m-age-confirm-back').tap()
    await expect(page.getByTestId('m-age-ask')).toBeVisible()
    await expect(page.getByTestId('m-age-confirm')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('lu-mobile-age'))).toBeNull()
    await page.getByTestId('m-age-no').tap()
    await page.getByTestId('m-age-confirm-minor').tap()
    const blocked = page.getByTestId('m-age-blocked')
    await expect(blocked).toContainText('LU is for adults')
    await expect(blocked).toContainText('You need to be 18 or older to use LU.')
    await expect(page.getByRole('button')).toHaveCount(0)
    await expect(page.getByTestId('m-app')).toHaveCount(0)
    expect(await measureLayout(page)).toEqual(CLEAN)

    await page.reload()
    await expect(page.getByTestId('m-age-blocked')).toBeVisible()
    await expect(page.getByTestId('m-app')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('lu-mobile-age'))).toBe('minor')
    expect(errors()).toEqual([])
  })

  test('after yes the preset shows its fixed filter and no purchase', async ({ page }) => {
    await page.goto(shellUrl({ route: '/dev/ui', store: 'appstore' }))
    await page.getByTestId('m-age-yes').tap()
    await page.getByTestId('m-app').waitFor()
    await screensLoaded(page)
    await page.getByTestId('m-dev-ui-policy').scrollIntoViewIfNeeded()
    await expect(page.getByTestId('m-dev-ui-policy')).toContainText('Store preset: appstore. Age gate declare-18, content levels fixed-filter, purchase none.')
  })
})

// ---------------------------------------------------------------------------
// Runde 2: every preset in every size. The three parts a store reviewer meets
// first (age question, report, consent) are measured and used to the end at a
// current phone, at the same phone with 200 percent text and at the smallest
// supported phone with 200 percent text.
// ---------------------------------------------------------------------------

const PRESETS = [
  { store: 'open', gate: false },
  { store: 'play', gate: true },
  { store: 'appstore', gate: true },
] as const

const VIEWS = [
  { name: '390x844', width: 390, height: 844, fontScale: 100 },
  { name: '390x844 at 200 percent', width: 390, height: 844, fontScale: 200 },
  { name: '320x568 at 200 percent', width: 320, height: 568, fontScale: 200 },
] as const

/** Scroll a target into sight and say whether all of it is inside the window and nothing lies on it. */
async function reachable(page: Page, testid: string): Promise<boolean> {
  const target = page.getByTestId(testid)
  await target.scrollIntoViewIfNeeded()
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const inside = r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight + 0.5 && r.right <= window.innerWidth + 0.5
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return inside && !!hit && (hit === el || el.contains(hit))
  })
}

/** Is all of the text of this element reachable: inside the window, or inside a box that scrolls to it. */
async function readable(page: Page, testid: string): Promise<boolean> {
  const target = page.getByTestId(testid)
  await target.scrollIntoViewIfNeeded()
  return target.evaluate((el) => {
    const r = el.getBoundingClientRect()
    if (r.width === 0 || r.height === 0) return false
    if (r.left < 0 || r.right > window.innerWidth + 0.5) return false
    if (r.top >= 0 && r.bottom <= window.innerHeight + 0.5) return true
    // Taller than the room it has is fine as long as a box around it scrolls.
    for (let box = el.parentElement; box; box = box.parentElement) {
      if (box.scrollHeight > box.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(box).overflowY)) return true
    }
    return false
  })
}

for (const preset of PRESETS) {
  for (const view of VIEWS) {
    test.describe(`store preset ${preset.store}, ${view.name}`, () => {
      test.use({ viewport: { width: view.width, height: view.height } })

      test('the age question fits, both answers are reachable, and no ends on a readable page', async ({ page }) => {
        const errors = watchErrors(page)
        await page.goto(shellUrl({ route: '/dev/ui', store: preset.store, fontScale: view.fontScale }))
        if (!preset.gate) {
          await page.getByTestId('m-app').waitFor()
          await expect(page.getByTestId('m-age-gate')).toHaveCount(0)
          expect(errors()).toEqual([])
          return
        }
        await expect(page.getByTestId('m-age-ask')).toBeVisible()
        await expect(page.getByTestId('m-app')).toHaveCount(0)
        // The text size the phone asks for is in place before the question is.
        expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(16 * (view.fontScale / 100), 0)
        expect(await measureLayout(page)).toEqual(CLEAN)
        expect(await readable(page, 'm-age-ask')).toBe(true)
        // The top of the question is not cut off: scrolled to the start, its first line is inside the window.
        const top = await page.getByTestId('m-age-ask').evaluate((el) => {
          for (let box = el.parentElement; box; box = box.parentElement) box.scrollTop = 0
          return el.getBoundingClientRect().top
        })
        expect(top).toBeGreaterThanOrEqual(0)
        expect(await reachable(page, 'm-age-yes')).toBe(true)
        expect(await reachable(page, 'm-age-no')).toBe(true)

        await page.getByTestId('m-age-no').tap()
        // The second question fits as well, and both of its answers are reachable.
        await expect(page.getByTestId('m-age-confirm')).toBeVisible()
        expect(await measureLayout(page)).toEqual(CLEAN)
        expect(await readable(page, 'm-age-confirm')).toBe(true)
        expect(await reachable(page, 'm-age-confirm-back')).toBe(true)
        expect(await reachable(page, 'm-age-confirm-minor')).toBe(true)
        await page.getByTestId('m-age-confirm-minor').tap()
        const blocked = page.getByTestId('m-age-blocked')
        await expect(blocked).toContainText('You need to be 18 or older to use LU.')
        await expect(page.getByRole('button')).toHaveCount(0)
        expect(await measureLayout(page)).toEqual(CLEAN)
        expect(await readable(page, 'm-age-blocked')).toBe(true)

        // The other answer, from a fresh start.
        await page.evaluate(() => localStorage.removeItem('lu-mobile-age'))
        await page.reload()
        await expect(page.getByTestId('m-age-ask')).toBeVisible()
        expect(await reachable(page, 'm-age-yes')).toBe(true)
        await page.getByTestId('m-age-yes').tap()
        await page.getByTestId('m-app').waitFor()
        await expect(page.getByTestId('m-age-gate')).toHaveCount(0)
        expect(errors()).toEqual([])
      })

      test('the report sheet fits and can be filled in and sent to the end', async ({ page }) => {
        const errors = watchErrors(page)
        const outside = watchOutside(page)
        await page.addInitScript(() => localStorage.setItem('lu-mobile-age', 'adult'))
        await openShell(page, { route: '/dev/ui', store: preset.store, fontScale: view.fontScale })
        await expect(page.getByTestId('m-dev-ui-policy')).toContainText(`Store preset: ${preset.store}.`)
        await page.getByTestId('m-dev-ui-report').scrollIntoViewIfNeeded()
        await page.getByTestId('m-dev-ui-report').tap()
        const sheet = page.getByTestId('m-sheet-report')
        await expect(sheet).toBeVisible()
        await screensLoaded(page)
        expect(await measureLayout(page)).toEqual(CLEAN)
        // The sheet stays inside the window and leaves its close button in sight.
        const box = await sheet.boundingBox()
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.y + box!.height).toBeLessThanOrEqual(view.height + 0.5)
        expect(await reachable(page, 'm-sheet-close')).toBe(true)
        expect(await readable(page, 'm-report-intro')).toBe(true)

        for (const id of ['m-report-reason-hate', 'm-report-include-text', 'm-report-note']) {
          expect(await reachable(page, id), id).toBe(true)
        }
        await page.getByTestId('m-report-reason-hate').tap()
        await expect(page.getByTestId('m-report-reason-hate')).toHaveAttribute('aria-checked', 'true')
        await page.getByTestId('m-report-note').fill('It insults a group of people.')
        expect(await reachable(page, 'm-report-send')).toBe(true)
        await expect(page.getByTestId('m-report-send')).toBeEnabled()
        expect(await measureLayout(page)).toEqual(CLEAN)
        await page.getByTestId('m-report-send').tap()
        await expect(page.getByTestId('m-toast-report-queued')).toBeVisible()
        await expect(sheet).toHaveCount(0)
        const queue = await page.evaluate(() => JSON.parse(localStorage.getItem('lu-mobile-report-queue') ?? '[]') as Array<Record<string, unknown>>)
        expect(queue).toHaveLength(1)
        expect(queue[0]).toMatchObject({ reason: 'hate', preset: preset.store })
        expect(outside()).toEqual([])
        expect(errors()).toEqual([])
      })

      test('the consent sheet fits, its text can be read to the end and both answers are reachable', async ({ page }) => {
        const errors = watchErrors(page)
        await page.addInitScript(() => localStorage.setItem('lu-mobile-age', 'adult'))
        await openShell(page, { route: '/dev/ui', store: preset.store, fontScale: view.fontScale })
        const result = page.getByTestId('m-dev-ui-scaffold-result')
        await page.getByTestId('m-dev-ui-consent').scrollIntoViewIfNeeded()
        await page.getByTestId('m-dev-ui-consent').tap()
        const sheet = page.getByTestId('m-sheet-ai-consent')
        await expect(sheet).toBeVisible()
        await screensLoaded(page)
        expect(await measureLayout(page)).toEqual(CLEAN)
        const box = await sheet.boundingBox()
        expect(box!.y).toBeGreaterThanOrEqual(0)
        expect(box!.y + box!.height).toBeLessThanOrEqual(view.height + 0.5)
        expect(await readable(page, 'm-consent-text')).toBe(true)
        // The last line of the text can be brought into sight above the two answers.
        const lastLine = await page.getByTestId('m-consent-text').evaluate((el) => {
          const last = el.lastElementChild ?? el
          last.scrollIntoView({ block: 'end' })
          const r = last.getBoundingClientRect()
          const hit = document.elementFromPoint(r.left + 8, r.bottom - 4)
          return !!hit && el.contains(hit)
        })
        expect(lastLine).toBe(true)
        expect(await reachable(page, 'm-consent-agree')).toBe(true)
        expect(await reachable(page, 'm-consent-decline')).toBe(true)

        await page.getByTestId('m-consent-decline').tap()
        await expect(result).toHaveText('Cloud consent declined')
        await expect(sheet).toHaveCount(0)
        await page.getByTestId('m-dev-ui-consent').tap()
        await expect(sheet).toBeVisible()
        await page.getByTestId('m-consent-agree').tap()
        await expect(result).toHaveText('Cloud consent given')
        await expect(page.getByTestId('m-dev-ui-policy')).toContainText('Cloud consent given')
        expect(errors()).toEqual([])
      })
    })
  }
}

// ---------------------------------------------------------------------------
// Runde 4: what the switches of a store build close. The guard that renders
// every page and looks for forbidden words is store-waechter.mobile.ts; here
// a user tries the ways in.
// ---------------------------------------------------------------------------

async function openAsAdult(page: Page, store: 'play' | 'appstore', route?: string): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('lu-mobile-age', 'adult')
    const opened: string[] = []
    ;(window as unknown as { __opened: string[] }).__opened = opened
    window.open = (url?: string | URL) => {
      opened.push(String(url))
      return null
    }
  })
  await openShell(page, { route, store })
}

/** The list of chats (root of the chat tab) and the root of the settings. */
async function showRoot(page: Page, tab: 'chat' | 'settings'): Promise<void> {
  await page.evaluate(async (which) => {
    const { nav } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/nav/index.ts`)
    nav.resetTo(which, [])
  }, tab)
  await expect(page.locator('.m-page[data-m-exit]')).toHaveCount(0)
  await screensLoaded(page)
}

const openedLinks = (page: Page) => page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)

test.describe('store preset appstore, closed features', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Remote desktop is gone: no segment, no settings row, and its pages say so neutrally', async ({ page }) => {
    const errors = watchErrors(page)
    await openAsAdult(page, 'appstore')
    await showRoot(page, 'chat')
    await expect(page.getByTestId('m-chats-new').or(page.getByTestId('m-chats-empty')).first()).toBeVisible()
    await expect(page.getByTestId('m-chats-segment')).toHaveCount(0)
    await expect(page.getByTestId('m-chats-segment-remote')).toHaveCount(0)
    await showRoot(page, 'settings')
    await expect(page.getByTestId('m-settings-search')).toBeVisible()
    await expect(page.getByTestId('m-settings-remote')).toHaveCount(0)
    await expect(page.getByTestId('m-settings-providers')).toHaveCount(0)

    for (const route of ['/settings/remote', '/remote/scan', '/remote/connect']) {
      await openShell(page, { route, store: 'appstore' })
      const gone = page.getByTestId('m-unavailable')
      await expect(gone, route).toContainText('Not part of this version')
      await expect(gone, route).toContainText('This version of LU does not include Remote desktop.')
      expect(await measureLayout(page), route).toEqual(CLEAN)
    }
    await page.getByTestId('m-unavailable-back').tap()
    await expect(page.getByTestId('m-unavailable')).toHaveCount(0)
    expect(errors()).toEqual([])
  })

  test('a lu://remote link has no effect and says why once', async ({ page }) => {
    const errors = watchErrors(page)
    await openAsAdult(page, 'appstore')
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('lu:deep-link', { detail: { url: 'lu://remote?address=192.168.0.12%3A8080' } })))
    await expect(page.getByTestId('m-toast-unavailable-remote')).toHaveText('This version of LU does not include Remote desktop.')
    await expect(page.locator('[data-testid^="m-sheet-scrim"]')).toHaveCount(0)
    await expect(page.getByText('192.168.0.12')).toHaveCount(0)
    expect(errors()).toEqual([])
  })

  test('providers with your own key are gone, and a saved one is switched off', async ({ page }) => {
    await openAsAdult(page, 'appstore', '/settings/providers')
    await expect(page.getByTestId('m-unavailable')).toContainText('This version of LU does not include providers with your own key.')
    const slots = await page.evaluate(async () => {
      const { useProviderStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/providerStore.ts`)
      const store = useProviderStore.getState()
      // What an earlier build or a backup brings in: a provider of the user, switched on.
      store.setProviderConfig('anthropic', { enabled: true })
      const after = useProviderStore.getState().providers
      return Object.keys(after).filter((id) => after[id as keyof typeof after]?.enabled)
    })
    expect(slots).not.toContain('anthropic')
    expect(slots.every((id) => id === 'openai' || id === 'lu-cloud')).toBe(true)
  })

  test('About opens the legal links only, and Contact says when no mail app took over', async ({ page }) => {
    await openAsAdult(page, 'appstore', '/settings/about')
    await expect(page.getByTestId('m-settings-about-website')).toHaveCount(0)
    await expect(page.getByTestId('m-settings-about-source')).toHaveCount(0)
    await page.getByTestId('m-settings-about-privacy').tap()
    await page.getByTestId('m-settings-about-terms').tap()
    await page.getByTestId('m-settings-about-contact').tap()
    // The browser says "opened" and nothing comes to the front, like a phone without a mail app.
    await expect(page.getByTestId('m-toast-contact-fallback')).toContainText('No mail app opened. Write to hello@lu-labs.ai.', { timeout: 5000 })
    await expect(page.getByTestId('m-settings-about-contact-copy')).toBeVisible()
    expect(await openedLinks(page)).toEqual(['https://lu-labs.ai/privacy', 'https://lu-labs.ai/terms', 'mailto:hello@lu-labs.ai'])
    expect(await measureLayout(page)).toEqual(CLEAN)
  })
})

test.describe('store preset play, what stays', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('Remote desktop and providers stay, the website link does not', async ({ page }) => {
    await openAsAdult(page, 'play')
    await showRoot(page, 'chat')
    await expect(page.getByTestId('m-chats-segment-remote')).toBeVisible()
    await showRoot(page, 'settings')
    await expect(page.getByTestId('m-settings-providers')).toBeVisible()
    await expect(page.getByTestId('m-settings-remote')).toBeVisible()
    await openShell(page, { route: '/settings/providers', store: 'play' })
    await expect(page.getByTestId('m-unavailable')).toHaveCount(0)
    await openShell(page, { route: '/settings/about', store: 'play' })
    await expect(page.getByTestId('m-settings-about-contact')).toBeVisible()
    await expect(page.getByTestId('m-settings-about-website')).toHaveCount(0)
  })
})

// ---------------------------------------------------------------------------
// Four decisions of 10.10.2026, each one line in a preset (mobile-docs/STORE-BAUSTEINE.md, section 8):
//  1. sign in through a third party (switch thirdPartySignIn). Round 14 took it out of appstore; David decided the
//     same day that Google and GitHub stay there, and round 15 put "Sign in with Apple" above them on iOS
//     (switch appleSignIn, rule 4.8). The page as a user meets it is held below, the switch turned off in vitest
//     (src/mobile/screens/settings/__tests__/third-party-sign-in.dom.test.tsx),
//  2. play: no open search at the model hub (switch hubSearch); since r56 (18.10.2026) no foreign files either (customModelUrl),
//  3. appstore: no search keys of one's own (switch webSearchKeys),
//  4. the support address on About is the wanted contact (store-waechter.mobile.ts).
// ---------------------------------------------------------------------------

/** Push a page on the stack of the tab it belongs to and wait for its file. */
async function pushRoute(page: Page, tab: 'models' | 'settings', route: string, params?: Record<string, string>): Promise<void> {
  await page.evaluate(
    async (step) => {
      const { navApi } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/nav/api.ts`)
      navApi.resetTo(step.tab, [])
      navApi.push(step.route, step.params)
    },
    { tab, route, params },
  )
  await expect(page.locator('.m-page[data-m-exit]')).toHaveCount(0)
  await screensLoaded(page)
}

/** The page on top, so a row of the page below it is not found in its place. */
const topPage = (page: Page) => page.locator('.m-page:not([data-m-hidden]):not([data-m-exit])').last()

test.describe('decision 1: sign in through a third party', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const store of ['appstore', 'play'] as const) {
    test(`${store}: the page Account offers email and password, Google and GitHub`, async ({ page }) => {
      const errors = watchErrors(page)
      await openAsAdult(page, store, '/settings/account')
      const account = topPage(page)
      await expect(account.getByTestId('m-account-signin')).toBeVisible()
      await expect(account.getByTestId('m-account-email')).toBeVisible()
      await expect(account.getByTestId('m-account-password')).toBeVisible()
      await expect(account.getByTestId('m-account-mode-signup')).toBeVisible()
      await expect(account.getByTestId('m-account-forgot')).toContainText('Forgot password?')
      await expect(account.getByTestId('m-account-google')).toHaveText('Continue with Google')
      await expect(account.getByTestId('m-account-github')).toHaveText('Continue with GitHub')
      await expect(account.getByTestId('m-account-same-signin')).toHaveText('Use the same sign-in you used before to reach your existing account.')
      // Not an iPhone: no button of Apple and no word about it.
      await expect(page.getByTestId('m-account-apple')).toHaveCount(0)
      expect(await account.innerText()).not.toMatch(/apple/i)
      // Creating an account is the same form with the same ways next to it.
      await account.getByTestId('m-account-mode-signup').tap()
      await expect(account.getByTestId('m-account-signin')).toHaveText('Create account')
      await expect(account.getByTestId('m-account-google')).toBeVisible()
      expect(await measureLayout(page)).toEqual(CLEAN)
      expect(errors()).toEqual([])
    })
  }

  test('open: both buttons are there, as before', async ({ page }) => {
    await openShell(page, { route: '/settings/account', store: 'open' })
    await expect(topPage(page).getByTestId('m-account-google')).toBeVisible()
    await expect(topPage(page).getByTestId('m-account-github')).toBeVisible()
  })

  test('appstore: a link lu://oauth/callback that nobody asked for changes nothing', async ({ page }) => {
    const errors = watchErrors(page)
    const outside = watchOutside(page)
    await openAsAdult(page, 'appstore', '/settings/account')
    const account = topPage(page)
    await expect(account.getByTestId('m-account-signin')).toBeVisible()
    for (const url of ['lu://oauth/callback?code=abc123', 'lu://oauth/callback?error=access_denied', 'lu://oauth/callback']) {
      await page.evaluate((link) => window.dispatchEvent(new CustomEvent('lu:deep-link', { detail: { url: link } })), url)
    }
    await page.waitForTimeout(600)
    // No sheet, no toast, no error, still the form, still signed out, and no code went to a server.
    await expect(page.locator('[data-testid^="m-sheet-scrim"]')).toHaveCount(0)
    await expect(page.locator('[data-testid^="m-toast-"]')).toHaveCount(0)
    await expect(page.getByTestId('m-account-error')).toHaveCount(0)
    await expect(page.getByTestId('m-account-oauth-waiting')).toHaveCount(0)
    await expect(account.getByTestId('m-account-signin')).toBeVisible()
    const status = await page.evaluate(async () => {
      const { useCloudAuthStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/cloudAuthStore.ts`)
      return useCloudAuthStore.getState().status as string
    })
    expect(status).not.toBe('signed-in')
    expect(outside()).toEqual([])
    // The form still works as a form after the links.
    await account.getByTestId('m-account-signin').tap()
    await expect(account.getByText('Enter a valid email address.')).toBeVisible()
    expect(errors()).toEqual([])
  })
})

// Rule 4.8 of the App Review Guidelines: where a sign in through a third party is offered, "Sign in with Apple"
// stands next to it. On an iPhone in every preset, first of the three. What a tap does is held in
// settings.mobile.ts with a played native layer.
test.describe('decision 1 on an iPhone: Sign in with Apple next to Google and GitHub', () => {
  test.use({ viewport: { width: 390, height: 844 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' })

  for (const store of ['appstore', 'play', 'open'] as const) {
    test(`${store}: three ways next to the form, Apple first, and one sentence about the account`, async ({ page }) => {
      const errors = watchErrors(page)
      if (store === 'open') await openShell(page, { route: '/settings/account', store })
      else await openAsAdult(page, store, '/settings/account')
      const account = topPage(page)
      const ways = await account.locator('[data-testid="m-account-apple"], [data-testid="m-account-google"], [data-testid="m-account-github"]').evaluateAll((all) =>
        all.map((el) => ({ id: el.getAttribute('data-testid'), text: (el.textContent ?? '').replace(/[\uE000-\uF8FF]/g, '').trim(), top: el.getBoundingClientRect().top, width: el.getBoundingClientRect().width })),
      )
      expect(ways.map((w) => [w.id, w.text])).toEqual([
        ['m-account-apple', 'Sign in with Apple'],
        ['m-account-google', 'Continue with Google'],
        ['m-account-github', 'Continue with GitHub'],
      ])
      expect(ways[0].top).toBeLessThan(ways[1].top)
      expect(ways[0].width).toBe(ways[1].width)
      await expect(account.getByTestId('m-account-same-signin')).toBeVisible()
      // Whoever has a store build without Google and GitHub must not have this one either way round:
      // the App Store build never shows a third party without Apple.
      if (store === 'appstore') await expect(account.getByTestId('m-account-apple')).toBeVisible()
      expect(await measureLayout(page)).toEqual(CLEAN)
      expect(errors()).toEqual([])
    })
  }
})

test.describe('decision 2: the open search at the model hub', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  /** Every request to the hub is answered here and counted by kind. */
  async function mockHub(page: Page): Promise<{ searches: string[]; trees: string[] }> {
    const asked = { searches: [] as string[], trees: [] as string[] }
    const cors = { 'access-control-allow-origin': '*', 'content-type': 'application/json' }
    await page.route('https://huggingface.co/**', (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/api/models' && url.searchParams.has('search')) {
        asked.searches.push(url.search)
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify([{ id: 'e2e-lab/Hermes-3-Llama-3.1-8B-GGUF', downloads: 1200 }]) })
      }
      if (/\/tree\/main/.test(url.pathname)) {
        asked.trees.push(url.pathname)
        const leaf = url.pathname.split('/')[4].replace(/-GGUF$/i, '')
        return route.fulfill({ status: 200, headers: cors, body: JSON.stringify([{ type: 'file', path: `${leaf}-Q8_0.gguf`, size: 900 * 1024 * 1024 }]) })
      }
      return route.abort('blockedbyclient')
    })
    return asked
  }

  async function showCatalogue(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const { nav } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/nav/index.ts`)
      nav.resetTo('models', [])
    })
    await screensLoaded(page)
    const segment = page.locator('[data-testid="m-models-segment-new"]:visible')
    if ((await segment.getAttribute('aria-checked')) !== 'true') await segment.tap()
    await expect(page.locator('[data-testid="m-models-catalog"]:visible')).toBeVisible()
  }

  for (const store of ['play', 'appstore'] as const) {
    test(`${store}: no search field, the catalogue and its filters stay, and nobody asks the hub`, async ({ page }) => {
      const errors = watchErrors(page)
      const asked = await mockHub(page)
      await openAsAdult(page, store)
      await showCatalogue(page)
      await expect(page.getByTestId('m-models-search')).toHaveCount(0)
      await expect(page.locator('[data-testid="m-models-filters"]:visible')).toBeVisible()
      expect(await page.locator('[data-testid="m-models-catalog"]:visible [data-testid^="m-models-item"]').count()).toBeGreaterThan(0)
      // A text an earlier build left in the field asks nobody and hides nothing.
      await page.evaluate(async () => {
        const { useModelsView } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/screens/models/parts/view.ts`)
        useModelsView.getState().setQuery('hermes lorablated')
      })
      await page.waitForTimeout(900)
      await expect(page.getByTestId('m-models-hits')).toHaveCount(0)
      await expect(page.getByTestId('m-models-searching')).toHaveCount(0)
      await expect(page.locator('[data-testid="m-models-filters"]:visible')).toBeVisible()
      await expect(page.locator('[data-testid="m-models-catalog"]:visible')).toBeVisible()
      expect(asked.searches).toEqual([])

      // The page of a repository the catalogue does not list, by its address: not offered, and its files are not asked for.
      for (const repo of ['e2e-lab/Hermes-3-Llama-3.1-8B-GGUF', 'e2e-lab/Hermes-3-Llama-3.1-8B-lorablated-GGUF']) {
        await pushRoute(page, 'models', '/models/:id', { id: `hf:${repo}` })
        await expect(topPage(page).getByTestId('m-models-detail-notfound'), repo).toContainText('This model is not available in this version of LU.')
        await expect(topPage(page).getByTestId('m-models-detail-download'), repo).toHaveCount(0)
      }
      expect(asked.trees.filter((path) => path.includes('e2e-lab'))).toEqual([])
      expect(errors()).toEqual([])
    })
  }

  /** The first catalogue model that is not of the unfiltered kind, by id and repository. */
  const plainCatalogueModel = (page: Page) =>
    page.evaluate(async () => {
      const { MOBILE_CHAT_MODELS } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/data/mobile-models.ts`)
      const first = (MOBILE_CHAT_MODELS as Array<{ id: string; repo: string; uncensored: boolean }>).find((m) => !m.uncensored)!
      return { id: first.id, repo: first.repo }
    })

  // r56, decided 18.10.2026 (Option c): the Play build takes no file from outside the catalogue (customModelUrl off),
  // like the App Store build. The page of a catalogue model stays; the other packings of its repository are not read.
  for (const store of ['play', 'appstore'] as const) {
    test(`${store}: a model of the catalogue keeps its page, and no other packing of its repository is read`, async ({ page }) => {
      const errors = watchErrors(page)
      const asked = await mockHub(page)
      await openAsAdult(page, store)
      const model = await plainCatalogueModel(page)
      await pushRoute(page, 'models', '/models/:id', { id: model.id })
      await expect(topPage(page).getByTestId('m-models-detail-notfound')).toHaveCount(0)
      await expect(topPage(page).getByTestId('m-models-detail-verdict')).toBeVisible()
      await page.waitForTimeout(900)
      // One row: the file the catalogue names. The packing the hub would answer (Q8_0 in this mock) is not there.
      await expect(topPage(page).getByTestId('m-models-detail-variant')).toHaveCount(1)
      await expect(topPage(page).getByTestId('m-models-detail-variant').filter({ hasText: /Q8_0/ })).toHaveCount(0)
      expect(asked.trees).toEqual([])
      expect(asked.searches).toEqual([])
      expect(await page.evaluate(async () => {
        const { storePolicy } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/policy/storePolicy.ts`)
        return storePolicy().customModelUrl as boolean
      })).toBe(false)
      expect(errors()).toEqual([])
    })
  }

  test('open: a model of the catalogue keeps its page and reads its other packings, as before', async ({ page }) => {
    const asked = await mockHub(page)
    await openShell(page, { store: 'open' })
    const model = await plainCatalogueModel(page)
    await pushRoute(page, 'models', '/models/:id', { id: model.id })
    await expect(topPage(page).getByTestId('m-models-detail-notfound')).toHaveCount(0)
    await expect(topPage(page).getByTestId('m-models-detail-verdict')).toBeVisible()
    // The other packings of the repository are read: foreign files stay in this build (customModelUrl).
    await expect.poll(() => asked.trees.some((path) => path.includes(model.repo))).toBe(true)
    await expect(topPage(page).getByTestId('m-models-detail-variant').filter({ hasText: /Q8_0/ }).first()).toBeVisible()
    // And the repository of the catalogue by its address is the same repository, not a closed page.
    await pushRoute(page, 'models', '/models/:id', { id: `hf:${model.repo}` })
    await expect(topPage(page).getByTestId('m-models-detail-verdict')).toBeVisible()
    await expect(topPage(page).getByTestId('m-models-detail-notfound')).toHaveCount(0)
  })

  // r56: "Import a model file" on the page Storage and downloads. A played native layer that can import, so only the
  // switch decides: the open build offers the row, both store builds do not (Play since 18.10.2026).
  for (const store of ['open', 'play', 'appstore'] as const) {
    test(`${store}: "Import a model file" and the token field are ${store === 'open' ? 'offered' : 'not offered'} on a phone that can import`, async ({ page }) => {
      const errors = watchErrors(page)
      if (store === 'open') await openShell(page, { store })
      else await openAsAdult(page, store)
      await page.evaluate(async () => {
        const { __setBridgeForTests } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/platform/bridge.ts`)
        __setBridgeForTests({ importModelFile: async () => ({ cancelled: true }) } as never)
      })
      await pushRoute(page, 'settings', '/settings/storage')
      const storage = topPage(page)
      await expect(storage.getByTestId('m-settings-storage-bar')).toBeVisible()
      if (store === 'open') {
        await expect(storage.getByTestId('m-settings-storage-import')).toBeVisible()
        await expect(storage.getByTestId('m-settings-storage-token')).toBeVisible()
      } else {
        await page.waitForTimeout(600)
        await expect(storage.getByTestId('m-settings-storage-import')).toHaveCount(0)
        // The token field follows foreign files (gatedModelToken, Play since r56): the catalogue asks for no sign in.
        await expect(storage.getByTestId('m-settings-storage-token')).toHaveCount(0)
        expect(await storage.innerText()).not.toMatch(/import a model file|gguf/i)
      }
      await page.evaluate(async () => {
        const { __setBridgeForTests } = await import(/* @vite-ignore */ `${location.origin}/src/mobile/platform/bridge.ts`)
        __setBridgeForTests(undefined)
      })
      expect(errors()).toEqual([])
    })
  }

  test('open: the search is there and asks the hub, as before', async ({ page }) => {
    const asked = await mockHub(page)
    await openShell(page, { store: 'open' })
    await showCatalogue(page)
    const field = page.locator('[data-testid="m-models-search"]:visible')
    await expect(field).toBeVisible()
    await field.fill('hermes')
    await expect(page.locator('[data-testid="m-models-hits"]:visible').getByText('Hermes-3-Llama-3.1-8B', { exact: true })).toBeVisible({ timeout: 15_000 })
    expect(asked.searches.length).toBeGreaterThan(0)
  })
})

test.describe('decision 3: search keys of the user', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('appstore: no key field and no choice, the search works, and a key from an earlier build is neither shown nor sent', async ({ page }) => {
    const errors = watchErrors(page)
    const asked: Array<Record<string, unknown>> = []
    let fail = false
    await page.route('**/local-api/web-search', async (route) => {
      asked.push(route.request().postDataJSON() as Record<string, unknown>)
      if (fail) {
        const error = 'All search tiers failed. DuckDuckGo: answered with a bot check instead of results (HTTP 202). Wikipedia: timed out. The free search is not dependable. Add a Brave or Tavily key under Settings, Web search for dependable search.'
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ results: [], error }) })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ provider: 'duckduckgo', results: [{ title: 'Printing press', url: 'https://example.test/p', snippet: 'x' }] }) })
    })
    await openAsAdult(page, 'appstore', '/settings/search')
    const search = topPage(page)
    await expect(search.getByTestId('m-search-free-only')).toContainText('LU searches with the free search.')
    await expect(page.getByTestId('m-search-provider')).toHaveCount(0)
    await expect(page.getByTestId('m-search-brave-key')).toHaveCount(0)
    await expect(page.getByTestId('m-search-tavily-key')).toHaveCount(0)
    expect(await search.innerText()).not.toMatch(/api key|brave|tavily/i)

    // What an earlier build or a backup brings in: the mark of a stored key and the choice that uses it.
    const provider = await page.evaluate(async () => {
      const { useSettingsStore } = await import(/* @vite-ignore */ `${location.origin}/src/stores/settingsStore.ts`)
      useSettingsStore.getState().updateSettings({ searchProvider: 'brave', braveKeyStored: true, tavilyKeyStored: true })
      return useSettingsStore.getState().settings.searchProvider as string
    })
    expect(provider).toBe('duckduckgo')
    await expect(page.getByTestId('m-search-brave-saved')).toHaveCount(0)
    expect(await search.innerText()).not.toMatch(/api key|brave|tavily/i)

    await search.getByTestId('m-search-test').tap()
    await expect(search.getByTestId('m-search-result')).toContainText('Search works. 1 result from DuckDuckGo.')
    expect(asked[0]).toMatchObject({ provider: 'duckduckgo', braveApiKey: '', tavilyApiKey: '' })

    // A search nobody answered: the reasons, without the advice to add a key this build has no field for.
    fail = true
    await search.getByTestId('m-search-test').tap()
    await expect(search.getByTestId('m-search-result-failed')).toContainText('Search did not work. All search tiers failed.')
    await expect(search.getByTestId('m-search-result-failed')).toContainText('Wikipedia: timed out.')
    await expect(search.getByTestId('m-search-result-failed')).not.toContainText(/key|Brave|Tavily/)
    expect(asked[1]).toMatchObject({ provider: 'duckduckgo', braveApiKey: '', tavilyApiKey: '' })
    expect(await measureLayout(page)).toEqual(CLEAN)
    expect(errors()).toEqual([])
  })

  test('play: the choice and both key fields stay', async ({ page }) => {
    await openAsAdult(page, 'play', '/settings/search')
    const search = topPage(page)
    await expect(search.getByTestId('m-search-provider')).toBeVisible()
    await expect(search.getByTestId('m-search-brave-key')).toBeVisible()
    await expect(search.getByTestId('m-search-tavily-key')).toBeVisible()
    await expect(page.getByTestId('m-search-free-only')).toHaveCount(0)
  })
})

// Second check on Android, F11: the Play package listed built in personas named after real people.
// Decided 10.10.2026: the store presets do not offer them (switch realPersonPersonas), the open build is unchanged.
test.describe('personas named after real people', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  for (const store of ['play', 'appstore'] as const) {
    test(`${store}: "Morgan Freeman" and "Chef Ramsay" are not on the list, and one that was in use gives way to the default`, async ({ page }) => {
      const errors = watchErrors(page)
      await openAsAdult(page, store)
      // An older build, or a backup, left one of them active.
      await page.evaluate(async () => {
        const { useSettingsStore } = (await import(/* @vite-ignore */ '/src/stores/settingsStore.ts' as string)) as typeof import('../../src/stores/settingsStore')
        useSettingsStore.getState().setActivePersona('narrator')
      })
      await openShell(page, { route: '/settings/personas', store })
      const list = page.getByTestId('m-personas-list')
      await expect(list).toBeVisible()
      await expect(list).not.toContainText('Morgan Freeman')
      await expect(list).not.toContainText('Chef Ramsay')
      await expect(list).not.toContainText('ChadGPT')
      await expect(page.getByTestId('m-personas-pick-narrator')).toHaveCount(0)
      await expect(page.getByTestId('m-personas-pick-gordon')).toHaveCount(0)
      // Invented ones stay.
      await expect(page.getByTestId('m-personas-pick-pirate')).toBeVisible()
      await expect(list.locator('[data-testid^="m-personas-pick-"]')).toHaveCount(20)
      expect(await page.evaluate(async () => {
        const { useSettingsStore } = (await import(/* @vite-ignore */ '/src/stores/settingsStore.ts' as string)) as typeof import('../../src/stores/settingsStore')
        return useSettingsStore.getState().activePersonaId
      })).toBe('unrestricted')
      expect(errors()).toEqual([])
    })
  }

  test('open: both are on the list as before', async ({ page }) => {
    await openShell(page, { route: '/settings/personas', store: 'open' })
    const list = page.getByTestId('m-personas-list')
    await expect(list).toContainText('Morgan Freeman')
    await expect(list).toContainText('Chef Ramsay')
    await expect(list.locator('[data-testid^="m-personas-pick-"]')).toHaveCount(25)
  })
})

// Acceptance android-knoepfe, finding M10: at 200 percent text "No" lay below
// the lower edge, and with the phone on its side neither answer was on
// screen. Both answers have a footer of their own now and need no scrolling.
for (const view of [
  { name: '360x592 at 200 percent', width: 360, height: 592, fontScale: 200 },
  { name: '592x360 on its side', width: 592, height: 360, fontScale: 100 },
  { name: '592x360 on its side at 200 percent', width: 592, height: 360, fontScale: 200 },
  { name: '568x320 on its side at 200 percent', width: 568, height: 320, fontScale: 200 },
]) {
  test.describe(`age question, ${view.name}`, () => {
    test.use({ viewport: { width: view.width, height: view.height } })

    test('both answers are on screen without scrolling, and the text above them scrolls', async ({ page }) => {
      const errors = watchErrors(page)
      await page.goto(shellUrl({ route: '/dev/ui', store: 'play', fontScale: view.fontScale }))
      await expect(page.getByTestId('m-age-ask')).toBeVisible()
      await expect(page.getByTestId('m-age-yes')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('m-age-no')).toBeInViewport({ ratio: 1 })
      expect(await measureLayout(page)).toEqual(CLEAN)
      // The answers are not part of what scrolls, and the text is not under them.
      const boxes = await page.evaluate(() => {
        const body = document.querySelector('.m-age-body')!.getBoundingClientRect()
        const foot = document.querySelector('[data-testid="m-age-actions"]')!.getBoundingClientRect()
        return { bodyBottom: body.bottom, footTop: foot.top, footBottom: foot.bottom, bodyHeight: body.height }
      })
      expect(boxes.bodyBottom).toBeLessThanOrEqual(boxes.footTop + 0.5)
      expect(boxes.footBottom).toBeLessThanOrEqual(view.height + 0.5)
      // Room for at least two lines of the question stays above the answers.
      expect(boxes.bodyHeight).toBeGreaterThan(2 * 16 * (view.fontScale / 100) * 1.2)
      // The last line of the text can be brought into sight.
      const lastLine = await page.getByTestId('m-age-ask').evaluate((el) => {
        const body = el.closest('.m-age-body')!
        body.scrollTop = body.scrollHeight
        const text = el.querySelector('p')!.getBoundingClientRect()
        return text.bottom <= body.getBoundingClientRect().bottom + 0.5
      })
      expect(lastLine).toBe(true)
      await page.getByTestId('m-age-no').tap()
      // The two answers of the second question stand where the first two stood.
      await expect(page.getByTestId('m-age-confirm')).toBeVisible()
      await expect(page.getByTestId('m-age-confirm-back')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('m-age-confirm-minor')).toBeInViewport({ ratio: 1 })
      expect(await measureLayout(page)).toEqual(CLEAN)
      await page.getByTestId('m-age-confirm-minor').tap()
      await expect(page.getByTestId('m-age-blocked')).toBeVisible()
      await expect(page.getByRole('button')).toHaveCount(0)
      expect(errors()).toEqual([])
    })
  })
}

// Finding M1: with a native layer the answer is asked of it at the start and
// written to it before the page moves on.
test.describe('age question with a native storage', () => {
  async function fakeVault(page: Page, start: string | null, saveDelayMs = 0): Promise<void> {
    await page.addInitScript(
      ([initial, delay]) => {
        const w = window as unknown as { __TAURI_INTERNALS__: unknown; __ageVault: { value: string | null; calls: string[] } }
        w.__ageVault = { value: initial as string | null, calls: [] }
        w.__TAURI_INTERNALS__ = {
          invoke: async (cmd: string, args: { backendId?: string; value?: string }) => {
            if (cmd === 'secret_park_get' && args.backendId === 'lu-age-declaration') {
              w.__ageVault.calls.push('get')
              return w.__ageVault.value
            }
            if (cmd === 'secret_park_set' && args.backendId === 'lu-age-declaration') {
              w.__ageVault.calls.push(`set:${args.value}`)
              await new Promise((r) => setTimeout(r, delay as number))
              w.__ageVault.value = args.value ?? null
              return null
            }
            throw new Error(`no native layer in this test: ${cmd}`)
          },
          transformCallback: () => 0,
          metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
        }
      },
      [start, saveDelayMs] as const,
    )
  }

  test('"No" given earlier blocks although localStorage is empty', async ({ page }) => {
    await fakeVault(page, 'minor')
    await page.goto(shellUrl({ route: '/dev/ui', store: 'play' }))
    await expect(page.getByTestId('m-age-blocked')).toBeVisible()
    await expect(page.getByTestId('m-age-yes')).toHaveCount(0)
    await expect(page.getByTestId('m-app')).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('lu-mobile-age'))).toBe('minor')
  })

  test('the question stays until the native layer confirmed "No"', async ({ page }) => {
    await fakeVault(page, null, 700)
    await page.goto(shellUrl({ route: '/dev/ui', store: 'play' }))
    await expect(page.getByTestId('m-age-ask')).toBeVisible()
    await page.getByTestId('m-age-no').tap()
    // The first "No" writes nothing, neither here nor on the native side.
    await expect(page.getByTestId('m-age-confirm')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __ageVault: { calls: string[] } }).__ageVault.calls.filter((c) => c.startsWith('set')))).toEqual([])
    await page.getByTestId('m-age-confirm-minor').tap()
    // Being written: still the second question, the tapped button works, the way back is out.
    await expect(page.getByTestId('m-age-confirm-minor')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByTestId('m-age-confirm-back')).toBeDisabled()
    expect(await page.evaluate(() => (window as unknown as { __ageVault: { value: string | null } }).__ageVault.value)).toBeNull()
    await expect(page.getByTestId('m-age-blocked')).toBeVisible()
    expect(await page.evaluate(() => (window as unknown as { __ageVault: { value: string | null } }).__ageVault.value)).toBe('minor')
  })
})
