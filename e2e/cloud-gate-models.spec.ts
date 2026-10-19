import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch } from './support/cloud-mock'

/**
 * 3.0.7: the gate pop-up shows the models behind the switch. Signed out, the
 * sales panel carries three dropdowns (Chat, Code, Create) in the app's own
 * Cloud picker; a row opens the two ways in, each one button to the
 * checkout with the model.
 *
 * Lauf: LU_E2E_PORT=5284 npx playwright test e2e/cloud-gate-models.spec.ts
 */

const catalogue = {
  version: 1,
  generatedAt: '2026-10-18T00:00:00Z',
  categories: {
    chat: [
      { id: 'moonshotai/Kimi-K3', label: 'Kimi K3', plans: ['hosted'] },
      { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B', plans: ['hosted'] },
    ],
    code: [{ id: 'moonshotai/Kimi-K3', label: 'Kimi K3', plans: ['hosted'] }],
    create: [
      { id: 'flux-dev', label: 'Flux Dev (quality)', kind: 'image', plans: ['hosted'] },
      { id: 'wan-2.2-720p', label: 'Wan 2.2 720p', kind: 'video', plans: ['hosted'] },
      { id: 'qwen-image-2.1-edit', label: 'Qwen Image 2.1', kind: 'edit', plans: ['hosted'] },
    ],
  },
  offers: {
    plans: [{ tier: 'hosted', interval: 'month', eur: 19, credits: 1, images: 3000, clips: 112 }],
    packs: [{ id: 'pack-15', eur: 15, credits: 1, images: 1500, clips: 56 }],
  },
}

async function boot(page: Page, live: boolean) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'none' })
  let header: string | undefined
  await page.route('**/api/public/cloud-catalog', (route) => {
    header = route.request().headers()['x-lu-client']
    return live
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(catalogue) })
      : route.fulfill({ status: 404, body: '' })
  })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await cloudSwitch(page).click()
  await expect(page.getByTestId('cloud-sales-panel')).toBeVisible({ timeout: 20_000 })
  return () => header
}

test('three dropdowns, a row opens the two ways, each one button to the checkout', async ({ page }) => {
  const header = await boot(page, true)
  await expect(page.getByTestId('gate-dropdown-chat')).toContainText('2 models')
  expect(header()).toBe('desktop')
  await page.screenshot({ path: 'test-results/gate-models-panel.png' })

  await page.getByTestId('gate-dropdown-create').click()
  const menu = page.getByTestId('gate-menu-create')
  await expect(menu.getByText('Flux Dev (quality)')).toBeVisible()
  await menu.locator('[data-chip="video"]').click()
  await expect(menu.getByText('Wan 2.2 720p')).toBeVisible()
  await expect(menu.locator('[data-chip="video"]')).toHaveAttribute('aria-pressed', 'true')
  await expect(menu.locator('[data-chip="image"]')).toHaveAttribute('aria-pressed', 'false')
  await page.screenshot({ path: 'test-results/gate-models-create-menu.png' })
  await menu.getByText('Wan 2.2 720p').click()

  const win = page.getByTestId('gate-buy-window')
  await expect(win).toBeVisible()
  await expect(page.getByTestId('gate-offer-sub')).toHaveText('€19 a month, about 3,000 images or 112 clips each month')
  await expect(page.getByTestId('gate-offer-credits')).toHaveText('€15 once, about 1,500 images or 56 clips')
  await page.screenshot({ path: 'test-results/gate-models-buy-window.png' })

  await page.getByTestId('gate-checkout-credits').click()
  const opened = await page.evaluate(() => (window as unknown as { __E2E_OPENED_URLS__?: string[] }).__E2E_OPENED_URLS__ ?? [])
  const url = new URL(opened.find((u) => u.includes('/checkout/start'))!)
  expect(url.searchParams.get('pack')).toBe('pack-15')
  expect(url.searchParams.get('src')).toBe('app-gate')
  expect(url.searchParams.get('model')).toBe('wan-2.2-720p')
  expect(url.searchParams.get('category')).toBe('create')

  // Escape in the menu closes only the menu, the gate stays.
  await page.getByRole('button', { name: 'Back' }).click()
  await page.getByTestId('gate-dropdown-chat').click()
  await expect(page.getByTestId('gate-menu-chat')).toBeVisible()
  await page.screenshot({ path: 'test-results/gate-models-chat-menu.png' })
  // As wide as the Cloud mode picker, not as wide as its longest row.
  expect(await page.getByTestId('gate-menu-chat').evaluate((el) => el.style.width)).toBe('400px')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('gate-menu-chat')).toBeHidden()
  await expect(page.getByTestId('cloud-sales-panel')).toBeVisible()
})

test('without an answer the snapshot fills the lists and no figure is shown', async ({ page }) => {
  await boot(page, false)
  await page.getByTestId('gate-dropdown-chat').click()
  const rows = page.getByTestId('gate-menu-chat').getByRole('option')
  expect(await rows.count()).toBeGreaterThan(10)
  await rows.first().locator('button').first().click()
  await expect(page.getByTestId('gate-buy-window')).toBeVisible()
  await expect(page.getByTestId('gate-offer-sub')).toHaveCount(0)
  await expect(page.getByTestId('gate-checkout-sub')).toBeVisible()
})
