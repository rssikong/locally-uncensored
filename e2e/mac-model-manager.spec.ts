import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch } from './support/cloud-mock'
import { mlxCalls } from './support/recorded'
import { giveMachineMemory } from './support/mac-memory'

/**
 * The Model Manager on a Mac. Image and Video are the app's own tile surface
 * (not the engine panel out of Settings): two catalogues behind one switch,
 * at least eight models on each side, Get new and Installed as two views, and
 * a Get that sets the engine up on the way.
 */

const MAC: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'mac' }

async function openModels(page: Page, opts: TauriMockOptions) {
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
}

// The rail of the Models page, and no other aside. The app's own sidebar is an
// aside too, it has a button called Chat, and it takes 150 ms to leave after
// the click on Models. A bare `aside` found that button first: on a busy
// machine the click landed on it, the app went back to the chat, and the test
// then waited in vain for the Models pane (two red tests in a full run,
// 10.10.2026). In both faces the rail stands right before the pane.
const lanes = (page: Page) => page.locator('aside:has(+ [data-testid="models-pane"])')
const rail = (page: Page, name: 'Chat' | 'Image' | 'Video') =>
  lanes(page).getByRole('button', { name: new RegExp(`^${name}`) })
const tile = (page: Page, id: string) => page.locator(`[data-mac-media-tile="${id}"]`)
const tiles = (page: Page) => page.locator('[data-mac-media-tile]')

test('image: eight and eight, and the switch shows one side at a time', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, installedImages: [] } })
  await rail(page, 'Image').click()
  const lane = page.getByTestId('mac-media-image')
  await expect(lane).toBeVisible()

  const catalogue = lane.getByRole('group', { name: 'Catalogue' })
  const mainstream = catalogue.getByRole('button', { name: /Mainstream/ })
  const unfiltered = catalogue.getByRole('button', { name: /Unfiltered/ })
  await expect(mainstream).toHaveAttribute('aria-pressed', 'true')

  const shownMainstream = await tiles(page).count()
  expect(shownMainstream).toBeGreaterThanOrEqual(8)
  await expect(mainstream).toContainText(String(shownMainstream))
  await expect(tile(page, 'sd-turbo')).toBeVisible()
  await expect(tile(page, 'realvisxl-v5')).toHaveCount(0)
  // Fine-tunes that render nudity with no filter are not mainstream, whatever
  // their card advertises (owner's rule, 08.10.2026).
  await expect(tile(page, 'juggernaut-xl-v9')).toHaveCount(0)
  await expect(tile(page, 'animagine-xl-4.0')).toHaveCount(0)

  await unfiltered.click()
  const shownUnfiltered = await tiles(page).count()
  expect(shownUnfiltered).toBeGreaterThanOrEqual(8)
  await expect(tile(page, 'realvisxl-v5')).toBeVisible()
  await expect(tile(page, 'juggernaut-xl-v9')).toBeVisible()
  await expect(tile(page, 'animagine-xl-4.0')).toBeVisible()
  await expect(tile(page, 'sd-turbo')).toHaveCount(0)

  // The memory buckets cut the same list, and say so when nothing is left.
  await lane.getByRole('group', { name: 'Memory' }).getByRole('button', { name: /^Heavy/ }).click()
  await expect(tile(page, 'chroma1-hd')).toBeVisible()
  await expect(tile(page, 'realvisxl-v5')).toHaveCount(0)

  // The header search reaches this lane too.
  await lane.getByRole('group', { name: 'Memory' }).getByRole('button', { name: /^All/ }).click()
  await page.getByPlaceholder('Search models…').fill('illustrious')
  await expect(tiles(page)).toHaveCount(1)
  await expect(tile(page, 'wai-illustrious-v15')).toBeVisible()
})

