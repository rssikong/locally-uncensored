import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from './support/cloud-mock'
import { mlxCalls, requireCall } from './support/recorded'
import { gradientPng } from './support/png'
import { giveMachineMemory } from './support/mac-memory'
import { appModules, type AppWindow } from './support/ui'

/**
 * What the persona walk of the Mac app found and fixed (09.10.2026,
 * proof/mac/PERSONA-DURCHLAUF-MAC.md). Three customers went through the app
 * from the first window to the last tab: a newcomer on a MacBook Air, a power
 * user on an M5 Pro, a Cloud customer. Each test here is one place where one
 * of them stumbled, with its Windows counterpart where the same screen exists
 * there.
 */

const MAC: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'mac' }
const FRESH: TauriMockOptions = { ...MAC, mlx: { engineInstalled: false, videoEngineInstalled: false, installedImages: [], installedVideos: [] } }
const QWEN: TauriMockOptions = { ...MAC, mlx: { installedImages: ['sd-turbo', 'qwen-image-2.1-8bit'], mfluxEngineInstalled: true } }

const ONE_PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function bootCreate(page: Page, opts: TauriMockOptions, memoryGb?: number) {
  await page.addInitScript(tauriMockInit, opts)
  if (memoryGb) await giveMemory(page, memoryGb)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
}

/**
 * Create on Windows with a ComfyUI that answers: its status, its node list
 * with these model files, and an upload. Nothing is rendered. The models are
 * a local Qwen-Image 2.1 and its finetune, the same files a Windows machine
 * holds after the image setup.
 */
const WIN_QWEN = 'qwen_image_2.1_int8_convrot.safetensors'
const WIN_NOCT = 'NoctQ_V4_int8_convrot.safetensors'
const WIN_OWN = 'juggernautXL_ragnarokBy_v10_lightning_8step_fp16_fix.safetensors'

async function bootCreateOnWindows(page: Page, picked: string) {
  await page.addInitScript(tauriMockInit, { ...MAC, platform: 'windows' as const })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.addInitScript(([picked, unets, checkpoints]) => {
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string }) => Promise<unknown> } }
    if (!localStorage.getItem('create-store')) {
      localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', imageModel: picked }, version: 2 }))
    }
    const bridge = w.__TAURI_INTERNALS__
    const invoke = bridge.invoke
    const combo = (v: readonly string[]) => [v]
    const nodes: Record<string, unknown> = {
      UNETLoader: { input: { required: { unet_name: combo(unets) } } },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: combo(checkpoints) } } },
      CLIPLoader: { input: { required: { clip_name: combo(['qwen3vl_8b_int8_convrot.safetensors']) } } },
      VAELoader: { input: { required: { vae_name: combo(['qwen_image_2.1_vae_bf16.safetensors']) } } },
      KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
      VAEEncodeForInpaint: { input: { required: {} } },
      InpaintModelConditioning: { input: { required: {} } },
    }
    bridge.invoke = (command, args) => {
      if (command === 'sniff_model_files') return Promise.resolve([])
      if (command === 'comfy_upload_image') return Promise.resolve(JSON.stringify({ name: 'source.png', subfolder: '', type: 'input' }))
      if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
      const url = args.url
      if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'RTX 4090', type: 'cuda', vram_total: 24 * 1024 ** 3 }] }))
      const one = /\/object_info\/([^/?]+)/.exec(url)
      if (one) return Promise.resolve(JSON.stringify(one[1] in nodes ? { [one[1]]: nodes[one[1]] } : {}))
      if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(nodes))
      return Promise.resolve('{}')
    }
  }, [picked, [WIN_QWEN, WIN_NOCT], [WIN_OWN]] as const)
  await page.route('**/view?**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: gradientPng(1024, 768) }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
}

test('newcomer: the first window of a Mac draws no Windows window buttons', async ({ page }) => {
  // The mock runs the wizard in the main window, the path a Mac takes when
  // its own onboarding window cannot open. The system draws the traffic
  // lights there too, so Minimize, Maximize and Close on the right were a
  // second set of window buttons.
  await page.addInitScript(tauriMockInit, FRESH)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Get Started/i })).toBeVisible({ timeout: 20_000 })
  for (const name of ['Minimize', 'Maximize', 'Close']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0)
})

test('COUNTER-CHECK: the first window on Windows keeps its three window buttons', async ({ page }) => {
  const windows: TauriMockOptions = { ...FRESH, platform: 'windows' }
  await page.addInitScript(tauriMockInit, windows)
  await page.goto('/')
  await expect(page.getByRole('button', { name: /Get Started/i })).toBeVisible({ timeout: 20_000 })
  for (const name of ['Minimize', 'Maximize', 'Close']) await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
})

