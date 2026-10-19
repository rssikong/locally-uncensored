import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Motion Control on a Mac (3.0.7). Recorded on integ/307 (ddeccc9ce) with
// platform 'mac' in Local mode. Facts, all from that head:
//  - src-tauri/src/commands/video_motion.rs:1 to 80: Motion Control runs on an
//    LTX-2.3 pack of the second engine (takes_motion: PACK_23 and PACK_23_V11,
//    LTX-2.3 Distilled 4-bit among them, no LTX-2.5) with the IC-LoRA Union
//    Control of Lightricks, NAME "Motion Control for LTX-2.3", SIZE_BYTES
//    654_465_352. The motion clip is turned into an edge map first
//    (control_filter), the LoRA was trained on such maps.
//  - components/create/experimental/intents.ts:248 to 259 (runsOnMlx) and
//    api/mlx-video.ts:382 (mlxFollowsMotion): the tab is local while such a
//    pack is installed; the LoRA comes with the tab's install card.
//  - Stage.tsx:723 to 728: the card "Local motion control needs a one-time
//    download", "This downloads Motion Control for LTX-2.3 (about 650 MB)..."
//    with Download & install (CreateContext.tsx:468 installModelBundle,
//    api/mlx-install.ts:203 kind 'motion').
//  - SpecialIntentControls.tsx MotionControls: Add character image and Add
//    driving video (dance/pose); no prompt field (useCreate.ts:1205 sends
//    MLX_MOTION_PROMPT, api/mlx-video.ts:396).
//  - Composer.tsx:821 to 845: the one setting on this row is Length, in frames
//    on the pack's grid (49 frames at 24 a second by default, "49 frames ·
//    2.0s").
//  - hooks/useCreate.ts:1185 to 1400: Create stages the image and the motion
//    clip (video_stage_motion_video), runs video_generate on the pack and puts
//    the clip in the gallery; the line under it names the model.
//  - CHANGELOG 3.0.7, Known limits: the download Motion Control offers on its
//    tab has run in automated tests only. The film shows the button, not a
//    real download. The run ran with the real engine on one Mac (2 seconds at
//    512 x 512 in 103 seconds on an M5 Pro); no time is named in the film.
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second video engine set up,
//     LTX-2.3 Distilled 4-bit installed, the Motion Control LoRA not.
//     Not real: nothing is installed on a real Mac.
//  2. Download & install runs the mock's install (two polls, then on disk).
//     Not real: nothing is downloaded.
//  3. fox.jpg and drive.webm are the example files of the motion film (a
//     picture and a short VP9 clip of a landscape, not a dancer).
//  4. The run is the mock's (one poll, then complete). window.__E2E_MEDIA_FILES__
//     answers the clip's path with result.webm, the fox as a still clip of two
//     seconds made with ffmpeg. Not real: LTX-2.3 made no clip, nothing moves.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-motion', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const dir = `${HOWTO_OUT}/mac-motion/assets`
  const clip = readFileSync(`${dir}/result.webm`).toString('base64')
  const rec = await Rec.boot(page, 'mac-motion', 'Motion Control on a Mac', {
    mode: 'local',
    // Fixtures 1 and 2.
    tauri: {
      platform: 'mac',
      mlx: { engineInstalled: true, ltx2EngineInstalled: true, installedVideos: ['ltx-2.3-q4'] },
    },
    // Fixture 4.
    fixtures: async (p) => { await p.addInitScript((b64: string) => {
      (window as unknown as { __E2E_MEDIA_FILES__: Record<string, string> }).__E2E_MEDIA_FILES__ = { '/tmp/lu-e2e/videos/e2e-vid.mp4': b64 }
    }, clip) },
  })
  await rec.openCreate('Motion Control')
  const card = page.getByText('Local motion control needs a one-time download')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(1000, 700)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Motion runs on LTX-2.3. The tab gets its Motion Control LoRA, about 650 MB.')
  await rec.cam(card, 1.4, 0.8)
  await rec.move(page.getByText(/about 650 MB/), { dur: 0.6, at: { dy: 20 }, real: false })
  rec.hold(0.5)
  const image = page.getByRole('button', { name: 'Add character image' })
  await rec.click(page.getByRole('button', { name: /Download & install/i }), {
    dur: 0.6, settle: 500, after: 0.5,
  })
  await expect(card).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByText('Setting this up for you')).toHaveCount(0, { timeout: 30_000 })
  await expect(page.getByTestId('mac-video-length')).toBeVisible({ timeout: 15_000 })
  await rec.key(600)
  rec.hold(0.5)

  rec.scene('A start image and a motion clip. LU turns the clip into edges, and the video follows them.')
  await rec.cam(image, 1.35, 0.7)
  let chooser = page.waitForEvent('filechooser')
  await rec.click(image, { dur: 0.5, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${dir}/fox.jpg`)
  await expect(page.getByRole('button', { name: 'Image ready' })).toBeVisible()
  await rec.key(500)
  chooser = page.waitForEvent('filechooser')
  await rec.click(page.getByRole('button', { name: 'Add driving video (dance/pose)' }), { dur: 0.5, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${dir}/drive.webm`)
  await expect(page.getByRole('button', { name: 'drive.webm' })).toBeVisible()
  await rec.key(600)
  rec.hold(1.3)

  rec.scene('No prompt here. Length is the one setting, 49 frames make 2 seconds.')
  const length = page.getByTestId('mac-video-length')
  await expect(length).toContainText('49 frames')
  await rec.cam(length, 1.5, 0.7)
  await rec.move(length, { dur: 0.6, at: { dy: 16 }, real: false })
  rec.hold(1.3)

  rec.scene('Create makes the video on this Mac and puts it in the gallery.')
  await rec.cam('full', 1, 0.7)
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), {
    dur: 0.6, settle: 900, after: 0.2,
    until: () => expect(page.locator('video').first()).toBeAttached({ timeout: 20_000 }),
  })
  await rec.click(page.getByRole('button', { name: 'Open the gallery' }), { dur: 0.6, settle: 1200, after: 0.1 })
  const line = page.getByText(/^seed \d+$/).first()
  await rec.cam(line, 1.5, 0.7)
  await rec.move(line, { dur: 0.5, at: { dy: 20 }, real: false })
  rec.hold(0.6)
  const item = page.locator('aside, [role="complementary"]').locator('video').first()
  await rec.move(item, { dur: 0.6 })
  rec.hold(0.8)
  await rec.cam('full', 1, 0.8)
  rec.finish(0.6)
})