test('a fresh Mac: Get on a tile sets the engine up first, then the model is installed', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: false, installedImages: [], installedVideos: [] } })
  await rail(page, 'Image').click()
  const lane = page.getByTestId('mac-media-image')
  await expect(lane.locator('[data-engine-state="missing"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Installed/ })).toContainText('0')

  const pick = tile(page, 'dreamshaper-xl-turbo')
  await pick.getByRole('button', { name: /^Get/ }).click()
  // One download at a time in a lane: the other tiles wait and say for whom.
  await expect(tile(page, 'sd-turbo').getByRole('button', { name: /^Get/ })).toBeDisabled()
  await expect(pick).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  await expect(lane.locator('[data-engine-state="ready"]')).toBeVisible()

  const calls = (await mlxCalls(page)).map((c) => c.cmd)
  expect(calls.indexOf('install_mlx_diffusion')).toBeGreaterThanOrEqual(0)
  expect(calls.indexOf('install_mlx_diffusion')).toBeLessThan(calls.indexOf('mlx_image_install_model'))
  expect((await mlxCalls(page)).some((c) => c.cmd === 'mlx_image_install_model' && c.id === 'dreamshaper-xl-turbo')).toBe(true)

  // Installed is its own view, and the counters agree with it.
  await page.getByRole('button', { name: /^Installed/ }).click()
  await expect(page.getByTestId('mac-media-image')).toHaveAttribute('data-view', 'installed')
  await expect(tiles(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^Installed/ })).toContainText('1')
  await expect(rail(page, 'Image')).toContainText('1')
})

test('Get auf ein mflux-Paket richtet die mflux-Engine ein und nicht die Sidecar-Engine', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: false, installedImages: [], installedVideos: [] } })
  await rail(page, 'Image').click()
  const lane = page.getByTestId('mac-media-image')
  await expect(lane.locator('[data-engine-state="missing"]')).toBeVisible()

  // Qwen-Image 2.1 is in the mainstream catalogue, in both sizes and as the
  // six step version, each with its license named.
  const pick = tile(page, 'qwen-image-2.1-8bit')
  // The sentences the description ends on are marks on the tile (macTileNotes.ts).
  await expect(pick.locator('[data-tile-note="non-commercial"]')).toHaveAttribute('title', 'Research license, non-commercial use only.')
  // All three have run in LU (real runs, 09.10.2026), so their tiles keep
  // the licence and lose "Experimental". A pack that has not run keeps it.
  for (const id of ['qwen-image-2.1-4bit', 'qwen-image-2.1-8bit', 'qwen-image-2.1-turbo']) {
    const ran = tile(page, id)
    await expect(ran).toBeVisible()
    await expect(ran.locator('[data-tile-note="non-commercial"]')).toHaveAttribute('title', 'Research license, non-commercial use only.')
    await expect(ran.locator('[data-tile-note="experimental"]')).toHaveCount(0)
  }
  await expect(tile(page, 'qwen-image-2512-8bit').locator('[data-tile-note="experimental"]')).toHaveAttribute('title', 'Experimental: not yet tested in LU.')
  await expect(tile(page, 'qwen-image-2.1-turbo')).toContainText('six steps')
  // The diffusers entry of the 20B model is still there.
  await expect(tile(page, 'qwen-image-2512')).toBeVisible()

  await pick.getByRole('button', { name: /^Get/ }).click()
  await expect(pick).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  let calls = await mlxCalls(page)
  expect(calls.some((c) => c.cmd === 'mlx_image_install_model' && c.id === 'qwen-image-2.1-8bit')).toBe(true)
  // Its install brought the engine. The sidecar engine was not set up for it.
  expect(calls.some((c) => c.cmd === 'install_mlx_diffusion')).toBe(false)
  await expect(lane.locator('[data-engine-state="ready"]')).toBeVisible()
  await expect(page.getByRole('button', { name: /^Installed/ })).toContainText('1')

  // A model of the sidecar still sets that engine up before it downloads.
  const sdxl = tile(page, 'dreamshaper-xl-turbo')
  await sdxl.getByRole('button', { name: /^Get/ }).click()
  await expect(sdxl).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  calls = await mlxCalls(page)
  const setup = calls.findIndex((c) => c.cmd === 'install_mlx_diffusion')
  expect(setup).toBeGreaterThanOrEqual(0)
  expect(setup).toBeLessThan(calls.findIndex((c) => c.cmd === 'mlx_image_install_model' && c.id === 'dreamshaper-xl-turbo'))
})