test('newcomer: "Download & install" on Video says its size, installs a mainstream model, and points to Video', async ({ page }) => {
  await bootCreate(page, { ...FRESH, mlx: { ...FRESH.mlx, installPolls: 6 } })
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Local video generation needs a one-time setup')).toBeVisible({ timeout: 20_000 })
  // Gigabytes are named before the click that starts them, and they are the
  // ones that come down: the model (20.5 GB), its text encoder (8.1 GB) and
  // the engine it runs on, counted as the tiles count.
  await expect(page.getByText(/downloads LTX-2\.3 Distilled 4-bit with its text encoder, about 27 GB in all/)).toBeVisible()

  await page.getByRole('button', { name: /Download & install/i }).click()
  // The card sent the user to "Models, under Image" for a video setup.
  await expect(page.getByText(/The Model Manager shows the same progress, under Video\./)).toBeVisible()
  await expect(page.getByText(/under Image/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveAttribute('title', /under Video\.$/)

  await expect
    .poll(async () => (await mlxCalls(page)).map((c) => c.cmd), { timeout: 30_000 })
    .toContain('video_install_model')
  // The smallest video model of the catalogue is an adult fine-tune from the
  // Unfiltered side, and the smallest mainstream one took half an hour for
  // five seconds on an M5 Pro (real run, 09.10.2026). The setup takes the
  // starter the catalogue names, which made its clip in a minute.
  expect(requireCall(await mlxCalls(page), 'video_install_model').id).toBe('ltx-2.3-q4')
  // That pack brings its engine. The other engine is not set up for it.
  expect((await mlxCalls(page)).some((c) => c.cmd === 'video_install_mlx')).toBe(false)
  await expect(page.getByText(/NSFW/)).toHaveCount(0)
})

test('newcomer: on a Mac no video starter runs on, the card says so and downloads nothing', async ({ page }) => {
  await page.addInitScript(tauriMockInit, FRESH)
  await giveMachineMemory(page, { ramGb: 8 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Local video needs more memory than this Mac has')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/needs a Mac with 16 GB of memory, and this one has 8 GB\. Nothing is downloaded/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Download & install/i })).toHaveCount(0)
  expect((await mlxCalls(page)).some((c) => c.cmd === 'video_install_model' || c.cmd === 'video_install_mlx')).toBe(false)
  // The image setup of the same Mac is untouched: SD Turbo runs on 8 GB.
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await expect(page.getByText('Local image generation needs a one-time setup')).toBeVisible()
  await expect(page.getByRole('button', { name: /Download & install/i })).toBeVisible()
})

test('power user: Create says before a Wan run that this Mac is below its recommended memory', async ({ page }) => {
  // Wan 2.1 T2V 1.3B peaked at 24.5 GB on a Mac with 48 GB. On 16 GB the run
  // is not refused (nobody has measured it there), so it is said beforehand.
  const boot = async (ramGb: number) => {
    await page.addInitScript(tauriMockInit, { ...MAC, mlx: { installedVideos: ['wan21-t2v-1.3b'] } })
    await giveMachineMemory(page, { ramGb })
    await seedOnboardingDone(page)
    await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
    await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
    await page.getByRole('radio', { name: 'Video', exact: true }).click()
    await expect(page.getByTestId('mac-video-length')).toBeVisible({ timeout: 20_000 })
  }
  await boot(16)
  await expect(page.getByTestId('mac-video-memory-notice')).toHaveText(
    'Wan 2.1 T2V 1.3B is recommended for Macs with 32 GB of memory, and this one has 16 GB. It has not been measured on a Mac this size: a run can be very slow or stop for lack of memory. Close other apps before you start.',
  )
  // Said, not held back.
  await page.locator('textarea').first().fill('a red fox walking through a forest')
  await expect(page.getByRole('button', { name: /^Create$/ }).last()).toBeEnabled()
  // Not on the Image tab, which runs another model.
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await expect(page.getByTestId('mac-video-memory-notice')).toHaveCount(0)
})

const openVideoWith = async (page: Page, installedVideos: string[]) => {
  await page.addInitScript(tauriMockInit, { ...MAC, mlx: { installedVideos } })
  await giveMachineMemory(page, { ramGb: 48 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByTestId('mac-video-length')).toBeVisible({ timeout: 20_000 })
}

test('power user: Create says before a Wan run how long a clip of this length took on the Mac it was timed on', async ({ page }) => {
  // Found by hand on 10.10.2026: a clip of 105 frames ran for 28 minutes with
  // nothing on screen but a clock, and was stopped as if it hung. The model
  // needs about 345 seconds per second of clip on an M5 Pro.
  await openVideoWith(page, ['wan21-t2v-1.3b'])
  const notice = page.getByTestId('mac-video-duration-notice')
  await expect(notice).toHaveText(/^A clip of [\d.]+ seconds with Wan 2\.1 T2V 1\.3B takes about \d+ minutes on an M5 Pro with 48 GB, and longer on a smaller Mac\./)
  // Not on the Image tab, which runs another model.
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await expect(notice).toHaveCount(0)
})

test('COUNTER-CHECK: a model whose clip is done in about a minute gets no line about the time', async ({ page }) => {
  await openVideoWith(page, ['ltx-2.3-q4'])
  await page.waitForTimeout(800)
  await expect(page.getByTestId('mac-video-duration-notice')).toHaveCount(0)
})

test('COUNTER-CHECK: a Mac with the recommended memory gets no line about it', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { ...MAC, mlx: { installedVideos: ['wan21-t2v-1.3b'] } })
  await giveMachineMemory(page, { ramGb: 32 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByTestId('mac-video-length')).toBeVisible({ timeout: 20_000 })
  await page.waitForTimeout(800)
  await expect(page.getByTestId('mac-video-memory-notice')).toHaveCount(0)
})

test('COUNTER-CHECK: on Windows the video card is the ComfyUI one, with no Mac starter and no memory line', async ({ page }) => {
  const windows: TauriMockOptions = { ...FRESH, platform: 'windows' }
  await page.addInitScript(tauriMockInit, windows)
  await giveMachineMemory(page, { ramGb: 8, vramGb: 8 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, paidPlan: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Local video generation needs a one-time download')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Download & install/i })).toBeVisible()
  await expect(page.getByText(/LTX-2\.3 Distilled 4-bit|more memory than this Mac/)).toHaveCount(0)
  await expect(page.getByTestId('mac-video-memory-notice')).toHaveCount(0)
})

test('newcomer: the image setup names its size before the click', async ({ page }) => {
  await bootCreate(page, FRESH)
  await expect(page.getByText('Local image generation needs a one-time setup')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/about 5 GB in all/)).toBeVisible()
})

test('newcomer: Create waits for the setup, and no press of it names ComfyUI', async ({ page }) => {
  // Create stayed armed under the setup card. A press answered "No image
  // model selected. Add checkpoints or FLUX models to ComfyUI." in red.
  await bootCreate(page, { ...FRESH, mlx: { ...FRESH.mlx, installPolls: 3 } })
  await expect(page.getByText('Local image generation needs a one-time setup')).toBeVisible({ timeout: 20_000 })
  const prompt = page.locator('textarea').first()
  const create = page.getByRole('button', { name: /^Create$/ }).last()
  await prompt.fill('a red apple on a wooden table')
  await expect(create).toBeDisabled()
  await expect(page.getByTitle('Set this up first: Download & install, above.')).toBeVisible()
  // Enter in the prompt field is the other way to start a run.
  await prompt.press('Enter')
  await page.waitForTimeout(800)
  await expect(page.getByText(/ComfyUI/)).toHaveCount(0)
  await expect(page.getByText(/No image model selected/)).toHaveCount(0)

  // The same on Video, where the press said "Pick one from the model picker"
  // over a picker with nothing in it.
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Local video generation needs a one-time setup')).toBeVisible()
  await expect(create).toBeDisabled()
  await prompt.press('Enter')
  await page.waitForTimeout(500)
  await expect(page.getByText(/No local video model selected/)).toHaveCount(0)

  // After the setup the button is the customer's again.
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  // The stage cross-fades: wait until the video card has left, or the click
  // lands on its button.
  await expect(page.getByText('Local image generation needs a one-time setup')).toBeVisible()
  await expect(page.getByText('Local video generation needs a one-time setup')).toHaveCount(0)
  await page.getByRole('button', { name: /Download & install/i }).click()
  await expect(create).toBeEnabled({ timeout: 40_000 })
  await expect(page.getByTitle('Set this up first: Download & install, above.')).toHaveCount(0)
  await create.click()
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_generate').length, { timeout: 30_000 })
    .toBe(1)
})

test('COUNTER-CHECK: on Windows the setup card leaves Create as it was', async ({ page }) => {
  // The Mac rule reads `mlxMissing`, which is null off the Mac.
  await bootCreate(page, { ...FRESH, platform: 'windows' })
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.locator('textarea').first().fill('a red apple on a wooden table')
  await expect(page.getByRole('button', { name: /^Create$/ }).last()).toBeEnabled()
  await expect(page.getByTitle('Set this up first: Download & install, above.')).toHaveCount(0)
})

test('power user: the Mac Edit tab offers a mask and no ComfyUI workflows', async ({ page }) => {
  await bootCreate(page, QWEN)
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'car.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG })
  await expect(page.getByRole('img', { name: 'source' })).toBeVisible({ timeout: 15_000 })
  // The prompt field and the stage say what a mask does on this lane: it
  // limits the edit, and without one the prompt edits the whole image.
  await expect(page.locator('textarea').first()).toHaveAttribute('placeholder', 'Describe what to change in this image. Paint a mask to change only that area…')
  await expect(page.getByText(/leave the mask empty to edit the whole image/)).toBeVisible()
  await expect(page.getByRole('button', { name: /Paint mask/ })).toBeVisible()
  // Workflows are ComfyUI graphs. A Mac can run none, so neither the manager
  // nor the row that asks for a tagged one is offered.
  await expect(page.getByRole('button', { name: 'Workflows and tags' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Advanced settings' }).click()
  const drawer = page.locator('aside').filter({ hasText: 'Advanced settings' })
  await expect(drawer.getByText('Steps', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(drawer.getByText(/workflow/i)).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A result on a Mac: Delete moves the file to the Trash, which is what a
  // Mac calls it. The entry used to go and the file stayed (Fund 13).
  await page.locator('textarea').first().fill('make the car blue')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTitle(/Recycle Bin/)).toHaveCount(0)
  expect((await mlxCalls(page)).filter((c) => c.cmd === 'mlx_output_trash')).toHaveLength(0)
  await page.getByTitle('Delete (moves the file to the Trash)').first().click({ force: true })
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_output_trash').map((c) => c.raw.path), { timeout: 15_000 })
    .toEqual(['/tmp/lu-e2e/images/mlx-e2e.png'])
  await expect(page.getByText(/stayed on this Mac/)).toHaveCount(0)
})

test('COUNTER-CHECK: Windows keeps the mask sentence, the workflow manager and the Recycle Bin', async ({ page }) => {
  await bootCreate(page, { ...MAC, platform: 'windows' })
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await expect(page.locator('textarea').first()).toHaveAttribute('placeholder', /Leave the mask empty/)
  await expect(page.getByRole('button', { name: 'Workflows and tags' })).toBeVisible()
  // The gallery of a Windows machine never asks for the Mac's Trash command.
  expect((await mlxCalls(page)).filter((c) => c.cmd === 'mlx_output_trash')).toHaveLength(0)
})

for (const [memoryGb, frames] of [[48, 241], [32, 113]] as const) {
  test(`power user: Animate with LTX runs to ${frames} frames on a Mac with ${memoryGb} GB`, async ({ page }) => {
    // Fund 6 (3.0.7): the Length slider ended at 113 frames, 4.7 seconds, on
    // every Mac. Ten seconds ran on 48 GB (real run, 16.10.2026); nothing
    // smaller has, so a smaller Mac keeps the old ceiling.
    await bootCreate(page, { ...MAC, mlx: { installedVideos: ['ltx-2.3-q4'] } }, memoryGb)
    await page.getByRole('radio', { name: 'Animate Image', exact: true }).click()
    const slider = page.getByTestId('mac-video-length').getByRole('slider')
    await expect(slider).toHaveAttribute('max', String(frames), { timeout: 20_000 })
    await slider.fill(String(frames))
    await expect(page.getByTestId('mac-video-length')).toContainText(`${frames} frames · ${(frames / 24).toFixed(1)}s`)
  })
}

test('power user: Animate with LTX shows the length and the size of its own model and no slider that sets nothing', async ({ page }) => {
  // Fund 19: the sliders stood on Wan's 25 steps, guidance 5.0 and 16 fps
  // under "LTX-2.3 Distilled 8-bit", and 49 frames went out as 3.0625
  // seconds. Since M2 (14.10.2026) the second engine takes a size as well,
  // on its grid of 64 (`size_grid` in video.rs), so Width and Height are
  // shown and start at the pack's own size; steps, guidance and the rate
  // stay away.
  await bootCreate(page, { ...MAC, mlx: { installedVideos: ['wan21-t2v-1.3b', 'ltx-2.3-q8'] } })
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  const length = page.getByTestId('mac-video-length')
  // Text to video runs the Wan: 81 frames at 16, as its catalogue entry says.
  await expect(length).toContainText('81 frames · 5.1s', { timeout: 20_000 })
  await expect(page.getByText('Quality (steps)')).toHaveCount(0)
  await expect(page.getByText('480p')).toHaveCount(0)

  // Wan 2.1 T2V takes no start image, so Animate runs the LTX.
  await page.getByRole('radio', { name: 'Animate Image', exact: true }).click()
  await expect(length).toContainText('49 frames · 2.0s')
  await page.getByRole('button', { name: 'Advanced settings' }).click()
  const drawer = page.locator('aside').filter({ hasText: 'Advanced settings' })
  await expect(drawer.getByText('49 frames · 2.0s at 24 fps')).toBeVisible({ timeout: 15_000 })
  for (const dead of ['Steps', 'Guidance', 'FPS']) await expect(drawer.getByText(dead, { exact: true })).toHaveCount(0)
  await expect(drawer.getByTestId('mac-video-size')).toContainText('Runs at 768×512 px')
  await expect(drawer.getByText(/Seed/)).toBeVisible()
  await page.keyboard.press('Escape')

  await page.locator('input[type="file"]').first().setInputFiles({ name: 'start.png', mimeType: 'image/png', buffer: ONE_PIXEL_PNG })
  await page.locator('textarea').first().fill('slow push in')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'video_generate').length, { timeout: 40_000 })
    .toBe(1)
  const gen = requireCall(await mlxCalls(page), 'video_generate')
  expect(gen.id).toBe('ltx-2.3-q8')
  // 49 frames at the engine's 24, with half a frame of margin for its cut.
  expect(gen.raw.fps).toBe(24)
  expect(gen.seconds).toBeCloseTo(49.5 / 24, 6)
  expect([gen.raw.width, gen.raw.height, gen.raw.steps]).toEqual([768, 512, undefined])
})

test('newcomer: Video without a model shows no values that belong to no model', async ({ page }) => {
  // Fund 20: 672p, 1024p, 1536p, 20 steps and 24 frames stood under the
  // setup card, and none of them was any model's.
  await bootCreate(page, FRESH)
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Local video generation needs a one-time setup')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('mac-video-length')).toHaveCount(0)
  await expect(page.getByText('Quality (steps)')).toHaveCount(0)
  await expect(page.getByText(/^\d+p$/)).toHaveCount(0)
})

test('COUNTER-CHECK: the video lane of Windows keeps steps, size and frames', async ({ page }) => {
  await bootCreate(page, { ...MAC, platform: 'windows' })
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Quality (steps)')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Size', { exact: true })).toBeVisible()
  await expect(page.getByText('Frames', { exact: true })).toBeVisible()
  await expect(page.getByTestId('mac-video-length')).toHaveCount(0)
})

test('power user: the closed model picker tells 4-bit, 8-bit and Turbo apart, and SD Turbo is no SD 1.5', async ({ page }) => {
  // Fund 17: the chip was 230 px wide at most and read "MLX Qwen-Im…" for
  // all three packs. Fund 23: SD Turbo carried the tag "SD 1.5" under
  // "Older models".
  await bootCreate(page, { ...MAC, mlx: { installedImages: ['sd-turbo', 'qwen-image-2.1-4bit', 'qwen-image-2.1-8bit', 'qwen-image-2.1-turbo'], mfluxEngineInstalled: true } })
  const chip = page.locator('button[aria-haspopup="listbox"]').last()
  const name = chip.locator('span.truncate')
  // 760 px is measured with the Mac's own font. The Linux runner of the
  // release gate draws the same names wider, so there the narrow width proves
  // nothing about a Mac and is left out.
  const widths = process.platform === 'darwin' ? [1440, 1024, 760] : [1440, 1024]
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 })
    for (const pack of ['MLX Qwen-Image 2.1 4-bit', 'MLX Qwen-Image 2.1 8-bit', 'MLX Qwen-Image 2.1 Turbo 8-bit']) {
      await chip.click()
      await page.getByRole('option', { name: new RegExp(`${pack.replace(/[.]/g, '\\.')}($|\\s)`) }).first().click()
      await expect(name).toHaveText(pack)
      // Not cut off: what the element holds is what it shows.
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), `${pack} is cut off at ${width}`).toBe(true)
      await expect(name).toHaveAttribute('title', pack)
    }
    // Nothing is pushed out of the composer by the wider chip.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const create = await page.getByRole('button', { name: /^Create$/ }).last().boundingBox()
    expect(create!.x + create!.width).toBeLessThanOrEqual(width)
  }
  await chip.click()
  const turbo = page.getByRole('option', { name: /MLX SD Turbo/ })
  await expect(turbo).toContainText('SD Turbo')
  await expect(page.getByRole('listbox').getByText('SD 1.5', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('listbox').getByText(/Older models/i)).toHaveCount(0)
})

test('Windows: the closed model picker shows the whole name of a catalogue model, and the file name is its tooltip', async ({ page }) => {
  // Fund 17 off the Mac: at 230 px "Qwen-Image 2.1 (INT8)" read "Qwen-Image …",
  // the same as its finetune beside it.
  await bootCreateOnWindows(page, WIN_QWEN)
  const chip = page.locator('button[aria-haspopup="listbox"]').last()
  const name = chip.locator('span.truncate')
  await expect(name).toHaveText('Qwen-Image 2.1 (INT8)', { timeout: 20_000 })
  for (const [width, height] of [[1440, 900], [1296, 808], [1280, 800], [1024, 768], [760, 900]] as const) {
    await page.setViewportSize({ width, height })
    for (const [label, file] of [['Qwen-Image 2.1 (INT8)', WIN_QWEN], ['Noct Q V4 (INT8)', WIN_NOCT]] as const) {
      await chip.click()
      await page.getByRole('option', { name: new RegExp(label.replace(/[.()]/g, '\\$&')) }).first().click()
      await expect(name).toHaveText(label)
      expect(await name.evaluate((el) => el.scrollWidth <= el.clientWidth), `${label} is cut off at ${width}`).toBe(true)
      await expect(name).toHaveAttribute('title', file)
    }
    // A file name longer than any chip is cut, and says itself whole in the
    // tooltip. Nothing is pushed out of the composer by it.
    await chip.click()
    await page.getByRole('option', { name: /juggernautXL ragnarokBy/ }).first().click()
    await expect(name).toHaveAttribute('title', WIN_OWN)
    expect(await chip.evaluate((el) => getComputedStyle(el.parentElement!).maxWidth)).toBe('360px')
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth), `the long file name is cut at ${width}`).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    const create = await page.getByRole('button', { name: /^Create$/ }).last().boundingBox()
    expect(create!.x + create!.width).toBeLessThanOrEqual(width)
    const composer = await page.locator('textarea').first().boundingBox()
    expect(create!.x + create!.width, `Create leaves the composer at ${width}`).toBeLessThanOrEqual(composer!.x + composer!.width + 24)
  }
})

