import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from './support/cloud-mock'

/**
 * 10.10.2026: every picture the app made, on this machine or in the
 * cloud, shows the prompt it was made from when it is opened, with a button
 * that copies it. Until now the prompt was saved with every result and shown
 * nowhere, except for a run that "Improve my prompt" had rewritten. The panel
 * is the web app's: folded under the picture on the stage, unfolded in the
 * large view, which a click on the picture opens.
 *
 * Three ways a result comes into being are walked here: the local engine on
 * Windows (a saved gallery), the Mac's own engine (a real run against the
 * mocked engine) and the cloud (a real run against the mocked server). The
 * chat's big view is in cloud-create-in-chat.spec.ts.
 */

// Taller than any window, so the lightbox has to fit it above the prompt.
const PICTURE = '<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="3000"><rect width="2000" height="3000" fill="#a33"/></svg>'
const BASE: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME }

// The stage of a result: since the result is fitted to the stage (FitStage),
// the picture and the facts under it are siblings in their column, so the
// big view is the stage that holds the facts, not the parent of the facts.
const bigView = (page: Page) => page.getByTestId('fit-stage').filter({ has: page.getByTestId('result-facts') })
const lightbox = (page: Page) => page.locator('.fixed.inset-0').filter({ has: page.locator('img, video') }).last()
// D9 (3.0.7): a result that carries settings folds them in with its prompt.
const FOLD = 'Prompt and settings'
// "Copy prompt and settings" stands in the same panel; the name must match whole.
const COPY_PROMPT = { name: 'Copy prompt', exact: true } as const

async function openFullscreen(page: Page) {
  await bigView(page).locator('.group').first().hover()
  await page.getByTitle('Fullscreen').click()
}

const item = (id: string, filename: string, prompt: string, extra: Record<string, unknown> = {}) => ({
  id, type: 'image', filename, subfolder: '', prompt, negativePrompt: '',
  model: 'juggernautXL.safetensors', modelType: 'sdxl', seed: 7, steps: 20, cfgScale: 7, sampler: 'euler',
  scheduler: 'simple', width: 512, height: 512, batchSize: 1, createdAt: Date.now(), ...extra,
})