test('the Qwen-Image 2.1 prompt enhancers are tiles of the image lane, and Get installs one without an image engine', async ({ page }) => {
  // GH #148: the official enhancers in their MLX editions, 4-bit, about 6 GB.
  // Their install sets up what runs them (mlx_enhancer.rs), never the sidecar.
  await openModels(page, { ...MAC, mlx: { engineInstalled: false, installedImages: [], installedVideos: [] } })
  await rail(page, 'Image').click()
  const lane = page.getByTestId('mac-media-image')
  for (const id of ['qwen-image-2.1-pe-t2i-4bit', 'qwen-image-2.1-pe-i2i-4bit']) {
    const it = tile(page, id)
    await expect(it).toBeVisible({ timeout: 15_000 })
    await expect(it.locator('[data-tile-note="non-commercial"]')).toHaveAttribute('title', 'Research license, non-commercial use only.')
  }
  await expect(tile(page, 'qwen-image-2.1-pe-t2i-4bit')).toContainText('Prompt Enhancer')
  await expect(tile(page, 'qwen-image-2.1-pe-t2i-4bit')).toContainText(/6(\.0)? GB/)

  const pick = tile(page, 'qwen-image-2.1-pe-t2i-4bit')
  await pick.getByRole('button', { name: /^Get/ }).click()
  await expect(pick).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  const calls = await mlxCalls(page)
  expect(calls.some((c) => c.cmd === 'mlx_image_install_model' && c.id === 'qwen-image-2.1-pe-t2i-4bit')).toBe(true)
  expect(calls.some((c) => c.cmd === 'install_mlx_diffusion')).toBe(false)
  await expect(lane.locator('[data-engine-state="missing"]')).toBeVisible()
})

test('the engine setup can be stopped, and Set up is offered again', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: false, installedImages: [], installedVideos: [], installPolls: 40 } })
  await rail(page, 'Image').click()
  const lane = page.getByTestId('mac-media-image')
  await lane.getByRole('button', { name: /^Set up/ }).click()
  await expect(lane.locator('[data-engine-state="installing"]')).toBeVisible({ timeout: 15_000 })
  await lane.getByRole('button', { name: 'Stop setting up the image engine' }).click()
  await expect(lane.locator('[data-engine-state="missing"]')).toBeVisible({ timeout: 15_000 })
  await expect(lane.getByRole('button', { name: /^Set up/ })).toBeEnabled()
  await expect(lane.getByRole('alert')).toHaveCount(0)
  expect((await mlxCalls(page)).some((c) => c.cmd === 'mlx_image_cancel_install')).toBe(true)
})

test('a running download can be stopped, and the tile offers Get again', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, installedImages: [], installPolls: 40 } })
  await rail(page, 'Image').click()
  const pick = tile(page, 'flux2-klein-4b')
  await pick.getByRole('button', { name: /^Get/ }).click()
  await expect(pick).toHaveAttribute('data-state', 'installing', { timeout: 15_000 })
  await pick.getByRole('button', { name: 'Stop installing FLUX.2 klein 4B' }).click()
  await expect(pick).toHaveAttribute('data-state', 'idle', { timeout: 15_000 })
  await expect(pick.getByRole('button', { name: /^Get/ })).toBeEnabled()
  // Stopped on request is not a failure: no error line.
  await expect(page.getByTestId('mac-media-image').getByRole('alert')).toHaveCount(0)
  expect((await mlxCalls(page)).some((c) => c.cmd === 'mlx_image_cancel_install')).toBe(true)
})

