import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Talking Character on a Mac (3.0.7). Recorded on integ/307 (ddeccc9ce) with
// platform 'mac' in Local mode. Facts, all from that head:
//  - src-tauri/src/commands/video.rs:276 to 294 (CATALOG, "ltx-2.3-q4") and
//    1022 (talks): LTX-2.3 Distilled 4-bit is the one entry that talks, with
//    talking_gb 11.3, the files its a2v run reads on top of the model.
//  - components/create/experimental/intents.ts:252 to 259 (runsOnMlx) and
//    api/mlx-video.ts:414 (mlxTalking): the tab is a local tab while such a
//    model is installed; lib/mac-talking.ts:27 (MAC_TALKING_NO_MODEL): the
//    model comes from the Model Manager.
//  - SpecialIntentControls.tsx:1012 to 1058 (MacTalkingPart): the line "Talking
//    Character runs on LTX-2.3 Distilled 4-bit and needs one more download for
//    it, 11.3 GB." and the button Get Talking Character (api/mlx-install.ts:337
//    installMlxTalking, the part 'talking' of video_install_model).
//  - SpecialIntentControls.tsx:953 to 985 (LipsyncControls): on a Mac a
//    portrait and a voice, never a clip to resync; VoiceChip:1147 offers
//    Generate a voice (AI) in cloud mode only, so here the voice is an upload.
//    MacTalkingWords:991: "What does the voice say? Optional, the lips follow
//    the words better with it" (lib/mac-talking.ts macTalkingPrompt).
//  - Composer.tsx:814 to 819: no setting on this tab, the row reads "clip
//    length follows your voice, up to 10 seconds" (video_ltx2mlx.rs:101
//    TALKING_MAX_FRAMES 241, at 24 a second).
//  - video.rs:1037 (TALKING_MIN_RAM_GB 24): a run needs a Mac with 24 GB or
//    more, below that it is refused before it loads (not filmed).
//  - The tab reads Lipsync in the tab bar; its full name (the radio's label)
//    is Talking Character (intents.ts).
//  - hooks/useCreate.ts:1185 to 1400: Create stages the portrait and the voice,
//    runs video_generate on LTX-2.3 Distilled 4-bit and puts the clip in the
//    gallery; the line under the result names the model (MLX LTX-2.3
//    Distilled 4-bit, the picker's name).
//  - CHANGELOG 3.0.7, Known limits: the download Talking Character offers on
//    its tab has run in automated tests only. The film shows the button, not a
//    real download. The run itself ran with the real engine on one Mac, slow:
//    about 150 seconds per second of clip on an M5 Pro, so the caption says
//    minutes per second of clip and names no exact time.
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second video engine set up,
//     LTX-2.3 Distilled 4-bit installed, its Talking Character part not.
//     Not real: nothing is installed on a real Mac.
//  2. Get Talking Character runs the mock's install (two polls, then on disk).
//     Not real: nothing is downloaded.
//  3. portrait.jpg is the example fox of the lipsync film, voice.wav its four
//     second tone made with ffmpeg. The words are an example typed in the film.
//  4. The run is the mock's (one poll, then complete). window.__E2E_MEDIA_FILES__
//     answers the clip's path with result.webm, the portrait as a still clip
//     of four seconds made with ffmpeg. Not real: LTX-2.3 made no clip, and the
//     lips in the gallery do not move.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-lipsync', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const dir = `${HOWTO_OUT}/mac-lipsync/assets`
  const clip = readFileSync(`${dir}/result.webm`).toString('base64')
  const rec = await Rec.boot(page, 'mac-lipsync', 'Talking Character on a Mac', {
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
  await rec.openCreate('Talking Character')
  const part = page.getByTestId('mac-talking-part')
  await expect(part).toContainText('needs one more download for it, 11.3 GB', { timeout: 15_000 })
  await page.mouse.move(1000, 700)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Lipsync (Talking Character) runs on LTX-2.3 Distilled 4-bit. The tab gets its extra 11.3 GB.')
  await rec.cam(part, 1.5, 0.8)
  await rec.move(part.getByText(/needs one more download/), { dur: 0.6, at: { dy: 20 }, real: false })
  rec.hold(0.4)
  await rec.click(part.getByRole('button', { name: 'Get Talking Character' }), {
    dur: 0.6, settle: 500, after: 0.2,
    until: () => expect(part).toHaveCount(0, { timeout: 20_000 }),
  })
  rec.hold(0.3)

  rec.scene('Add a portrait and a voice recording. What the voice says is optional and helps the lips.')
  const portrait = page.getByRole('button', { name: 'Add portrait' })
  await rec.cam(portrait, 1.35, 0.7)
  let chooser = page.waitForEvent('filechooser')
  await rec.click(portrait, { dur: 0.5, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${dir}/portrait.jpg`)
  await expect(portrait).toHaveCount(0, { timeout: 10_000 })
  await rec.key(500)
  await rec.click(page.getByRole('button', { name: 'Add voice' }), { dur: 0.45, settle: 500, after: 0.1 })
  chooser = page.waitForEvent('filechooser')
  await rec.click(page.getByRole('button', { name: 'Upload an audio file' }), { dur: 0.35, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${dir}/voice.wav`)
  await expect(page.getByRole('button', { name: 'voice.wav' })).toBeVisible()
  await rec.key(500)
  const words = page.getByLabel('What the voice says')
  await rec.click(words, { dur: 0.45, at: { fx: 0.15 }, settle: 200, after: 0 })
  await rec.type(words, 'Hello, I am Rusty.', { per: 2, cps: 30 })
  rec.hold(0.3)

  rec.scene('No settings: the clip follows your voice, up to 10 seconds. It needs a Mac with 24 GB or more.')
  const length = page.getByTestId('mac-talking-length')
  await rec.cam(length, 1.5, 0.7)
  await rec.move(length, { dur: 0.6, at: { dy: 18 }, real: false })
  rec.hold(1.4)

  rec.scene('Create makes the clip on this Mac, which takes minutes per second of clip, and puts it in the gallery.')
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