test('local engine: a result shows its prompt in the big view and in the lightbox, and Copy copies it', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.addInitScript(tauriMockInit, { ...BASE, platform: 'windows' as const })
  await seedOnboardingDone(page)
  const LONG = 'a red apple on a plate, ' + 'soft morning light, shallow depth of field, '.repeat(30) + 'the end'
  await page.addInitScript(([gallery]) => {
    localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', gallery }, version: 2 }))
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown>) => Promise<unknown> } }
    const invoke = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (command, args) => {
      const url = String(args?.url ?? '')
      if (command === 'proxy_localhost' && url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [] }))
      return invoke(command, args)
    }
  }, [[
    item('g1', 'apple_00001_.png', LONG, { createdAt: Date.now() }),
    // An entry that never saved a prompt, and a cutout, which has none.
    item('g2', 'old_00001_.png', '', { createdAt: Date.now() - 1000 }),
    item('g3', 'cutout_00001_.png', 'Background removed', { createdAt: Date.now() - 2000, intent: 'removebg', label: 'Background removed' }),
  ]] as const)
  await page.route('**/view?**', (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: PICTURE }))
  await page.goto('/')
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  const tiles = page.locator('aside').filter({ hasText: 'Gallery' }).locator('.group')
  await expect(tiles).toHaveCount(3)

  // Under the picture on the stage: folded, one click unfolds it.
  await tiles.nth(0).click()
  const under = bigView(page).getByTestId('prompt-details')
  await expect(under.getByText(FOLD, { exact: true })).toBeVisible()
  await expect(under.getByTestId('prompt-text')).toBeHidden()
  await under.getByText(FOLD, { exact: true }).click()
  await expect(under.getByTestId('prompt-text')).toBeVisible()
  await expect(under.getByTestId('prompt-text')).toHaveText(LONG.trim())
  // Unfolded, the prompt is on screen: the stage gives it the room or scrolls to it.
  await under.getByTestId('prompt-text').scrollIntoViewIfNeeded()
  await expect(under.getByTestId('prompt-text')).toBeInViewport()
  await under.getByRole('button', COPY_PROMPT).click()
  await expect(under.getByRole('button', COPY_PROMPT)).toHaveText('Copied')
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(LONG.trim())

  // The lightbox: the same box, under the picture and never on it, and the
  // whole of it inside the window even for a long prompt. It opens folded as
  // on the stage (3.0.8, fix/308-bugs-runde2); one click unfolds it.
  // A click on the picture opens it.
  await bigView(page).locator('img').first().click()
  const box = lightbox(page).getByTestId('prompt-details')
  await expect(box.getByTestId('prompt-text')).toBeHidden()
  await box.getByText(FOLD, { exact: true }).click()
  await expect(box.getByTestId('prompt-text')).toBeVisible()
  await expect(box.getByTestId('prompt-text')).toHaveText(LONG.trim())
  const picture = (await lightbox(page).locator('img').boundingBox())!
  const details = (await box.boundingBox())!
  const view = page.viewportSize()!
  expect(picture.height).toBeGreaterThan(200)
  expect(picture.y).toBeGreaterThanOrEqual(0)
  expect(details.y).toBeGreaterThanOrEqual(picture.y + picture.height)
  expect(details.y + details.height).toBeLessThanOrEqual(view.height)
  await page.evaluate(() => navigator.clipboard.writeText(''))
  await box.getByRole('button', COPY_PROMPT).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(LONG.trim())
  // Copying and selecting do not close the view; Escape does.
  await box.getByTestId('prompt-text').click()
  await expect(box).toBeVisible()
  if (process.env.LU_SHOTS) await page.waitForTimeout(600)
  if (process.env.LU_SHOTS) await page.screenshot({ path: `${process.env.LU_SHOTS}/lightbox-prompt.png` })
  await page.keyboard.press('Escape')
  await expect(box).toHaveCount(0)

  // No prompt saved: the picture, and no box with a made-up text.
  for (const n of [1, 2]) {
    await tiles.nth(n).click()
    await expect(page.getByTestId('result-facts')).toBeVisible()
    await expect(page.getByTestId('prompt-details')).toHaveCount(0)
    await openFullscreen(page)
    await expect(lightbox(page).locator('img')).toBeVisible()
    await expect(page.getByTestId('prompt-details')).toHaveCount(0)
    await page.keyboard.press('Escape')
  }
})

test('mac: a picture made by the local engine carries its prompt into the big view and the lightbox', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { ...BASE, platform: 'mac' as const })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeVisible({ timeout: 15_000 })

  await page.locator('textarea').first().fill('a red apple on a wooden table')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible({ timeout: 30_000 })

  await expect(bigView(page).getByTestId('prompt-text')).toHaveText('a red apple on a wooden table')
  await openFullscreen(page)
  // Folded, as on the stage (3.0.8); one click unfolds it.
  await expect(lightbox(page).getByTestId('prompt-text')).toBeHidden()
  await lightbox(page).getByText(FOLD, { exact: true }).click()
  await expect(lightbox(page).getByTestId('prompt-text')).toBeVisible()
  await expect(lightbox(page).getByTestId('prompt-text')).toHaveText('a red apple on a wooden table')
  await expect(lightbox(page).getByRole('button', COPY_PROMPT)).toBeVisible()
})

test('cloud: a picture made in the cloud carries its prompt into the big view and the lightbox', async ({ page }) => {
  await page.addInitScript(tauriMockInit, BASE)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()

  await page.locator('textarea').first().fill('a lighthouse at dusk, cinematic')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.locator('img[src*="/e2e/result.png"]').first()).toBeVisible({ timeout: 30_000 })

  await expect(bigView(page).getByTestId('prompt-text')).toHaveText('a lighthouse at dusk, cinematic')
  await openFullscreen(page)
  // Folded, as on the stage (3.0.8); one click unfolds it.
  await expect(lightbox(page).getByTestId('prompt-text')).toBeHidden()
  await lightbox(page).getByText(FOLD, { exact: true }).click()
  await expect(lightbox(page).getByTestId('prompt-text')).toBeVisible()
  await expect(lightbox(page).getByTestId('prompt-text')).toHaveText('a lighthouse at dusk, cinematic')
  await expect(lightbox(page).getByRole('button', COPY_PROMPT)).toBeVisible()
})