test('an installed model is removed after one question, and Installed is empty again', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, installedImages: ['sd-turbo'] } })
  await rail(page, 'Image').click()
  await page.getByRole('button', { name: /^Installed/ }).click()
  await expect(tiles(page)).toHaveCount(1)
  await tile(page, 'sd-turbo').getByRole('button', { name: 'Remove SD Turbo' }).click()
  const dialog = page.getByRole('dialog', { name: 'Remove model' })
  await expect(dialog).toContainText('SD Turbo')
  await dialog.getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByText('No image models installed yet')).toBeVisible()
  expect((await mlxCalls(page)).some((c) => c.cmd === 'mlx_image_delete_model' && c.id === 'sd-turbo')).toBe(true)
  // The empty state leads back to the catalogue.
  await page.getByRole('button', { name: 'Get new image models' }).click()
  await expect(page.getByTestId('mac-media-image')).toHaveAttribute('data-view', 'discover')
})

test('a failed install says why on the lane and leaves the tile ready to try again', async ({ page }) => {
  const error = 'Model installation did not finish: unet/diffusion_pytorch_model.fp16.safetensors is missing (expected 5.1 GB). Retry the download to repair the missing files.'
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, installedImages: [], imageInstallError: error } })
  await rail(page, 'Image').click()
  const pick = tile(page, 'sd-turbo')
  await pick.getByRole('button', { name: /^Get/ }).click()
  await expect(page.getByTestId('mac-media-image').getByRole('alert')).toContainText(error, { timeout: 20_000 })
  await expect(pick).toHaveAttribute('data-state', 'idle')
  await expect(pick.getByRole('button', { name: /^Get/ })).toBeEnabled()
})

test('video: the installed model is listed, and the lane has both sides of the switch', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, videoEngineInstalled: true, installedVideos: ['wan21-t2v-1.3b'] } })
  await rail(page, 'Video').click()
  const lane = page.getByTestId('mac-media-video')
  await expect(lane.locator('[data-engine-state="ready"]')).toBeVisible()
  await expect(tiles(page).first()).toBeVisible()

  // Eight and eight here too. An official Wan is a mainstream model; the
  // other side holds the adult fine-tunes and the abliterated text encoders.
  const catalogue = lane.getByRole('group', { name: 'Catalogue' })
  const mainstream = catalogue.getByRole('button', { name: /Mainstream/ })
  await expect(mainstream).toHaveAttribute('aria-pressed', 'true')
  const shownMainstream = await tiles(page).count()
  expect(shownMainstream).toBeGreaterThanOrEqual(8)
  await expect(mainstream).toContainText(String(shownMainstream))
  await expect(tile(page, 'wan21-t2v-1.3b')).toHaveAttribute('data-state', 'installed')
  await expect(tile(page, 'wan22-i2v-a14b')).toContainText('It needs a start image')
  await expect(tile(page, 'nsfw-wan21-14b')).toHaveCount(0)

  await catalogue.getByRole('button', { name: /Unfiltered/ }).click()
  const shownUnfiltered = await tiles(page).count()
  expect(shownUnfiltered).toBeGreaterThanOrEqual(8)
  await expect(tile(page, 'nsfw-wan21-14b')).toBeVisible()
  await expect(tile(page, 'ltx-2.3-dev-abliterated').locator('[data-tile-note="experimental"]')).toHaveAttribute('title', 'Experimental: not yet tested in LU.')
  await expect(tile(page, 'wan21-t2v-1.3b')).toHaveCount(0)

  await mainstream.click()
  await page.getByRole('button', { name: /^Installed/ }).click()
  await expect(tiles(page)).toHaveCount(1)
  await expect(rail(page, 'Video')).toContainText('1')
})

test('video: a tile says what its Get fetches, the text encoder included while it is not here', async ({ page }) => {
  // A fresh Mac: 20.5 GB of model and 8.1 GB of text encoder. The tile said
  // the model alone, 19.1 GB, for a download of 26.6.
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, videoEngineInstalled: true, installedVideos: [] } })
  await rail(page, 'Video').click()
  await expect(tile(page, 'ltx-2.3-q4').locator('[data-tile-size]')).toHaveText('26.6 GB')
  await expect(tile(page, 'ltx-2.3-q4').getByRole('button', { name: 'Get', exact: true }))
    .toHaveAttribute('title', 'Install LTX-2.3 Distilled 4-bit (26.6 GB, its text encoder included)')
  // A model that names no encoder of its own is its own size.
  await expect(tile(page, 'wan21-t2v-1.3b').locator('[data-tile-size]')).toHaveText('16.8 GB')
})

