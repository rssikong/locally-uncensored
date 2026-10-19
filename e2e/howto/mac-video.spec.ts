import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Video on a Mac (3.0.7). Recorded on integ/307 (0a62b652d) with platform
// 'mac' in Local mode. Facts, all from that head:
//  - src-tauri/src/commands/video.rs size_grid, max_pixels, run_size: the
//    quantized LTX packs (ltx_2q) take a size on a grid of 64 px, Wan on 16
//    (32 for TI2V 5B), never more pixels than the entry's own size, sides 256
//    to 1280. default_steps and run_steps: Wan alone takes steps, 1 to 60.
//  - components/create/experimental/ParamGroups.tsx (macSize, macRunSize):
//    with such a model, Advanced settings, Quality has Width and Height on
//    the model's grid and the line "Runs at <w>×<h> px. This model takes
//    sizes in steps of 64 px, up to the pixels of its own 768×512."
//  - video.rs takes_loras and ParamGroups.tsx macLoras: the LTX packs of the
//    second engine and Wan take the LoRA stack, which lists the files of the
//    Mac's LoRA folder (api/mlx-loras), with Open folder and Rescan.
//  - components/create/experimental/intents.ts runsOnMlx: Extend Video is a
//    local tab exactly while Animate is one, that is while an installed video
//    model takes a start image (video.rs takes_start_image: every ltx_2q
//    pack). SpecialIntentControls.tsx LocalExtendControls and lastFrameFile:
//    the last frame of the picked clip becomes the start image of the run;
//    "Pick the clip to extend" offers "Upload a video file".
//  - Seen while recording, reported, not part of the captions: on the Mac's
//    Extend tab the composer row is the ComfyUI one (Quality (steps), Size
//    336p/512p/768p, Frames) and the Negative toggle shows, because
//    Composer.tsx checks intent 'video' or 'animate' only (lines 267, 781).
//  - Not shown: Wan steps and the Shots slider of the LTX-2.5 packs
//    (ParamGroups.tsx showShots). The LU Cloud line of CreateCloudOffer does
//    not show in this setup (it has run in automated tests only).
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine, both video engines set up,
//     LTX-2.3 Distilled 4-bit installed. Not real: nothing is installed.
//  2. The Mac's LoRA folder holds one file, example-slow-pan_ltx.safetensors,
//     with lora_A/lora_B keys (mock option mlx.loras). Not real: an example
//     name, no such file exists.
//  No run is made, so no video is shown.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const LORA = 'example-slow-pan_ltx.safetensors'

test('mac-video', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'mac-video', 'Video on a Mac', {
    mode: 'local',
    tauri: {
      platform: 'mac',
      // Fixtures 1 and 2.
      mlx: {
        engineInstalled: true, videoEngineInstalled: true, ltx2EngineInstalled: true,
        installedVideos: ['ltx-2.3-q4'],
        loras: [{ name: LORA, keys: 'peft' }],
      },
    },
  })
  await rec.openCreate('Video')
  const chip = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: 'LTX-2.3 Distilled 4-bit' })
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('cloud-offer-create')).toHaveCount(0)
  await page.mouse.move(1000, 700)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, LTX and Wan take a size. The line says what runs on the engine\'s grid.')
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.8, settle: 900, after: 0.2 })
  const size = page.getByTestId('mac-video-size')
  await expect(size).toContainText('Runs at 768×512 px')
  await rec.cam(size, 1.5, 0.8)
  await rec.click(page.getByRole('button', { name: '1:1', exact: true }), { dur: 0.7, settle: 600, after: 0.2 })
  await expect(size).toContainText('Runs at 576×576 px')
  await rec.move(size, { dur: 0.6, at: { dy: 24 }, real: false })
  rec.hold(1.4)

  rec.scene('The LoRA stack lists the Mac\'s LoRA folder. A LoRA turned on goes into the run.')
  if (!(await page.getByText(/^LoRA stack/).isVisible().catch(() => false))) {
    await rec.click(page.getByRole('button', { name: 'Expert', exact: true }), { dur: 0.6, settle: 700, after: 0.2 })
  }
  const row = page.getByRole('button', { name: /example-slow-pan_ltx/ })
  await expect(row).toBeVisible()
  await row.scrollIntoViewIfNeeded()
  await rec.key(400)
  await rec.cam(row, 1.5, 0.8)
  await rec.click(row, { dur: 0.7, settle: 600, after: 0.2 })
  await expect(page.getByText(/LoRA stack · 1 active/)).toBeVisible()
  await rec.move(page.getByRole('button', { name: 'Open folder' }), { dur: 0.6, real: false })
  rec.hold(1.2)

  rec.scene('With a model that starts from an image, Extend Video runs on the Mac too.')
  await rec.cam('full', 1, 0.8)
  await page.keyboard.press('Escape')
  await rec.key(400)
  await rec.click(page.getByRole('radio', { name: 'Extend Video', exact: true }), { dur: 0.8, settle: 900, after: 0.2 })
  const pick = page.getByRole('button', { name: 'Pick the clip to extend' })
  await expect(pick).toBeVisible()
  await rec.cam(pick, 1.7, 0.8)
  await rec.click(pick, { dur: 0.7, settle: 600, after: 0.2 })
  await expect(page.getByRole('button', { name: 'Upload a video file' })).toBeVisible()
  rec.hold(0.4)

  rec.scene('The last frame of your clip is where the next part starts.')
  await rec.move(page.getByRole('button', { name: 'Upload a video file' }), { dur: 0.6, real: false })
  rec.hold(1.6)
  await rec.cam('full', 1, 0.9)
  rec.finish(1.0)
})
