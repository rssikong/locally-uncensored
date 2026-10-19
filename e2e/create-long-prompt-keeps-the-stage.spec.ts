import { test, expect, type Locator, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch } from './support/cloud-mock'
import { gradientPng } from './support/png'
import { bootWithFakeComfy } from './support/fake-comfy'

/**
 * Discord report (3.0.7): with a long prompt the progress of an image or
 * video run was not to be seen, and the finished result could not be looked
 * at. The prompt field grew to its own cap of 220 px (253 px on screen at the
 * app's scale) whatever the window, and the stage above it, which holds the
 * progress and the result, kept what was left: 143 px in a 1024x700 window,
 * with the step line of the run cut off at its foot.
 *
 * The field now grows to a share of the window and scrolls beyond it, so the
 * stage keeps room for the progress and the result in a small window too.
 */

const LONG = 'a red apple on a wooden plate, soft morning light through a kitchen window, shallow depth of field, '.repeat(40)
const WINDOWS_SIZES = [{ width: 1280, height: 720 }, { width: 1024, height: 700 }]
const CHECKPOINT = 'juggernautXL.safetensors'
const BASE: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME }
const MAC: TauriMockOptions = {
  ...BASE,
  platform: 'mac',
  mlx: { installedImages: ['qwen-image-2.1-8bit'], mfluxEngineInstalled: true },
}

async function bootMacCreate(page: Page, opts: TauriMockOptions) {
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: /^Create$/ }).click()
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeVisible({ timeout: 15_000 })
}

/** The whole of `inner` lies inside `outer`. */
async function expectInside(inner: Locator, outer: Locator) {
  const a = (await inner.boundingBox())!
  const b = (await outer.boundingBox())!
  expect(a, 'element is laid out').toBeTruthy()
  expect(a.y).toBeGreaterThanOrEqual(b.y - 0.5)
  expect(a.y + a.height).toBeLessThanOrEqual(b.y + b.height + 0.5)
  expect(a.x).toBeGreaterThanOrEqual(b.x - 0.5)
  expect(a.x + a.width).toBeLessThanOrEqual(b.x + b.width + 0.5)
}

/** The prompt field holds the long text by scrolling, not by growing on. */
async function expectFieldScrolls(page: Page) {
  const field = page.locator('textarea').first()
  const { client, scroll } = await field.evaluate((el) => ({ client: el.clientHeight, scroll: el.scrollHeight }))
  expect(scroll).toBeGreaterThan(client)
  // The end of what was typed can be reached inside the field.
  await field.evaluate((el) => { el.scrollTop = el.scrollHeight })
  expect(await field.evaluate((el) => Math.ceil(el.scrollTop + el.clientHeight) >= el.scrollHeight - 1)).toBe(true)
}

for (const size of WINDOWS_SIZES) {
  test(`${size.width}x${size.height}: with a long prompt the progress of a run stays on the stage`, async ({ page }) => {
    await page.setViewportSize(size)
    await bootMacCreate(page, { ...MAC, mlx: { ...MAC.mlx, imageGenerateWaits: true } })
    await page.locator('textarea').first().fill(LONG)
    await expectFieldScrolls(page)
    await page.getByRole('button', { name: /^Create$/ }).last().click()

    const step = page.getByText('Step 3/25').first()
    await expect(step).toBeVisible({ timeout: 15_000 })
    await expect(step).toBeInViewport({ ratio: 1 })
    // Not cut off at the stage's foot: the stage clips what it cannot hold.
    await expectInside(step, page.getByTestId('create-stage'))
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  })

  test(`${size.width}x${size.height}: with a long prompt the finished picture can be looked at`, async ({ page }) => {
    await page.setViewportSize(size)
    await bootMacCreate(page, { ...MAC, mlx: { ...MAC.mlx, imageBase64: gradientPng(1024, 1024).toString('base64') } })
    await page.locator('textarea').first().fill(LONG)
    await page.getByRole('button', { name: /^Create$/ }).last().click()

    const picture = page.getByTestId('create-stage').locator('img[src^="data:image/png"]').first()
    await expect(picture).toBeVisible({ timeout: 30_000 })
    if (process.env.LU_SHOTS) await page.screenshot({ path: `${process.env.LU_SHOTS}/long-prompt-result-${size.width}.png` })
    await expect(picture).toBeInViewport({ ratio: 1 })
    await expectInside(picture, page.getByTestId('create-stage'))
    // Large enough to see what was made, not a strip.
    const box = (await picture.boundingBox())!
    expect(box.height).toBeGreaterThanOrEqual(120)
    // The prompt is still there to work on, and it scrolls.
    await expect(page.locator('textarea').first()).toHaveValue(LONG)
    await expectFieldScrolls(page)
  })
}

test('windows local: a long prompt leaves the stage its room for the result shown there', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.addInitScript(([gallery, model]) => {
    localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', imageModel: model, gallery }, version: 2 }))
  }, [[{
    id: 'g1', type: 'image', filename: 'apple_00001_.png', subfolder: '', prompt: 'an apple', negativePrompt: '',
    model: CHECKPOINT, modelType: 'sdxl', seed: 7, steps: 20, cfgScale: 7, sampler: 'euler',
    scheduler: 'simple', width: 1024, height: 1024, batchSize: 1, createdAt: Date.now(),
  }], CHECKPOINT] as const)
  await bootWithFakeComfy(page, { checkpoints: [CHECKPOINT], loras: [], imageModel: CHECKPOINT })
  const png = gradientPng(1024, 1024)
  await page.route('**/view?**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
  await page.goto('/')
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  await page.locator('aside').filter({ hasText: 'Gallery' }).locator('.group').first().click()
  const picture = page.getByTestId('create-stage').locator('img').first()
  await expect(picture).toBeVisible({ timeout: 15_000 })

  await page.locator('textarea').first().fill(LONG)
  if (process.env.LU_SHOTS) await page.screenshot({ path: `${process.env.LU_SHOTS}/long-prompt-windows.png` })
  await expectFieldScrolls(page)
  await expect(picture).toBeInViewport({ ratio: 1 })
  await expectInside(picture, page.getByTestId('create-stage'))
  expect((await picture.boundingBox())!.height).toBeGreaterThanOrEqual(120)
})
