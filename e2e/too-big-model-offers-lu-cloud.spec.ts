import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch, cloudSwitchBehindModal, type CloudScenario } from './support/cloud-mock'
import { giveMachineMemory } from './support/mac-memory'

/**
 * 3.0.7, the owner's wish of 15.10.2026: a model in the Model Manager that is
 * too big for this graphics card says there that LU Cloud runs the task, with
 * one button. The click goes the way the model picker's LU Cloud rows go: the
 * cloud gate, which shows the plans to an account without one and switches an
 * account that can use the cloud straight over, into Create on the same tab
 * for a media model.
 *
 * A Windows machine with a 12 GB card, so the catalogue has tiles on both
 * sides of the line.
 *
 * Run: LU_E2E_PORT=5391 npx playwright test e2e/too-big-model-offers-lu-cloud.spec.ts
 */
const PC: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'windows' }

async function boot(page: Page, scenario: CloudScenario) {
  await page.addInitScript(tauriMockInit, PC)
  await giveMachineMemory(page, { ramGb: 32, vramGb: 12 })
  await seedOnboardingDone(page)
  await routeCloud(page, scenario)
  await page.setViewportSize({ width: 1296, height: 808 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
}

async function openModels(page: Page) {
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  const pane = page.getByTestId('models-pane')
  await expect(pane.locator('[data-model-tile]').first()).toBeVisible({ timeout: 30_000 })
  return pane
}

test('a chat model too big for the card names LU Cloud, one that fits does not', async ({ page }) => {
  await boot(page, { license: 'none' })
  const pane = await openModels(page)
  const offers = pane.getByTestId('cloud-offer-tile')
  await expect(offers.first()).toBeVisible()
  await expect(offers.first()).toContainText('Too big for this graphics card. Large chat models run on LU Cloud.')

  // Every tile with the line is one the verdict calls too big, and the
  // catalogue has tiles that fit and carry no line.
  const report = await pane.evaluate((el) => {
    const tiles = [...el.querySelectorAll<HTMLElement>('[data-model-tile]')]
    const withOffer = tiles.filter((t) => t.querySelector('[data-testid="cloud-offer-tile"]'))
    return {
      tiles: tiles.length,
      offers: withOffer.length,
      offersNotBig: withOffer.filter((t) => !t.querySelector('[data-fit="big"]')).map((t) => t.dataset.modelTile),
      // The line and its button stay inside the tile.
      outside: withOffer.filter((t) => {
        const b = t.querySelector<HTMLElement>('[data-testid="cloud-offer-button"]')!.getBoundingClientRect()
        const e = t.getBoundingClientRect()
        return b.right > e.right - 1 || b.left < e.left + 1
      }).map((t) => t.dataset.modelTile),
    }
  })
  expect(report.offers).toBeGreaterThan(0)
  expect(report.offers).toBeLessThan(report.tiles)
  expect(report.offersNotBig).toEqual([])
  expect(report.outside).toEqual([])
  // No money amount on the line, and no number while the price is not known.
  await expect(offers.first()).not.toContainText(/€|EUR|credits/)

  // The click opens the cloud gate, the switch stays on Local.
  await offers.first().getByRole('button', { name: 'Try LU Cloud' }).click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 15_000 })
  await expect(cloudSwitchBehindModal(page)).toHaveAttribute('aria-checked', 'false')
})

test('an account that can use the cloud goes from a too big video model to Create in cloud mode, on Video', async ({ page }) => {
  await boot(page, { license: 'active', access: true, mediaLive: true })
  // Signed in with a plan, then back on Local, as a customer who works locally.
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
  await cloudSwitch(page).click()
  await expect(cloudSwitch(page)).toHaveAttribute('aria-checked', 'false')
  const pane = await openModels(page)
  await page.getByRole('button', { name: 'Video', exact: true }).first().click()
  const offer = pane.getByTestId('cloud-offer-tile').filter({ hasText: 'Videos run on LU Cloud.' }).first()
  await expect(offer).toBeVisible({ timeout: 30_000 })
  await expect(offer).toContainText('Too big for this graphics card.')
  // Only bundles the card verdict calls too big, never an add-on.
  const wrong = await pane.evaluate((el) => [...el.querySelectorAll<HTMLElement>('[data-bundle-tile]')]
    .filter((t) => t.querySelector('[data-testid="cloud-offer-tile"]'))
    .filter((t) => t.querySelector('[data-bundle-addon-for]') || !t.querySelector('[data-bundle-fit="big"]'))
    .map((t) => t.dataset.bundleTile))
  expect(wrong).toEqual([])
  await offer.getByRole('button', { name: 'Try LU Cloud' }).click()

  await expect(cloudSwitch(page)).toHaveAttribute('aria-checked', 'true', { timeout: 15_000 })
  const tab = page.getByRole('radio', { name: /^(Video|Animate Image)$/ }).and(page.locator('[aria-checked="true"]'))
  await expect(tab).toBeVisible({ timeout: 15_000 })
  // In cloud mode no tile and no Create line names LU Cloud.
  await expect(page.getByTestId('cloud-offer-create')).toHaveCount(0)
})
