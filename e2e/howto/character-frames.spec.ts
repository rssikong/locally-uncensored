import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'
import { noPriceFixtures } from './no-price'

// Use frames of a video for a character (3.0.7). Recorded on the 3.0.7
// Desktop release head 0a62b652d in Cloud mode. Facts, all from that head:
//  - components/create/experimental/Lightbox.tsx: the large view of a video
//    has the button "Use frames for a character" (title "Take frames of this
//    video for a training set or a saved character"); OutputView.tsx has the
//    same action as an icon on the stage.
//  - lib/video-frames.ts: DEFAULT_EVEN_FRAMES 8, MIN_EVEN_FRAMES 4,
//    MAX_EVEN_FRAMES 20; evenFrameTimes takes the middle of each of the equal
//    parts of the clip.
//  - SaveCharacterModal.tsx: the window "Use frames for a character" takes the
//    first set on its own, the slider "Frames across the clip" with "Take N
//    frames", a click on a frame unticks it ("Untick frame N"), the line
//    "N of M frames ticked. Untick the ones that do not show the figure
//    clearly.", "Train with N frames" opens Character Studio with the ticked
//    frames as the training set, "Save character" keeps them as a named
//    character on this computer.
//  - CHANGELOG 3.0.7: this has run in automated tests only. The film shows
//    the controls and promises nothing about a trained result.
//
// Fixtures (nothing on the page is altered):
//  1. create-store in localStorage: the gallery holds one finished cloud
//     video, as an earlier session leaves it (the way
//     e2e/create-save-character.spec.ts does it). Not real: no such run.
//  2. The cloud serves that video (page.route on lu-labs.ai/e2e/...): an 8 s
//     VP9 clip made with ffmpeg from the example crops of the paper-cut fox
//     of the Cloud character film (character/assets/fox-1..6.jpg), one second
//     per picture, with two seconds of forest without the fox (crops of
//     fox-3 and fox-5). No model made it.
//  3. no-price.ts: the catalog without prices that are not public, the Hosted
//     balance of the public plan.
// The frames are real: Chromium decodes the clip and the canvas reads them.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('character-frames', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const rec = await Rec.boot(page, 'character-frames', 'Use frames of a video for a character', {
    scenario: { tier: 'hosted' },
    initScript: () => {
      // Fixture 1: the gallery an earlier session leaves.
      if (!localStorage.getItem('create-store')) {
        localStorage.setItem('create-store', JSON.stringify({ state: { gallery: [{
          id: 'job-video-1', type: 'video', filename: 'fox-walk.webm', subfolder: '', prompt: 'a paper-cut fox walks through a pine forest',
          negativePrompt: '', model: 'wan-2.2-spicy', modelType: 'wan', seed: 7, steps: 20, cfgScale: 5, sampler: '', scheduler: '',
          width: 512, height: 512, batchSize: 1, createdAt: 1_760_000_000_000,
          remoteUrl: 'https://lu-labs.ai/e2e/fox-walk.webm', jobId: 'job-video-1', intent: 'video',
        }] }, version: 2 }))
      }
    },
    // Fixtures 2 and 3.
    fixtures: noPriceFixtures({ files: { '/e2e/fox-walk.webm': { file: `${HOWTO_OUT}/character-frames/assets/clip.webm`, type: 'video/webm' } } }),
  })
  await rec.openCreate('Video')
  // The video is on the stage when the film starts (a click on its gallery
  // tile, not the subject).
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  await page.locator('aside button:has(video)').first().click()
  await page.getByRole('button', { name: 'Collapse gallery' }).click()
  const full = page.getByTitle('Fullscreen')
  await expect(full).toHaveCount(1, { timeout: 15_000 })
  await page.mouse.move(1000, 560)

  await rec.key(900)
  rec.hold(0.3)
  rec.scene('The large view of a video has Use frames for a character.')
  const stageVideo = page.locator('main video').first()
  await rec.move(stageVideo, { dur: 0.7, at: { fx: 0.6, fy: 0.4 } })
  await rec.key(400)
  await rec.click(full, { dur: 0.5, settle: 900, after: 0.3 })
  const use = page.getByRole('button', { name: 'Use frames for a character', exact: true })
  await expect(use).toBeVisible()
  await rec.cam(use, 1.5, 0.8)
  await rec.move(use, { dur: 0.7 })
  await rec.key(400)
  rec.hold(0.4)
  await rec.cam('full', 1, 0.6)
  const dialog = page.getByRole('dialog', { name: 'Use frames for a character' })
  const frames = dialog.getByTestId('character-frames').locator('img')
  await rec.click(use, { dur: 0.2, settle: 300, after: 0.2, until: () => expect(frames).toHaveCount(8, { timeout: 20_000 }) })

  rec.scene('LU takes 8 frames spread evenly over the clip. The slider takes 4 to 20.')
  await rec.key(600)
  const slider = dialog.getByLabel('Frames across the clip')
  await rec.cam(slider, 1.35, 0.8)
  await rec.move(slider, { dur: 0.7, at: { fx: 0.4 } })
  await rec.key(300)
  rec.hold(1.0)
  await rec.move(dialog.getByTestId('character-frames'), { dur: 0.6, at: { fx: 0.5, fy: 0.95, dy: 10 }, real: false })
  rec.hold(0.6)

  rec.scene('Untick the frames that do not show the figure.')
  await rec.click(dialog.getByRole('button', { name: 'Untick frame 3' }), { dur: 0.6, settle: 400, after: 0.3 })
  await rec.click(dialog.getByRole('button', { name: 'Untick frame 6' }), { dur: 0.5, settle: 400, after: 0.2 })
  await expect(dialog.getByTestId('frames-picked')).toContainText('6 of 8 frames ticked.')
  await rec.move(dialog.getByTestId('frames-picked'), { dur: 0.5, at: { fx: 0.2, dy: 16 }, real: false })
  rec.hold(1.0)

  rec.scene('Then train with the rest in Character Studio, or save them as a character.')
  const train = dialog.getByRole('button', { name: 'Train with 6 frames' })
  // Between Train and Save character, so both stay in frame.
  const db = (await dialog.boundingBox())!
  const tb = (await train.boundingBox())!
  await rec.cam({ x: Math.round(db.x + db.width / 2), y: Math.round(tb.y + 12) }, 1.3, 0.8)
  await rec.move(dialog.getByRole('button', { name: 'Save character' }), { dur: 0.7 })
  await rec.key(300)
  rec.hold(0.6)
  await rec.move(train, { dur: 0.6 })
  await rec.cam('full', 1, 0.6)
  await rec.click(train, { dur: 0.2, settle: 900, after: 0.2 })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByText(/^6\/30 photos\./)).toBeVisible()
  await rec.move(page.getByText(/^6\/30 photos\./), { dur: 0.6, at: { fx: 0.15, dy: 16 }, real: false })
  rec.hold(1.0)
  rec.finish(1.0)
})
