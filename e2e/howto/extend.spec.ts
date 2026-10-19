import { test, expect } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { bootPublic, ASSETS } from './public-catalog'

// How Extend works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Extend 1, 2);
// SpecialIntentControls.tsx CloudExtendControls ("Pick one of your cloud
// videos": the list holds the gallery's cloud videos and nothing else, there is
// no upload on the cloud lane); intents.ts ("Describe how the clip should
// continue…").
//
// Fixtures (public-catalog.ts): the catalog is the public price list
// (cloud-facts.json), whose one Extend model is Wan 2.2 Uncensored Extend; the
// balance is the Hosted plan's monthly credits. The
// gallery holds one finished cloud video the way an earlier session leaves it
// (localStorage listing, as e2e/create-save-character.spec.ts does), and the
// cloud serves its file: a short VP9 clip made with ffmpeg from the example
// frames in LU-Promo-Video. No render is run for it.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const CLIP = {
  id: 'job-video-1', type: 'video', filename: 'clip.webm', subfolder: '', prompt: 'northern lights over a mountain lake at night',
  negativePrompt: '', model: 'wan-2.2-spicy', modelType: 'wan', seed: 7, steps: 20, cfgScale: 5, sampler: '', scheduler: '',
  width: 640, height: 360, batchSize: 1, createdAt: 1_760_000_000_000,
  remoteUrl: 'https://lu-labs.ai/e2e/clip.webm', jobId: 'job-video-1', intent: 'video',
}

test('extend', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootPublic(page, 'extend', 'How Extend works', {
    gallery: [CLIP],
    files: { '/e2e/clip.webm': { file: `${ASSETS('extend')}/clip.webm`, type: 'video/webm' } },
  })
  await rec.openCreate('Extend Video')
  const pick = page.getByRole('button', { name: 'Pick one of your cloud videos' })
  const prompt = page.locator('textarea').first()
  await expect(pick).toBeVisible()
  await page.mouse.move(700, 520)

  await rec.key()
  rec.hold(0.4)
  rec.scene('Extend continues a video from your own cloud gallery.')
  await rec.click(page.getByRole('button', { name: 'Open the gallery' }), { dur: 0.9, settle: 1500, after: 0.4 })
  const tile = page.locator('aside button:has(video)').first()
  await expect(tile).toBeVisible()
  await rec.cam({ x: 840, y: 340 }, 1.4, 0.8)
  await rec.move(tile, { dur: 0.6 })
  await rec.key(500)
  rec.hold(1.0)

  rec.scene('There is no upload here: pick one of your cloud videos.')
  await rec.cam({ x: 600, y: 850 }, 1.45)
  await rec.click(pick, { dur: 0.8, settle: 700, after: 0.7 })
  const row = page.getByRole('button', { name: /northern lights over a mountain lake/ }).last()
  await rec.click(row, { dur: 0.5, settle: 700, after: 0.9 })

  rec.scene('The prompt says how the clip goes on.')
  await rec.click(prompt, { dur: 0.6, at: { fx: 0.12 }, after: 0.2 })
  await rec.move({ x: 940, y: 880 }, { dur: 0.3, real: false })
  await rec.type(prompt, 'the camera rises slowly over the lake, the lights grow brighter', { per: 2, cps: 27, band: { up: 900 } })
  rec.hold(0.7)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.7)
})