test('video: with the text encoder here already, a tile says the model alone, and Installed says the model', async ({ page }) => {
  // The 8-bit pack brought the encoder the 4-bit pack reads too.
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, videoEngineInstalled: true, installedVideos: ['ltx-2.3-q8'] } })
  await rail(page, 'Video').click()
  await expect(tile(page, 'ltx-2.3-q4').locator('[data-tile-size]')).toHaveText('19.1 GB')
  await expect(tile(page, 'ltx-2.3-q4').getByRole('button', { name: 'Get', exact: true }))
    .toHaveAttribute('title', 'Install LTX-2.3 Distilled 4-bit (19.1 GB)')
  await page.getByRole('button', { name: /^Installed/ }).click()
  await expect(tile(page, 'ltx-2.3-q8').locator('[data-tile-size]')).toHaveText('27.8 GB')
})

test('video: a quantized LTX pack brings its own engine, and the first engine is set up only for its own models', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: true, videoEngineInstalled: false, installedVideos: [] } })
  await rail(page, 'Video').click()
  const lane = page.getByTestId('mac-media-video')
  await expect(lane.locator('[data-engine-state="missing"]')).toBeVisible()

  // The packs for Macs under 64 GB are in the catalogue, marked as untested,
  // except the one that has run in LU (real run, 09.10.2026: LTX-2.3 4-bit
  // from text and from an image, with sound).
  const pick = tile(page, 'ltx-2.3-q4')
  await expect(pick).toBeVisible()
  await expect(pick.locator('[data-tile-note="experimental"]')).toHaveCount(0)
  await expect(tile(page, 'ltx-2.3-q8').locator('[data-tile-note="experimental"]')).toHaveAttribute('title', 'Experimental: not yet tested in LU.')
  await expect(tile(page, 'ltx-2.5-q8')).toContainText('Needs a Hugging Face token')
  await pick.getByRole('button', { name: /^Get/ }).click()
  await expect(pick).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  let calls = await mlxCalls(page)
  expect(calls.some((c) => c.cmd === 'video_install_model' && c.id === 'ltx-2.3-q4')).toBe(true)
  // Its install brought the engine. The first engine was not set up for it.
  expect(calls.some((c) => c.cmd === 'video_install_mlx')).toBe(false)
  await expect(lane.locator('[data-engine-state="ready"]')).toBeVisible()

  // A model of the first engine still sets that one up before it downloads.
  const wan = tile(page, 'wan22-ti2v-5b-q8')
  await wan.getByRole('button', { name: /^Get/ }).click()
  await expect(wan).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  calls = await mlxCalls(page)
  const setup = calls.findIndex((c) => c.cmd === 'video_install_mlx')
  expect(setup).toBeGreaterThanOrEqual(0)
  expect(setup).toBeLessThan(calls.findIndex((c) => c.cmd === 'video_install_model' && c.id === 'wan22-ti2v-5b-q8'))

  // The other side has the adult packs and the abliterated variants.
  await lane.getByRole('group', { name: 'Catalogue' }).getByRole('button', { name: /Unfiltered/ }).click()
  for (const id of ['10eros-v1.3-dmd-q4', '10eros-v1.5-dmd-hybrid-q8', 'sulphur-2-distill-q4', 'ltx-2.3-q8-abliterated']) {
    await expect(tile(page, id)).toBeVisible()
  }
})

test('no ComfyUI word and no Pull button on the Mac media rails', async ({ page }) => {
  await openModels(page, { ...MAC, mlx: { engineInstalled: true } })
  for (const name of ['Image', 'Video'] as const) {
    await rail(page, name).click()
    await expect(page.getByTestId(`mac-media-${name.toLowerCase()}`)).toBeVisible()
    await expect(page.getByText(/ComfyUI/i)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /^Pull$/ })).toHaveCount(0)
  }
})

