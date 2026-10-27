/**
 * Smoke test of the mobile shell (src/mobile), in a browser without Tauri.
 *
 * The shell loads behind the developer switch `?mobile=1`; the platform seam
 * falls back to its web stand ins. Checked in two phone sizes: the shell
 * loads, the four tabs switch, a sheet opens and closes with back, /dev/ui
 * renders, nothing sticks out sideways, no target is smaller than 44 px and
 * the console stays free of errors.
 */
import { expect, test } from '@playwright/test'
import { SIZES, measureLayout, openShell, watchErrors } from './support'

for (const size of SIZES) {
  test.describe(`mobile shell ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height } })

    test('loads into a new chat, and back leads to the chat list with the tab bar', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page)

      // A cold start lands in a new chat with the list one step back (DESIGN.md 2.2).
      await expect(page.getByTestId('m-chat-screen')).toBeVisible()
      await expect(page.locator('html')).toHaveAttribute('data-shell', 'mobile')
      // A pushed page has no tab bar.
      await expect(page.getByTestId('m-nav')).toHaveCount(0)
      expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })

      await page.goBack()
      await expect(page.getByTestId('m-chats-screen')).toBeVisible()
      await expect(page.getByTestId('m-chat-screen')).toHaveCount(0)
      await expect(page.getByTestId('m-nav')).toBeVisible()
      expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
      expect(errors()).toEqual([])
    })

    // Check on the iPhone, round 23, N14: right after a model arrived the first tap on "Chat" reached the page as a
    // touch and no click followed. The tab bar takes a touch on lift-off, so the tap is not lost.
    test('a tap on a tab switches although the browser sends no click after it', async ({ page }) => {
      await openShell(page)
      await page.getByTestId('m-page-back').tap()
      await expect(page.getByTestId('m-chats-screen')).toBeVisible()
      await page.evaluate(() => {
        window.addEventListener(
          'click',
          (event) => {
            if (event.target instanceof Element && event.target.closest('[data-testid^="m-nav-"]')) event.stopImmediatePropagation()
          },
          true,
        )
      })
      await page.getByTestId('m-nav-models').tap()
      await expect(page.getByTestId('m-models-screen')).toBeVisible()
      await expect(page.getByTestId('m-nav-models')).toHaveAttribute('aria-selected', 'true')
      await page.getByTestId('m-nav-chat').tap()
      await expect(page.getByTestId('m-chats-screen')).toBeVisible()
    })

    test('the four tabs switch and back from a tab root returns to Chat', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page)
      await page.getByTestId('m-page-back').tap()
      await expect(page.getByTestId('m-chats-screen')).toBeVisible()

      for (const [tab, screen] of [
        ['create', 'm-create-screen'],
        ['models', 'm-models-screen'],
        ['settings', 'm-settings-screen'],
        ['chat', 'm-chats-screen'],
      ] as const) {
        await page.getByTestId(`m-nav-${tab}`).tap()
        await expect(page.getByTestId(screen)).toBeVisible()
        await expect(page.getByTestId(`m-nav-${tab}`)).toHaveAttribute('aria-selected', 'true')
        expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
      }

      // From the root of another tab, back goes to the Chat tab, not out of the app.
      await page.getByTestId('m-nav-settings').tap()
      await expect(page.getByTestId('m-settings-screen')).toBeVisible()
      await page.goBack()
      await expect(page.getByTestId('m-chats-screen')).toBeVisible()
      await expect(page.getByTestId('m-nav-chat')).toHaveAttribute('aria-selected', 'true')
      expect(errors()).toEqual([])
    })

    test('a sheet opens, back closes its sub page, then the sheet, then the page', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page, { route: '/dev/ui' })
      await expect(page.getByTestId('m-dev-ui-screen')).toBeVisible()

      await page.getByTestId('m-dev-ui-open-sheet').tap()
      const sheet = page.getByTestId('m-sheet-dev-demo')
      await expect(sheet).toBeVisible()
      await expect(sheet).toHaveAttribute('role', 'dialog')
      await expect(sheet).toHaveAttribute('aria-modal', 'true')
      expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })

      await page.getByTestId('m-dev-sheet-sub').tap()
      await expect(page.getByTestId('m-sheet-back')).toBeVisible()
      await page.goBack()
      await expect(page.getByTestId('m-sheet-back')).toHaveCount(0)
      await expect(sheet).toBeVisible()

      await page.goBack()
      await expect(sheet).toHaveCount(0)
      await expect(page.getByTestId('m-dev-ui-screen')).toBeVisible()

      // The scrim closes it too, and so does the Close button.
      await page.getByTestId('m-dev-ui-open-sheet').tap()
      await expect(sheet).toBeVisible()
      await page.getByTestId('m-sheet-close').tap()
      await expect(sheet).toHaveCount(0)

      await page.goBack()
      await expect(page.getByTestId('m-dev-ui-screen')).toHaveCount(0)
      expect(errors()).toEqual([])
    })

    test('a dialog answers with the safe choice on back', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page, { route: '/dev/ui' })
      await page.getByTestId('m-dev-ui-dialog').tap()
      const dialog = page.getByTestId('m-dialog-demo')
      await expect(dialog).toBeVisible()
      await expect(dialog).toHaveAttribute('role', 'alertdialog')
      // The safe answer holds the focus.
      await expect(page.getByTestId('m-dialog-cancel')).toBeFocused()
      expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })
      await page.goBack()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('m-toast')).toHaveText('Kept')
      expect(errors()).toEqual([])
    })

    // Check Android package 11, T1: "Memory saved" outlived the switch to Models and lay on "Download".
    test('a toast goes when a tab is tapped', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page, { route: '/dev/ui' })
      await page.getByTestId('m-dev-ui-dialog').tap()
      await expect(page.getByTestId('m-dialog-demo')).toBeVisible()
      await page.goBack()
      const toastBox = page.getByTestId('m-toast')
      await expect(toastBox).toHaveText('Kept')
      const shownAt = Date.now()
      // Back to a tab root, where the tab bar is (the shell opens /dev/ui on top of a new chat).
      for (let i = 0; i < 3 && !(await page.getByTestId('m-nav').isVisible()); i++) {
        await page.goBack()
        await page.waitForTimeout(150)
      }
      await expect(page.getByTestId('m-nav')).toBeVisible()
      await expect(toastBox).toBeVisible()
      await page.getByTestId('m-nav-models').tap()
      // Well inside the 3 s of the toast: without the fix it would still be there.
      expect(Date.now() - shownAt).toBeLessThan(2200)
      await expect(toastBox).toHaveCount(0, { timeout: 400 })
      expect(errors()).toEqual([])
    })

    test('/dev/ui renders every component section without overflow or small targets', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page, { route: '/dev/ui' })
      for (const id of ['button', 'iconbutton', 'segmented', 'chip', 'switch', 'list', 'field', 'slider', 'progress', 'notice', 'card', 'empty', 'skeleton', 'composer', 'overlays', 'type', 'risk', 'fold', 'permission', 'layout', 'middle', 'markdown']) {
        await expect(page.getByTestId(`m-dev-ui-sec-${id}`)).toBeAttached()
      }
      expect(await measureLayout(page)).toEqual({ overflow: [], small: [], pageScrolls: false })

      // States carry their ARIA, not only a colour.
      await expect(page.getByTestId('m-dev-ui-switch')).toHaveAttribute('aria-checked', 'true')
      await page.getByTestId('m-dev-ui-switch').tap()
      await expect(page.getByTestId('m-dev-ui-switch')).toHaveAttribute('aria-checked', 'false')
      await expect(page.getByTestId('m-dev-ui-chip-fits')).toHaveAttribute('aria-pressed', 'true')
      await page.getByTestId('m-dev-ui-chip-vision').tap()
      await expect(page.getByTestId('m-dev-ui-chip-vision')).toHaveAttribute('aria-pressed', 'true')
      await expect(page.getByTestId('m-dev-ui-radio-standard')).toHaveAttribute('aria-checked', 'true')
      await page.getByTestId('m-dev-ui-radio-off').tap()
      await expect(page.getByTestId('m-dev-ui-radio-off')).toHaveAttribute('aria-checked', 'true')
      await expect(page.getByTestId('m-dev-ui-radio-standard')).toHaveAttribute('aria-checked', 'false')
      expect(errors()).toEqual([])
    })

    test('every placeholder page and sheet opens from the index and closes with back', async ({ page }) => {
      test.setTimeout(180_000)
      const errors = watchErrors(page)
      await openShell(page, { route: '/dev/routes' })
      const index = page.getByTestId('m-dev-routes-screen')
      await expect(index).toBeVisible()

      const pages = await page.locator('[data-testid^="m-dev-route-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
      expect(pages.length).toBeGreaterThan(50)
      for (const id of pages) {
        if (id === 'm-dev-route-dev-routes') continue
        const screen = `m-${id.replace('m-dev-route-', '')}-screen`
        await page.getByTestId(id).tap()
        await expect(page.getByTestId(screen), screen).toBeVisible()
        expect(await measureLayout(page), screen).toEqual({ overflow: [], small: [], pageScrolls: false })
        await page.goBack()
        await expect(index, `back from ${screen}`).toBeVisible()
      }

      const sheets = await page.locator('[data-testid^="m-dev-sheet-open-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid') ?? ''))
      expect(sheets.length).toBeGreaterThan(10)
      for (const id of sheets) {
        const sheet = `m-sheet-${id.replace('m-dev-sheet-open-', '')}`
        await page.getByTestId(id).tap()
        await expect(page.getByTestId(sheet), sheet).toBeVisible()
        expect(await measureLayout(page), sheet).toEqual({ overflow: [], small: [], pageScrolls: false })
        await page.goBack()
        await expect(page.getByTestId(sheet), `back from ${sheet}`).toHaveCount(0)
      }
      expect(errors()).toEqual([])
    })

    test('a first start shows the onboarding without the tab bar', async ({ page }) => {
      const errors = watchErrors(page)
      await openShell(page, { skipOnboarding: false })
      await expect(page.getByTestId('m-onboarding-screen')).toBeVisible()
      await expect(page.getByTestId('m-nav')).toHaveCount(0)
      // The first step has no back arrow and no history entry: back would leave the app.
      await expect(page.getByTestId('m-page-back')).toHaveCount(0)
      expect(await page.evaluate(() => history.state)).toBeNull()
      expect(errors()).toEqual([])
    })
  })
}

test('the desktop shell loads without the switch', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).not.toHaveAttribute('data-shell', 'mobile')
  await expect(page.getByTestId('m-app')).toHaveCount(0)
})
