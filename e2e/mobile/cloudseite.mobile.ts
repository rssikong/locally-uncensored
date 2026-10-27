/**
 * The LU Cloud page (E3, route /cloud), signed out, in every store preset.
 *
 * The guards of mobile-docs/plaene/LU-CLOUD-SEITE.md section 6.2 that need a
 * drawn page: the one filled button stands in the fixed footer and lies
 * wholly in the first screen, without scrolling, at the widths of the small
 * and the large phones and at 100 and 200 percent text. The heights are the
 * ones the plan measured below the system bars (section 1.2), so the run is
 * not kinder than a phone.
 *
 * LU Cloud is mocked at the network (e2e/support/cloud-mock.ts); nothing is
 * signed in for real and no link is opened.
 *
 *   LU_E2E_PORT=5391 LU_E2E_ONLY=cloudseite npx playwright test --project=mobile --workers=2
 *
 * With LU_CLOUD_SHOTS=<folder> the run also saves a picture of the first
 * screen per preset at 412x915 and 360x640 (mobile-docs/r51/bilder/).
 */
import path from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { routeCloud } from '../support/cloud-mock'
import { declareAdult, screensLoaded, shellUrl } from './support'
import { storeFindings } from './store-rules'

const PRESETS = ['open', 'play', 'appstore'] as const
type Preset = (typeof PRESETS)[number]

/** Webview sizes: the screen of the phone less its status and navigation bars (plan 1.2). */
const SCREENS = [
  { name: '320x568', width: 320, height: 548 },
  { name: '360x640', width: 360, height: 568 },
  { name: '375x667', width: 375, height: 647 },
  { name: '412x915', width: 412, height: 867 },
] as const

async function openCloud(page: Page, store: Preset, fontScale?: number): Promise<void> {
  await routeCloud(page, { license: 'none' })
  // The presets of the two stores ask for the age before anything else (policy/AgeGate); answered once, as an adult.
  if (store !== 'open') await declareAdult(page)
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('lu-mobile-nav')
    } catch {
      /* storage blocked: nothing to clear */
    }
    const opened: string[] = []
    ;(window as unknown as { __opened: string[] }).__opened = opened
    window.open = (url?: string | URL) => {
      opened.push(String(url))
      return null
    }
  })
  await page.goto(shellUrl({ route: '/cloud', store, fontScale }))
  await page.getByTestId('m-app').waitFor()
  await screensLoaded(page)
  await expect(page.getByTestId('m-cloud-state')).toHaveAttribute('data-state', 'signed-out')
}

const screen = (page: Page) => page.getByTestId('m-cloud-screen')

/** The filled buttons of the page: variants primary and cloud. */
const FILLED = '.m-btn--primary, .m-btn--cloud'
const filled = (page: Page) => screen(page).locator(FILLED)
/** The main button: the one filled button, in the fixed footer of the page. */
const main = (page: Page) => screen(page).locator('.m-foot').locator(FILLED)

if (process.env.LU_CLOUD_SHOTS) {
  const folder = process.env.LU_CLOUD_SHOTS
  for (const store of PRESETS) {
    for (const size of [
      { width: 412, height: 915 },
      { width: 360, height: 640 },
    ]) {
      test(`picture ${store} ${size.width}x${size.height}`, async ({ page }) => {
        await page.setViewportSize(size)
        await openCloud(page, store)
        await page.waitForTimeout(300)
        await page.screenshot({ path: path.join(folder, `${store}-${size.width}x${size.height}.png`) })
      })
    }
  }
}