test('LoRAs: the rail leads to the folder of the image engine, with its files, Open folder and Delete', async ({ page }) => {
  // Until 09.10.2026 the Mac had no LoRA rail: there was no folder it could
  // have shown. The image engine has one now, and this is its lane.
  await openModels(page, {
    ...MAC,
    mlx: {
      engineInstalled: true,
      loras: [
        { name: 'qwen/detail.safetensors', sizeBytes: 153_000_000 },
        { name: 'zimage-style.safetensors', sizeBytes: 41_000_000, keys: 'kohya' },
      ],
    },
  })
  const loraRail = lanes(page).getByRole('button', { name: /^LoRAs/ })
  await expect(loraRail).toContainText('2')
  await loraRail.click()
  await expect(page.getByRole('heading', { level: 1, name: 'LoRAs' })).toBeVisible()
  const lane = page.getByTestId('mac-lora-lane')

  // Get new: where a file goes, and a CivitAI search for Qwen-Image 2.1.
  await expect(lane.getByTestId('mac-lora-folder')).toContainText('/tmp/lu-e2e/loras')
  await expect(lane.getByRole('textbox', { name: 'Search CivitAI for Qwen-Image 2.1 LoRAs' })).toBeVisible()
  await expect(page.getByText(/ComfyUI/i)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Pull$/ })).toHaveCount(0)

  await page.locator('[data-models-view]').getByRole('button', { name: /^Installed/ }).click()
  const rows = lane.getByTestId('lora-row')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0)).toContainText('qwen/detail.safetensors')
  await expect(rows.nth(0)).toContainText(/MB/)
  await expect(rows.nth(1).getByTestId('lora-keys-note')).toContainText('Qwen-Image 2.1 does not')
  // The Mac design: the tile surface for a row, the tinted action for the folder.
  await expect(lane.locator('[data-testid="lora-row"].lu-tile')).toHaveCount(2)
  await expect(lane.getByRole('button', { name: /Open folder/ })).toHaveClass(/lu-tonal/)
  if (process.env.LU_SHOTS) await page.screenshot({ path: `${process.env.LU_SHOTS}/mac-lora-lane.png` })

  await lane.getByRole('button', { name: /Open folder/ }).click()
  await expect.poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_loras_open_folder').length).toBe(1)

  // Delete asks first, then takes that one file.
  await lane.getByRole('button', { name: 'Delete zimage-style.safetensors' }).click()
  expect((await mlxCalls(page)).filter((c) => c.cmd === 'mlx_lora_delete')).toHaveLength(0)
  await expect(page.getByRole('dialog')).toContainText('The file moves to the Trash.')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(rows).toHaveCount(1)
  await expect(loraRail).toContainText('1')
  const deleted = (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_lora_delete')
  expect(deleted.map((c) => c.raw.name)).toEqual(['zimage-style.safetensors'])
})