/** Whether `el` lies inside the visible part of the stage, without a scroll. */
async function onStage(page: Page, what: ReturnType<Page['locator']>): Promise<boolean> {
  const stage = await page.getByTestId('fit-stage').boundingBox()
  const box = await what.boundingBox()
  if (!stage || !box) return false
  return box.y >= stage.y - 1 && box.y + box.height <= stage.y + stage.height + 1
    && box.x >= stage.x - 1 && box.x + box.width <= stage.x + stage.width + 1
}

test('power user: on Edit the references and "Change image" are on screen with the source, before and after a result', async ({ page }) => {
  // Fund 14: in a 1440 × 900 window the source filled the stage, and the
  // reference strip, "Change image" and the hint lay 270 px below the fold.
  // Fund 15: after the first result the source and the references were gone.
  const picture = gradientPng(1024, 768)
  await bootCreate(page, { ...QWEN, mlx: { ...QWEN.mlx, imageBase64: picture.toString('base64') } })
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'car.png', mimeType: 'image/png', buffer: picture })
  const stage = page.getByTestId('fit-stage')
  const source = page.getByRole('img', { name: 'source' })
  await expect(source).toBeVisible({ timeout: 15_000 })

  for (const [width, layout] of [[1440, 'beside'], [1024, 'beside'], [760, 'stacked']] as const) {
    await page.setViewportSize({ width, height: 900 })
    await expect(stage).toHaveAttribute('data-layout', layout)
    await expect.poll(() => stage.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), { message: `the stage scrolls at ${width}` }).toBe(true)
    // The how-to line at the stage's foot (help, 3.0.7) stands where the
    // controls sit beside the picture; on the narrow stage it took the 28 px
    // the picture needed and the stage scrolled again (Mac check 16.10.2026).
    await expect(page.getByTestId('howto-mac-mask')).toHaveCount(layout === 'beside' ? 1 : 0)
    for (const part of [source, page.getByTestId('reference-strip'), page.getByRole('button', { name: 'Change image' }), page.getByText(/leave the mask empty to edit the whole image/)]) {
      expect(await onStage(page, part), `off the stage at ${width}`).toBe(true)
    }
    // The picture is still a picture, not a thumbnail.
    expect((await source.boundingBox())!.height).toBeGreaterThanOrEqual(120)
  }

  // One image first, then with a reference.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.locator('textarea').first().fill('make the car blue')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.getByTestId('result-facts')).toBeVisible({ timeout: 30_000 })
  const inputs = page.getByTestId('result-source-actions')
  for (const width of [1440, 1024, 760]) {
    await page.setViewportSize({ width, height: 900 })
    await expect.poll(() => stage.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), { message: `the stage scrolls at ${width}` }).toBe(true)
    for (const part of [inputs.getByRole('img', { name: 'source' }), inputs.getByText('Create edits this image again.'), inputs.getByRole('button', { name: 'Change image' }), page.getByTestId('reference-strip'), page.getByTestId('result-facts'), page.getByTestId('result-prompt-open')]) {
      expect(await onStage(page, part), `off the stage at ${width}`).toBe(true)
    }
    // The prompt of the result costs the stage no line of its own (a panel
    // under the picture made the stage scroll at 760). Its word in the facts
    // opens the large view, where the prompt stands with its copy button.
    await page.getByTestId('result-prompt-open').click()
    const big = page.locator('.fixed.inset-0').filter({ has: page.getByTestId('prompt-details') })
    await expect(big.getByTestId('prompt-text')).toBeVisible()
    await expect(big.getByTestId('prompt-text')).toHaveText('make the car blue')
    await expect(big.getByRole('button', { name: 'Copy prompt', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(big).toHaveCount(0)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByTestId('reference-strip').locator('input[type="file"]').setInputFiles({ name: 'scene.png', mimeType: 'image/png', buffer: gradientPng(600, 900) })
  await expect(page.getByRole('img', { name: 'image 2', exact: true })).toBeVisible()
  expect(await onStage(page, page.getByRole('img', { name: 'image 2', exact: true }))).toBe(true)
  await page.locator('textarea').first().fill('put the car into the scene of image 2')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_generate').length, { timeout: 30_000 })
    .toBe(2)
  // The second run took the same source again, and the reference with it.
  const runs = (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_generate')
  expect((runs[0].raw.images as string[]).length).toBe(1)
  expect((runs[1].raw.images as string[]).length).toBe(2)
  expect((runs[1].raw.images as string[])[0]).toBe((runs[0].raw.images as string[])[0])
  // And the reference is still shown after that result.
  await expect(page.getByTestId('result-facts')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('img', { name: 'image 2', exact: true })).toBeVisible()
})

test('Windows: on Edit the references, "Paint mask" and "Change image" are on screen with the source, before and after a result', async ({ page }) => {
  // Funde 14 and 15 off the Mac, on the local engine of Windows: in a
  // 1296 x 808 window the stage is 371 px high and held 743 px, "Change
  // image" stood at the very bottom edge of the window, behind a scroll.
  const picture = gradientPng(1024, 768)
  await bootCreateOnWindows(page, WIN_QWEN)
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'car.png', mimeType: 'image/png', buffer: picture })
  const stage = page.getByTestId('fit-stage')
  const source = page.getByRole('img', { name: 'source' })
  await expect(source).toBeVisible({ timeout: 15_000 })
  // 1280 x 800 is the window the app opens in (tauri.conf.json).
  const SIZES = [[1440, 900, 'beside'], [1296, 808, 'beside'], [1280, 800, 'beside'], [1024, 900, 'beside']] as const

  for (const [width, height, layout] of SIZES) {
    await page.setViewportSize({ width, height })
    await expect(stage).toHaveAttribute('data-layout', layout)
    await expect.poll(() => stage.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), { message: `the stage scrolls at ${width}` }).toBe(true)
    for (const part of [source, page.getByTestId('reference-strip'), page.getByRole('button', { name: 'Paint mask' }), page.getByRole('button', { name: 'Change image' }), page.getByRole('button', { name: 'Add more images' }), page.getByText(/Leave the mask empty to restyle/).first()]) {
      expect(await onStage(page, part), `off the stage at ${width}`).toBe(true)
    }
    expect((await source.boundingBox())!.height).toBeGreaterThanOrEqual(240)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  }

  // A result of this session, the source still loaded: what a finished run
  // leaves in the gallery.
  await appModules(page, ['/src/stores/createStore.ts'])
  await page.evaluate((model) => {
    const store = (window as unknown as AppWindow).__APP__['/src/stores/createStore.ts'].useCreateStore
    store.getState().addToGallery({
      id: 'run-1', type: 'image', filename: 'edit_00002_.png', subfolder: '', prompt: 'make the car blue', negativePrompt: '',
      model, modelType: 'qwenimage', seed: 7, steps: 20, cfgScale: 4, sampler: 'euler', scheduler: 'simple',
      width: 1024, height: 768, batchSize: 1, createdAt: Date.now() + 1000, intent: 'edit', sourceName: 'car.png',
    })
  }, WIN_QWEN)
  await expect(page.getByTestId('result-facts')).toBeVisible({ timeout: 15_000 })
  const inputs = page.getByTestId('result-source-actions')
  for (const [width, height] of SIZES) {
    await page.setViewportSize({ width, height })
    await expect.poll(() => stage.evaluate((el) => el.scrollHeight <= el.clientHeight + 1), { message: `the stage scrolls at ${width}` }).toBe(true)
    for (const part of [inputs.getByRole('img', { name: 'source' }), inputs.getByText('Create edits this image again.'), inputs.getByRole('button', { name: 'Change image' }), page.getByTestId('reference-strip'), inputs.getByRole('button', { name: 'Add more images' }), page.getByTestId('result-facts'), page.getByTestId('result-prompt-open')]) {
      expect(await onStage(page, part), `off the stage at ${width}`).toBe(true)
    }
  }
  // The prompt of the result is one word in the facts and opens the large view.
  await page.getByTestId('result-prompt-open').click()
  const big = page.locator('.fixed.inset-0').filter({ has: page.getByTestId('prompt-details') })
  await expect(big.getByTestId('prompt-text')).toHaveText('make the car blue')
  await page.keyboard.press('Escape')
  await expect(big).toHaveCount(0)
  // "Change image" puts the next image on the stage, ready for the next run.
  await inputs.locator('input[type="file"]:not([multiple])').first().setInputFiles({ name: 'next.png', mimeType: 'image/png', buffer: gradientPng(600, 900) })
  await expect(page.getByRole('button', { name: 'Paint mask' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('result-facts')).toHaveCount(0)
})

test('Windows: in a narrow window the controls stand under the source, and the stage scrolls no further than they need', async ({ page }) => {
  // 760 px wide: the column of Windows holds more than the Mac's (the mask
  // button, the list buttons, a longer hint). The picture is at its floor of
  // 120 px there and the rest is reached by a short scroll, where before the
  // whole column lay under a picture of half the window.
  await bootCreateOnWindows(page, WIN_QWEN)
  await page.getByRole('radio', { name: 'Edit / Image to Image', exact: true }).click()
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'car.png', mimeType: 'image/png', buffer: gradientPng(1024, 768) })
  const stage = page.getByTestId('fit-stage')
  const source = page.getByRole('img', { name: 'source' })
  await expect(source).toBeVisible({ timeout: 15_000 })
  await page.setViewportSize({ width: 760, height: 900 })
  await expect(stage).toHaveAttribute('data-layout', 'stacked')
  expect((await source.boundingBox())!.height).toBeGreaterThanOrEqual(120)
  for (const part of [source, page.getByTestId('reference-strip'), page.getByRole('button', { name: 'Paint mask' }), page.getByRole('button', { name: 'Change image' })]) {
    expect(await onStage(page, part), 'off the stage at 760').toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('cloud customer: back in Local from a lane only the Cloud has, Create stands on Image', async ({ page }) => {
  // Music in the Cloud, then the switch off. On a Mac the local Music lane is
  // a ComfyUI graph that does not exist: the bar showed it as a locked
  // teaser, no tab was selected, and below it stood the local Music composer
  // with an empty model picker and an armed Create.
  await bootCreate(page, MAC)
  await signInViaGate(page)
  await expect(page.getByRole('dialog', { name: 'LU Cloud' })).toBeHidden({ timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await page.getByRole('radio', { name: 'Music', exact: true }).click()
  await expect(page.getByRole('radio', { name: 'Music', exact: true })).toBeChecked()

  await cloudSwitch(page).click()
  await expect(cloudSwitch(page)).not.toBeChecked()
  await expect(page.getByRole('radio', { name: 'Music, runs on LU Cloud' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeChecked()
  await expect(page.getByText('Lyrics', { exact: true })).toHaveCount(0)
  // And the lane works: the local image model is picked and renders.
  await page.locator('textarea').first().fill('a red apple')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_generate').length, { timeout: 30_000 })
    .toBe(1)
  // With its own steps: the 50 of the Music lane do not travel to SD Turbo.
  const gen = requireCall(await mlxCalls(page), 'mlx_generate')
  expect(gen.model).toBe('sd-turbo')
  expect(gen.steps).toBe(4)
})

test('power user: another rail of the Model Manager opens at its top', async ({ page }) => {
  await page.addInitScript(tauriMockInit, MAC)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  const pane = page.getByTestId('models-pane')
  await expect(page.getByRole('heading', { name: 'Chat models' })).toBeVisible()
  await expect(page.locator('[data-model-tile]').first()).toBeVisible({ timeout: 15_000 })
  await pane.evaluate((el) => { el.scrollTop = 900 })
  expect(await pane.evaluate((el) => el.scrollTop)).toBeGreaterThan(300)

  await page.locator('aside').getByRole('button', { name: /^Image/ }).click()
  await expect(page.getByTestId('mac-media-image')).toBeVisible()
  await expect.poll(() => pane.evaluate((el) => el.scrollTop)).toBe(0)
  await expect(page.getByRole('heading', { name: 'Image models' })).toBeInViewport()
})

async function bootModels(page: Page, opts: TauriMockOptions) {
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
}

test('power user: a tile says "experimental", the licence and the token before the download', async ({ page }) => {
  // Fund 16: the description is cut after two lines, and what it lost was
  // its end: "Experimental: not yet tested in LU.", "Research license,
  // non-commercial use only.", "asks for a free Hugging Face token".
  await bootModels(page, MAC)
  await page.locator('aside').getByRole('button', { name: /^Image/ }).click()
  // Qwen-Image 2.1 8-bit has run in LU since (real run, 09.10.2026) and keeps
  // its licence; Qwen-Image 2512 8-bit has not and says so.
  for (const [id, mark, sentence] of [
    ['qwen-image-2.1-8bit', 'Non-commercial', 'Research license, non-commercial use only.'],
    ['qwen-image-2512-8bit', 'Experimental', 'Experimental: not yet tested in LU.'],
  ]) {
    const card = page.locator(`[data-mac-media-tile="${id}"]`)
    await card.scrollIntoViewIfNeeded()
    const tag = card.getByText(mark, { exact: true })
    await expect(tag).toBeVisible()
    await expect(tag).toHaveAttribute('title', sentence)
    // On the tile, not clipped by it.
    const tile = (await card.boundingBox())!
    const box = (await tag.boundingBox())!
    expect(box.x >= tile.x && box.x + box.width <= tile.x + tile.width && box.y + box.height <= tile.y + tile.height).toBe(true)
    // The two lines are spent on the model, not on the sentence the mark carries.
    await expect(card.locator('p').first()).not.toContainText(mark === 'Experimental' ? 'Experimental' : 'Research license')
    await expect(card.locator('p').first()).toHaveAttribute('title', new RegExp(`${sentence.replace(/[.]/g, '\\.')}$`))
  }
  await expect(page.locator('[data-mac-media-tile="qwen-image-2.1-8bit"]').getByText('Experimental', { exact: true })).toHaveCount(0)
  // A model without such a sentence has no row of marks.
  await expect(page.locator('[data-mac-media-tile="sd-turbo"] [data-tile-notes]')).toHaveCount(0)

  await page.locator('aside').getByRole('button', { name: /^Video/ }).click()
  const ltx = page.locator('[data-mac-media-tile="ltx-2.5-q4"]')
  await ltx.scrollIntoViewIfNeeded()
  await expect(ltx.getByText('Needs a Hugging Face token', { exact: true })).toBeVisible()
  await expect(ltx.getByText('Experimental', { exact: true })).toBeVisible()
})

test('COUNTER-CHECK: the Model Manager of Windows draws no such marks', async ({ page }) => {
  await bootModels(page, { ...MAC, platform: 'windows' })
  await page.locator('aside').getByRole('button', { name: /^Image/ }).click()
  await page.waitForTimeout(800)
  await expect(page.locator('[data-tile-note]')).toHaveCount(0)
  await expect(page.locator('[data-mac-media-tile]')).toHaveCount(0)
})

/** A Mac with this much memory, as `detect_gpus` and `system_info` report it. */
async function giveMemory(page: Page, gb: number, card = false) {
  await page.addInitScript(({ memoryGb, card }: { memoryGb: number; card: boolean }) => {
    const internals = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: unknown, o?: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
    if (!internals) return
    const inner = internals.invoke.bind(internals)
    internals.invoke = (cmd: string, args?: unknown, o?: unknown) => {
      if (cmd === 'system_info') return Promise.resolve({ totalMemory: memoryGb * 1_073_741_824 })
      if (cmd === 'detect_gpus') return Promise.resolve([card
        ? { index: 0, source: 'e2e', vendor: 'nvidia', name: 'NVIDIA GeForce RTX 5090', memory_mib: memoryGb * 1024, shared_memory_mib: null }
        : { index: 0, source: 'e2e', vendor: 'apple', name: 'Apple M5 Pro', memory_mib: null, shared_memory_mib: memoryGb * 1024 }])
      return inner(cmd, args, o)
    }
  }, { memoryGb: gb, card })
}

/** The user's own No to Ollama, which the start-up detector respects. */
const withoutOllama = (page: Page) => page.addInitScript(() => {
  window.localStorage.setItem('lu-providers', JSON.stringify({ state: { providers: { ollama: { id: 'ollama', name: 'Ollama', enabled: false, disabledByUser: true, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true } } }, version: 0 }))
})

async function startHere(page: Page, opts: { ollama: boolean; platform?: 'mac' | 'windows'; memoryGb?: number }) {
  await page.addInitScript(tauriMockInit, { ...MAC, platform: opts.platform ?? 'mac' })
  await giveMemory(page, opts.memoryGb ?? 48, opts.platform === 'windows')
  if (!opts.ollama) await withoutOllama(page)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  const picks = page.getByRole('region', { name: 'Start here' })
  await expect(picks).toBeVisible({ timeout: 20_000 })
  return picks
}

test('power user: "Start here" recommends nothing that needs Ollama on a Mac without Ollama', async ({ page }) => {
  // Fund 18: the first row of a Mac that runs the LU Engine alone
  // recommended "Qwen 3.8 27B (Ollama)".
  const picks = await startHere(page, { ollama: false })
  await expect(picks.locator('[data-model-tile]').first()).toBeVisible()
  await expect(picks.getByText(/\(Ollama\)/)).toHaveCount(0)
  // Pull fetches an Ollama model by name, so it is not offered either.
  await expect(page.getByRole('button', { name: 'Pull', exact: true })).toHaveCount(0)
  // The entry is still in the list below, under its own name.
  await expect(page.getByTestId('models-pane').getByText(/\(Ollama\)/).first()).toBeAttached()
})

test('COUNTER-CHECK: with Ollama on this Mac the same entry may be recommended, and Pull is there', async ({ page }) => {
  const picks = await startHere(page, { ollama: true })
  await expect(picks.getByText(/\(Ollama\)/).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pull', exact: true })).toBeVisible()
})

test('Windows: "Start here" recommends nothing that needs Ollama without Ollama either', async ({ page }) => {
  const picks = await startHere(page, { ollama: false, platform: 'windows' })
  await expect(picks.locator('[data-model-tile]').first()).toBeVisible()
  await expect(picks.getByText(/\(Ollama\)/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Pull', exact: true })).toHaveCount(0)
  // The entry is still in the list below, under its own name.
  await expect(page.getByTestId('models-pane').getByText(/\(Ollama\)/).first()).toBeAttached()
})

test('COUNTER-CHECK: with Ollama on this Windows machine the same entry may be recommended', async ({ page }) => {
  const picks = await startHere(page, { ollama: true, platform: 'windows' })
  await expect(picks.getByText(/\(Ollama\)/).first()).toBeVisible()
})

test('the details dialog of a chat model names it once', async ({ page }) => {
  // Fund 22: "Qwen 3.8 35B MoE Distill: Qwen 3.8 35B MoE Distill".
  await startHere(page, { ollama: true })
  await page.getByRole('button', { name: 'Details for Qwen 3.8 35B MoE Distill', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Qwen 3.8 35B MoE Distill')
  await expect(dialog).not.toContainText('Qwen 3.8 35B MoE Distill: Qwen 3.8 35B MoE Distill')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
})

test('on Windows the same dialog names the model once too', async ({ page }) => {
  // A 32 GB card: the tile stands on the entry that carries the group's name.
  await startHere(page, { ollama: true, platform: 'windows', memoryGb: 32 })
  await page.getByRole('button', { name: 'Details for Qwen 3.8 35B MoE Distill', exact: true }).first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading')).toHaveText('Qwen 3.8 35B MoE Distill')
})

test('power user: a video whose file cannot be read shows its sentence and no player controls under it', async ({ page }) => {
  // Fund 26: "0:00" and the play button shone through the sentence. The mock
  // has no file behind a render, which is exactly this state.
  await bootCreate(page, { ...MAC, mlx: { installedVideos: ['wan21-t2v-1.3b'] } })
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByTestId('mac-video-length')).toBeVisible({ timeout: 20_000 })
  await page.locator('textarea').first().fill('a paper boat on a pond')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  const line = page.getByText('This render is on this Mac, but its file could not be read just now.')
  await expect(line).toBeVisible({ timeout: 40_000 })
  const video = page.locator('video').first()
  await expect(video).toBeAttached()
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(false)
  // The sentence has the room of the box it lies on.
  const [box, text] = [await video.boundingBox(), await line.boundingBox()]
  expect(box && text && text.y >= box.y && text.y + text.height <= box.y + box.height && text.x >= box.x && text.x + text.width <= box.x + box.width).toBe(true)
})

test('on Windows a video whose file cannot be read shows its sentence and no player controls either', async ({ page }) => {
  // The same state off the Mac: a saved render whose file ComfyUI no longer
  // has. ComfyUI answers its status and has no such file.
  await page.addInitScript(tauriMockInit, { ...MAC, platform: 'windows' as const })
  await seedOnboardingDone(page)
  await page.addInitScript(() => {
    localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', gallery: [{
      id: 'v1', type: 'video', filename: 'boat_00001_.mp4', subfolder: '', prompt: 'a paper boat on a pond', negativePrompt: '',
      model: 'wan2.2_ti2v_5B_fp16.safetensors', modelType: 'unknown', seed: 7, steps: 20, cfgScale: 5, sampler: 'euler',
      scheduler: 'simple', width: 832, height: 480, batchSize: 1, createdAt: Date.now(),
    }] }, version: 2 }))
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown>) => Promise<unknown> } }
    const invoke = w.__TAURI_INTERNALS__.invoke
    w.__TAURI_INTERNALS__.invoke = (command, args) => {
      if (command === 'proxy_localhost' && String(args?.url ?? '').includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [] }))
      return invoke(command, args)
    }
  })
  await page.route('**/view?**', (route) => route.fulfill({ status: 404, body: '' }))
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  await page.locator('aside').filter({ hasText: 'Gallery' }).locator('.group').first().click()
  const video = page.locator('video').first()
  await expect(video).toBeAttached({ timeout: 15_000 })
  const line = page.getByText('This file is no longer in the ComfyUI output folder.')
  await expect(line).toBeVisible({ timeout: 20_000 })
  expect(await video.evaluate((v: HTMLVideoElement) => v.controls)).toBe(false)
  const [box, text] = [await video.boundingBox(), await line.boundingBox()]
  expect(box && text && text.y >= box.y && text.y + text.height <= box.y + box.height && text.x >= box.x && text.x + text.width <= box.x + box.width).toBe(true)
})