test.describe('LU Cloud page, signed out', () => {
  for (const store of PRESETS) {
    test(`${store}: exactly one filled button, and it stands in the footer`, async ({ page }) => {
      await openCloud(page, store)
      await expect(filled(page)).toHaveCount(1)
      await expect(main(page)).toHaveCount(1)
      await expect(main(page)).toHaveText(store === 'open' ? 'Get LU Cloud' : store === 'play' ? 'Create account' : 'Sign in')
      // At most one second button next to it, a quiet one; the App Store build has none ("Create account" is not offered there, D3).
      await expect(screen(page).locator('.m-foot .m-btn')).toHaveCount(store === 'appstore' ? 1 : 2)
      // The title stands once, in the header.
      await expect(screen(page).getByText('LU Cloud', { exact: true })).toHaveCount(1)
    })

    for (const size of SCREENS) {
      for (const fontScale of [100, 200]) {
        test(`${store} ${size.name} at ${fontScale} percent: the main button is in the first screen`, async ({ page }) => {
          await page.setViewportSize({ width: size.width, height: size.height })
          await openCloud(page, store, fontScale)
          const box = await main(page).boundingBox()
          expect(box, 'no main button').toBeTruthy()
          expect(box!.y).toBeGreaterThanOrEqual(0)
          expect(box!.y + box!.height).toBeLessThanOrEqual(size.height + 0.5)
          expect(box!.x).toBeGreaterThanOrEqual(0)
          expect(box!.x + box!.width).toBeLessThanOrEqual(size.width + 0.5)
          expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)).toBe(false)
        })
      }
    }
  }

  test('open: the number band, the plan rows, and the sheet of the main button', async ({ page }) => {
    await openCloud(page, 'open')
    const band = page.getByTestId('m-cloud-count')
    await expect(band.getByTestId('m-cloud-count-total')).toHaveText(/^\d+$/)
    await expect(band).toContainText('answer without refusing, measured 10 Sep 2026')
    await expect(page.getByTestId('m-cloud-plans')).toBeVisible()
    await page.getByTestId('m-cloud-plan-hosted').tap()
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toContain('https://lu-labs.ai/checkout/start?plan=hosted&src=mobile')
    await expect(page.getByTestId('m-cloud-from-price')).toHaveText('From 19 EUR a month. Cancel anytime.')
    await main(page).tap()
    const sheet = page.getByTestId('m-sheet-settings-cloud-plans')
    await expect(sheet).toBeVisible()
    await expect(sheet.locator('[data-testid^="m-cloud-sheet-plan-"]')).toHaveCount(3)
    await sheet.getByTestId('m-cloud-sheet-plan-hosted-pro').tap()
    expect(await page.evaluate(() => (window as unknown as { __opened: string[] }).__opened)).toContain('https://lu-labs.ai/checkout/start?plan=hosted-pro&src=mobile')
  })

  test('play: no count (since r56), one sentence about buying without a link, "Create account" opens the account page on that segment', async ({ page }) => {
    await openCloud(page, 'play')
    // r56, 18.10.2026 (Option c): the Play build lists what the App Store build lists, so it names no count of the whole catalogue.
    await expect(page.getByTestId('m-cloud-count-total')).toHaveCount(0)
    expect(await page.getByTestId('m-cloud-count').innerText()).not.toMatch(/\d/)
    const text = await screen(page).innerText()
    expect(text).not.toMatch(/\d+\s*(AI |chat |image |video )?models|\d+ (chat|image|video)\b/i)
    expect(text).not.toMatch(/EUR|Hosted|Cancel anytime|refus/i)
    expect(storeFindings(text.replace('Plans and credits are available on lu-labs.ai.', ''), 'play')).toEqual([])
    await expect(page.getByTestId('m-cloud-plans-text')).toHaveText('Plans and credits are available on lu-labs.ai.')
    await expect(screen(page).locator('a')).toHaveCount(0)
    // The address does not break at its hyphen.
    await expect(page.getByTestId('m-cloud-plans-text').locator('.m-nobr')).toHaveText('lu-labs.ai')
    await main(page).tap()
    await expect(page.getByTestId('m-account-mode-signup')).toHaveAttribute('aria-checked', 'true')
  })

  test('appstore: no number, no price, no buying, no "Create account"', async ({ page }) => {
    await openCloud(page, 'appstore')
    await expect(page.getByTestId('m-cloud-count-total')).toHaveCount(0)
    const text = await screen(page).innerText()
    // No count of models anywhere: the band has no digit, and no line names a number of models (the preview has a clock and days).
    expect(await page.getByTestId('m-cloud-count').innerText()).not.toMatch(/\d/)
    expect(text).not.toMatch(/\d+\s*(AI |chat |image |video )?models|\d+ (chat|image|video)\b/i)
    expect(text).not.toMatch(/plan|price|credit|EUR|subscri|lu-labs|buy|Create account/i)
    expect(storeFindings(text, 'appstore')).toEqual([])
    await main(page).tap()
    await expect(page.getByTestId('m-account-mode-signin')).toHaveAttribute('aria-checked', 'true')
  })

  test('the preview: moves transform and opacity only, holds on a pick, and stands with reduced motion', async ({ page }) => {
    await openCloud(page, 'play')
    const show = page.getByTestId('m-cloud-showcase')
    await expect(show).toBeVisible()
    await expect(show).toHaveAttribute('role', 'group')
    await expect(show).toHaveAttribute('data-scene', 'chat')
    // What runs right now animates transform and opacity and nothing else, and nothing runs for ever.
    const running = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => (a.effect as KeyframeEffect | null)?.target instanceof Element && ((a.effect as KeyframeEffect).target as Element).closest('[data-testid="m-cloud-showcase"]'))
        .map((a) => {
          const effect = a.effect as KeyframeEffect
          const props = effect.getKeyframes().flatMap((k) => Object.keys(k).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key)))
          return { props: [...new Set(props)], iterations: effect.getTiming().iterations }
        }),
    )
    expect(running.length).toBeGreaterThan(0)
    for (const one of running) {
      for (const prop of one.props) expect(['transform', 'opacity'], prop).toContain(prop)
      expect(one.iterations).not.toBe(Infinity)
    }
    // A pick shows that scene and holds it.
    await page.getByTestId('m-cloud-showcase-video').tap()
    await expect(show).toHaveAttribute('data-scene', 'video')
    await page.waitForTimeout(5000)
    await expect(show).toHaveAttribute('data-scene', 'video')
  })

  test('the preview with reduced motion: nothing moves, the scenes change only by the segment', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openCloud(page, 'appstore')
    const show = page.getByTestId('m-cloud-showcase')
    await expect(show).toHaveAttribute('data-still', '')
    const moving = await page.evaluate(() => document.getAnimations().filter((a) => ((a.effect as KeyframeEffect | null)?.target as Element | null)?.closest?.('[data-testid="m-cloud-showcase"]')).length)
    expect(moving).toBe(0)
    await page.waitForTimeout(5000)
    await expect(show).toHaveAttribute('data-scene', 'chat')
    await page.getByTestId('m-cloud-showcase-image').tap()
    await expect(show).toHaveAttribute('data-scene', 'image')
    // The App Store build names no count in the preview either.
    expect(await show.innerText()).not.toMatch(/\d+ models/)
  })
})