test('LoRAs on Windows stay the ComfyUI lane, and the Mac folder is never asked for', async ({ page }) => {
  await openModels(page, { ...MAC, platform: 'windows' })
  await lanes(page).getByRole('button', { name: /^LoRAs/ }).click()
  await expect(page.getByText(/Downloads land in ComfyUI's models\/loras folder/)).toBeVisible()
  await expect(page.getByTestId('mac-lora-lane')).toHaveCount(0)
  await expect(page.getByRole('textbox', { name: 'Search CivitAI for LoRAs' })).toBeVisible()
  expect((await mlxCalls(page)).filter((c) => c.cmd.startsWith('mlx_lora'))).toHaveLength(0)
})

test('chat on a Mac speaks of memory and of this Mac, never of a card, a GPU or a PC', async ({ page }) => {
  // A Mac has one memory pool. The rail used to read "32 GB GPU · 32 GB RAM",
  // "Fits my PC", "picked for your PC", "Runs on your PC" and "No GPU" here.
  await page.addInitScript(tauriMockInit, { ...MAC, mlx: { engineInstalled: true } })
  await giveMachineMemory(page, { ramGb: 32, vramGb: 32 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await rail(page, 'Chat').click()

  const pane = page.getByTestId('models-pane')
  // The readout stands in the foot of the rail from 1024 px up; the chip in
  // the pane is the narrow window's copy and is hidden here. Ask the one a
  // person sees.
  const readout = page.locator('aside [data-hardware-chip="shared"]')
  await expect(readout).toBeVisible()
  await expect(readout).toHaveText('32 GB memory')
  const size = pane.getByRole('group', { name: 'Size' })
  await expect(size.getByRole('button', { name: /^Fits my Mac/ })).toContainText('32 GB')
  await expect(pane.getByRole('region', { name: 'Start here' })).toContainText('picked for this Mac')
  await expect(pane.locator('[data-model-tile]').first()).toBeVisible()
  await expect(pane.locator('[data-fit="fits"]').first()).toHaveText('Runs on this Mac')

  // Both catalogues, every tile: the words of a PC are gone.
  const pcWords = /your PC|my PC|\bGPUs?\b|VRAM|\bCPU\b|\d+ ?GB cards?\b|RTX|Blackwell/
  for (const side of ['Mainstream', 'Unfiltered'] as const) {
    await pane.getByRole('group', { name: 'Catalogue' }).getByRole('button', { name: side }).click()
    await expect(pane.locator('[data-model-tile]').first()).toBeVisible()
    expect((await pane.innerText()).match(pcWords), `${side} catalogue`).toBeNull()
  }

  // "Fits my Mac" filters by the share of the pool a model can take (about
  // 22 GB of 32), so a 70 GB build is not offered as a fit.
  await pane.getByRole('group', { name: 'Catalogue' }).getByRole('button', { name: 'Mainstream' }).click()
  await size.getByRole('button', { name: /^Fits my Mac/ }).click()
  await expect(pane.locator('[data-model-tile]').first()).toBeVisible()
  await expect(pane.locator('[data-fit="big"]')).toHaveCount(0)
})

test('COUNTER-CHECK: the same chat rail on a PC still names the GPU and the PC', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME })
  await giveMachineMemory(page, { ramGb: 32, vramGb: 12 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await rail(page, 'Chat').click()
  const pane = page.getByTestId('models-pane')
  // A PC keeps the page as it was before the redesign (08.10.2026: the
  // new design is for the Mac only), so the readout is the chip in the filter
  // row of the pane, and the rail has no foot that repeats it.
  await expect(pane.getByText('12 GB GPU', { exact: true })).toBeVisible()
  await expect(pane.getByText('32 GB RAM', { exact: true })).toBeVisible()
  await expect(lanes(page)).toBeVisible()
  await expect(lanes(page).getByText(/GB (GPU|RAM|memory)/)).toHaveCount(0)
  await expect(pane.getByRole('group', { name: 'Size' }).getByRole('button', { name: /^Fits my PC/ })).toContainText('≤12 GB')
  await expect(pane.locator('[data-fit="fits"]').first()).toHaveText('Runs on your PC')
  await expect(page.locator('[data-hardware-chip="shared"]')).toHaveCount(0)
  // And it is the classic build as a whole: "Models" as the heading with the
  // segmented Get new / Installed beside it, the tile on its own measure. The
  // colours are the Mac's since 10.10.2026, so the surfaces are the house
  // recipes here as well.
  await expect(pane.getByRole('heading', { level: 1 })).toHaveText('Models')
  await expect(pane.locator('h1 ~ [data-models-view]')).toBeVisible()
  await expect(page.locator('aside[aria-label="Model lanes"]')).toHaveCount(0)
  await expect(pane.locator('[data-model-tile].lu-tile').first()).toBeVisible()
  await expect(pane.locator('[data-model-tile]').first()).toHaveCSS('padding', '12px')
  await expect(pane.locator('[data-model-tile] .lu-tonal').first()).toBeVisible()
})

test('COUNTER-CHECK of the counter-check: a Mac draws the new face', async ({ page }) => {
  await openModels(page, MAC)
  await rail(page, 'Chat').click()
  const pane = page.getByTestId('models-pane')
  await expect(pane.getByRole('heading', { level: 1 })).toHaveText('Chat models')
  await expect(page.locator('aside[aria-label="Model lanes"]')).toBeVisible()
  await expect(pane.locator('[data-model-tile].lu-tile').first()).toBeVisible()
  await expect(pane.locator('.lu-tonal').first()).toBeVisible()
  await expect(pane.locator('h1 ~ [data-models-view]')).toHaveCount(0)
})

test('video: the model that ran fast leads the Mainstream side, and Wan 1.3B says what was measured', async ({ page }) => {
  // Real run on an M5 Pro with 48 GB, 09.10.2026: LTX-2.3 Distilled 4-bit
  // made its clip in 64 s. Wan 2.1 T2V 1.3B took half an hour for five
  // seconds, without sound, at 24.5 GB against the 16 its tile promised.
  await page.addInitScript(tauriMockInit, { ...MAC, mlx: { engineInstalled: true, videoEngineInstalled: true, installedVideos: [] } })
  await giveMachineMemory(page, { ramGb: 16, vramGb: 16 })
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await rail(page, 'Video').click()
  const lane = page.getByTestId('mac-media-video')
  await expect(lane).toBeVisible()

  // The grid keeps the order of the catalogue.
  await expect(tiles(page).first()).toHaveAttribute('data-mac-media-tile', 'ltx-2.3-q4')
  await expect(tiles(page).nth(1)).toHaveAttribute('data-mac-media-tile', 'wan21-t2v-1.3b')

  // On 16 GB the starter fits, and Wan is recommended from 32 GB on. Its
  // download is not held back.
  const ltx = tile(page, 'ltx-2.3-q4')
  await expect(ltx.locator('[data-memory-fit]')).toHaveAttribute('data-memory-fit', 'fits')
  await expect(ltx.getByRole('button', { name: /^Get$/ })).toBeVisible()
  const wan = tile(page, 'wan21-t2v-1.3b')
  await expect(wan.locator('[data-memory-fit]')).toHaveAttribute('data-memory-fit', 'big')
  await expect(wan).toContainText('Needs a Mac with 32 GB memory')
  await expect(wan.getByRole('button', { name: /Get anyway/ })).toBeEnabled()
  // What was measured stands in the lines the tile shows, not only in the
  // tooltip: the text is cut after two lines.
  const text = wan.locator('p').first()
  await expect(text).toContainText('Slow on a Mac: about half an hour for five seconds on an M5 Pro, and without sound.')
  const shown = await text.evaluate((p) => {
    // The share of the sentence that is inside the box the two lines leave.
    const range = document.createRange()
    const node = p.firstChild!
    const end = (node.textContent ?? '').indexOf('without sound.') + 'without sound.'.length
    range.setStart(node, end - 1)
    range.setEnd(node, end)
    return range.getBoundingClientRect().bottom <= p.getBoundingClientRect().bottom + 1
  })
  expect(shown, 'the measured sentence ends inside the two lines').toBe(true)

  // "Fits my Mac" goes by the same number.
  await lane.getByRole('group', { name: 'Memory' }).getByRole('button', { name: /^Fits my Mac/ }).click()
  await expect(ltx).toBeVisible()
  await expect(wan).toHaveCount(0)
  // And the buckets: recommended from 32 GB on is "Medium", not "Light".
  await lane.getByRole('group', { name: 'Memory' }).getByRole('button', { name: /^Light/ }).click()
  await expect(ltx).toBeVisible()
  await expect(wan).toHaveCount(0)
  await lane.getByRole('group', { name: 'Memory' }).getByRole('button', { name: /^Medium/ }).click()
  await expect(wan).toBeVisible()
})