test('cloud customer: the command palette offers no local model while the Cloud is on', async ({ page }) => {
  // Fund 27: "Use qwen2.5-7b-instruct-q4_k_m" under MODELS, in Cloud mode.
  await bootCreate(page, MAC)
  await signInViaGate(page)
  await expect(page.getByRole('dialog', { name: 'LU Cloud' })).toBeHidden({ timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await page.keyboard.press('Meta+k')
  const list = page.getByRole('listbox', { name: 'Actions' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('option', { name: 'Create', exact: true })).toBeVisible()
  await expect(list.getByRole('option', { name: 'Models', exact: true })).toHaveCount(0)
  await expect(list.getByRole('option').filter({ hasText: DEFAULT_MODEL_NAME })).toHaveCount(0)
})

test('cloud customer on Windows: the palette offers no local model while the Cloud is on either', async ({ page }) => {
  await bootCreate(page, { ...MAC, platform: 'windows' })
  await signInViaGate(page)
  await expect(page.getByRole('dialog', { name: 'LU Cloud' })).toBeHidden({ timeout: 20_000 })
  await expect(cloudSwitch(page)).toBeChecked()
  await page.keyboard.press('Control+k')
  const list = page.getByRole('listbox', { name: 'Actions' })
  await expect(list).toBeVisible()
  await expect(list.getByRole('option', { name: 'Create', exact: true })).toBeVisible()
  await expect(list.getByRole('option', { name: 'Models', exact: true })).toHaveCount(0)
  // Before 3.0.6 this very list held the local model here, one entry.
  await expect(list.getByRole('option').filter({ hasText: DEFAULT_MODEL_NAME })).toHaveCount(0)
})

for (const platform of ['mac', 'windows'] as const) {
  test(`${platform}: DEFAULT, LOCAL and CLOUD beside a backend can be read in the light theme`, async ({ page }) => {
    // Fund 29: the marks were dark theme colours, about 2 to 1 on white. The
    // contrast is taken from what the page draws: the colour of the word on
    // every tint that lies under it.
    await page.addInitScript(tauriMockInit, { ...MAC, platform })
    await seedOnboardingDone(page)
    await routeCloud(page, { license: 'active', access: true, mediaLive: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
    if (await page.evaluate(() => document.documentElement.classList.contains('dark'))) {
      await page.getByRole('banner').getByTitle(/^(Light|Dark) Mode$/).click()
    }
    await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('navigation', { name: 'Settings sections' }).getByRole('button', { name: 'AI Backends', exact: true }).click()
    await expect(page.getByText('LOCAL', { exact: true }).first()).toBeVisible({ timeout: 20_000 })
    const contrasts = await page.evaluate(() => {
      const lum = (c: number[]) => {
        const [r, g, b] = c.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const out: Record<string, number> = {}
      for (const word of ['DEFAULT', 'LOCAL', 'CLOUD']) {
        const el = [...document.querySelectorAll('span')].find((s) => s.textContent === word)
        if (!el) continue
        // A canvas turns any colour notation into sRGB bytes.
        const paint = (css: string) => {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1
          const ctx = canvas.getContext('2d', { willReadFrequently: true })!
          ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1)
          const d = ctx.getImageData(0, 0, 1, 1).data
          return { rgb: [d[0], d[1], d[2]], a: d[3] / 255 }
        }
        // Lay every background from the page down to the word.
        const chain: Element[] = []
        for (let n: Element | null = el; n; n = n.parentElement) chain.unshift(n)
        let under = [255, 255, 255]
        for (const n of chain) {
          const bg = getComputedStyle(n).backgroundColor
          if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue
          const layer = paint(bg)
          under = under.map((v, i) => layer.rgb[i] * layer.a + v * (1 - layer.a))
        }
        const text = paint(getComputedStyle(el).color).rgb
        const [hi, lo] = [lum(text), lum(under)].sort((a, b) => b - a)
        out[word] = (hi + 0.05) / (lo + 0.05)
      }
      return out
    })
    // A fresh list holds no backend of the CLOUD kind; its colour is held by
    // the arithmetic in provider-badge.test.ts.
    expect(Object.keys(contrasts)).toEqual(expect.arrayContaining(['DEFAULT', 'LOCAL']))
    for (const [word, ratio] of Object.entries(contrasts)) expect(ratio, `${word} in the light theme`).toBeGreaterThanOrEqual(4.5)
  })
}

test('newcomer: a click on the card of the lane just left starts nothing of that lane', async ({ page }) => {
  // Fund 28: Image chosen and "Download & install" pressed at once started
  // the VIDEO setup, because the leaving card faded for 120 ms with its
  // button still live.
  await bootCreate(page, FRESH)
  await page.getByRole('radio', { name: 'Video', exact: true }).click()
  await expect(page.getByText('Local video generation needs a one-time setup')).toBeVisible({ timeout: 20_000 })
  const button = page.getByRole('button', { name: /Download & install/i })
  const box = (await button.boundingBox())!
  const image = page.getByRole('radio', { name: 'Image', exact: true })
  // The lane switch and the press in one go, inside the page, so no round
  // trip of the test runner stands between them.
  await image.evaluate(async (radio, at) => {
    (radio as HTMLElement).click()
    // One frame: the stage has drawn the leaving card as leaving.
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    const hit = document.elementFromPoint(at.x, at.y) as HTMLElement | null
    hit?.click()
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 })
  await expect(page.getByText('Local image generation needs a one-time setup')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(600)
  const cmds = (await mlxCalls(page)).map((c) => c.cmd)
  expect(cmds.filter((c) => c.startsWith('video_install') || c === 'video_pull')).toEqual([])
})

// The LoRA rail and the LoRA stack, walked with the same eyes.
const LORA_FOLDER = [
  { name: 'qwen/detail.safetensors' },
  { name: 'slider.safetensors', keys: 'kohya' as const },
  { name: 'broken.safetensors', keys: 'unreadable' as const },
]

test('power user: the LoRA rail names the models a LoRA works with, and its search field searches LoRAs', async ({ page }) => {
  await bootModels(page, { ...QWEN, mlx: { ...QWEN.mlx, loras: LORA_FOLDER } })
  await page.locator('aside').getByRole('button', { name: /^LoRA/ }).click()
  const pane = page.getByTestId('models-pane')
  await expect(pane.getByText('Small add-ons that give an image model a style or a subject.')).toBeVisible()
  await expect(pane.getByPlaceholder('Search LoRAs…')).toBeVisible()
  const lane = page.getByTestId('mac-lora-lane')
  await expect(lane).toContainText('Use them in Create with an image model whose name ends in 4-bit or 8-bit (Qwen-Image 2.1, Qwen-Image 2512, Z-Image Turbo, FLUX.2 klein 4B): Advanced settings, Expert, LoRA stack. The other image models take no LoRA.')
  await expect(lane).not.toContainText('quantized')

  await page.getByRole('button', { name: /^Installed/ }).click()
  await expect(page.getByTestId('lora-row')).toHaveCount(3)
  await page.getByRole('button', { name: 'Delete slider.safetensors' }).click()
  await expect(page.getByRole('dialog')).toContainText('The file moves to the Trash.')
})

test('power user: the LoRA stack says on the row what the run would refuse, and its head keeps to one line per label', async ({ page }) => {
  await bootCreate(page, { ...QWEN, mlx: { ...QWEN.mlx, loras: LORA_FOLDER } })
  await page.locator('button[aria-haspopup="listbox"]').last().click()
  await page.getByRole('option', { name: /Qwen-Image 2\.1/ }).first().click()
  await page.getByRole('button', { name: 'Advanced settings' }).click()
  const drawer = page.locator('aside').filter({ hasText: 'Advanced settings' })
  await drawer.getByRole('button', { name: /Expert/ }).click()
  const head = drawer.getByText(/^LoRA stack/)
  await head.scrollIntoViewIfNeeded()

  const refused = drawer.getByTestId('lora-stack-refused')
  await expect(refused).toHaveText(['sliderKohya format', 'brokennot readable'])
  // The rows are marked as disabled; a press on one all the same turns nothing on.
  // (Each row also carries a Copy file name button since 3.0.8.)
  await refused.first().locator('button[aria-disabled="true"]').click({ force: true })
  await refused.last().locator('button[aria-disabled="true"]').click({ force: true })
  await expect(drawer.getByText(/active/)).toHaveCount(0)

  // One that fits goes on, and with Clear in the head no label breaks.
  await drawer.getByRole('button', { name: /qwen\/detail/ }).click()
  await expect(drawer.getByText('· 1 active')).toBeVisible()
  for (const label of ['Clear', 'Open folder', 'Rescan']) {
    const box = (await drawer.getByRole('button', { name: label, exact: true }).boundingBox())!
    expect(box.height, label).toBeLessThan(24)
  }
  expect((await head.boundingBox())!.height).toBeLessThan(24)

  // A run sends the one that is on.
  await page.keyboard.press('Escape')
  await page.locator('textarea').first().fill('a red apple')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect.poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_generate').length, { timeout: 30_000 }).toBe(1)
  const gen = requireCall(await mlxCalls(page), 'mlx_generate')
  expect(JSON.stringify(gen.raw.loras)).toBe(JSON.stringify([{ name: 'qwen/detail.safetensors', strength: 0.8 }]))
})
