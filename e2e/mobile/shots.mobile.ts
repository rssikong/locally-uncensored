/**
 * Screenshots of the real shell, for looking at it next to the prototype
 * (mobile-docs/design/mock) and DESIGN.md.
 *
 * Not part of a normal run: it writes images into the repo. Run it with
 *   LU_MOBILE_SHOTS=1 npx playwright test --project=mobile shots
 * Output: mobile-docs/design/shell-shots/<size>-<theme>-<text>--<view>.png
 * Sizes 390x844 and 320x568, dark and light, text at 100 and 200 percent,
 * plus one landscape set.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'
import { measureLayout, openShell, screensLoaded } from './support'

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../mobile-docs/design/shell-shots')

const VARIANTS = [
  { size: '390x844', width: 390, height: 844, theme: 'dark', fs: 100 },
  { size: '390x844', width: 390, height: 844, theme: 'light', fs: 100 },
  { size: '390x844', width: 390, height: 844, theme: 'dark', fs: 200 },
  { size: '390x844', width: 390, height: 844, theme: 'light', fs: 200 },
  { size: '320x568', width: 320, height: 568, theme: 'dark', fs: 100 },
  { size: '320x568', width: 320, height: 568, theme: 'light', fs: 100 },
  { size: '320x568', width: 320, height: 568, theme: 'dark', fs: 200 },
  { size: '320x568', width: 320, height: 568, theme: 'light', fs: 200 },
  { size: '844x390', width: 844, height: 390, theme: 'dark', fs: 100 },
] as const

async function settle(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready
    const finite = document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime ?? Infinity))
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)))
  })
}

test.describe('shell screenshots', () => {
  test.skip(!process.env.LU_MOBILE_SHOTS, 'set LU_MOBILE_SHOTS=1 to write the screenshots')
  test.use({ deviceScaleFactor: 1 })

  for (const v of VARIANTS) {
    test(`${v.size} ${v.theme} ${v.fs}`, async ({ page }) => {
      test.setTimeout(180_000)
      const problems: string[] = []
      const name = (view: string) => path.join(OUT, `${v.size}-${v.theme}-${v.fs}--${view}.png`)
      const shot = async (view: string) => {
        await screensLoaded(page)
        await settle(page)
        const layout = await measureLayout(page)
        if (layout.overflow.length || layout.small.length || layout.pageScrolls) problems.push(`${view}: ${JSON.stringify(layout)}`)
        await page.screenshot({ path: name(view) })
      }
      await page.setViewportSize({ width: v.width, height: v.height })
      const options = { theme: v.theme, fontScale: v.fs }

      // The four roots with the tab bar (or the rail in landscape), and a pushed page.
      await openShell(page, options)
      await shot('chat-page')
      await page.getByTestId('m-page-back').tap()
      await shot('root-chats')
      await page.getByTestId('m-nav-settings').tap()
      await shot('root-settings')

      // The catalogue, one window height at a time.
      await openShell(page, { ...options, route: '/dev/ui' })
      const body = page.locator('[data-testid="m-dev-ui-screen"] .m-body')
      const pages = await body.evaluate((el) => Math.ceil(el.scrollHeight / el.clientHeight))
      for (let i = 0; i < pages; i++) {
        await body.evaluate((el, n) => el.scrollTo(0, n * (el.clientHeight - 24)), i)
        await shot(`ui-${String(i + 1).padStart(2, '0')}`)
      }

      // Sheet, sub page of the sheet, dialogs, toast.
      await body.evaluate((el) => el.scrollTo(0, 0))
      await page.getByTestId('m-dev-ui-open-sheet').tap()
      await expect(page.getByTestId('m-sheet-dev-demo')).toBeVisible()
      await shot('sheet')
      await page.getByTestId('m-dev-sheet-sub').tap()
      await shot('sheet-sub')
      await page.goBack()
      await page.getByTestId('m-dev-sheet-confirm').tap()
      await expect(page.getByTestId('m-dialog-demo')).toBeVisible()
      await shot('dialog-over-sheet')
      await page.goBack()
      await expect(page.getByTestId('m-toast')).toBeVisible()
      await shot('toast-over-sheet')
      await page.goBack()
      await page.getByTestId('m-dev-ui-sec-overlays').scrollIntoViewIfNeeded()
      await page.getByTestId('m-dev-ui-prompt').tap()
      await expect(page.getByTestId('m-dialog-rename')).toBeVisible()
      await shot('dialog-rename')
      await page.goBack()
      await page.getByTestId('m-dev-ui-toast-action').tap()
      await shot('toast-action')

      // First start.
      await openShell(page, { ...options, skipOnboarding: false })
      await shot('onboarding-first')

      expect(problems).toEqual([])
    })
  }
})
