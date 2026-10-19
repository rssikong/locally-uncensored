import { test, expect } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { bootPublic, ASSETS } from './public-catalog'

// How Animate works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Animate 1, 2);
// Stage.tsx InputSlot ("Drop an image to animate", "or pick from your gallery"),
// SourcePreview ("Describe the motion below, then Create."), intents.ts
// (placeholder "Describe how the image should move…", example "slow zoom in,
// subtle parallax").
//
// Fixtures (public-catalog.ts): the catalog is the public price list
// (cloud-facts.json), the balance the Hosted plan's monthly credits; the
// gallery holds two finished cloud pictures the way an earlier session leaves
// them (localStorage listing), and the cloud serves their files (example
// pictures copied from LU-Promo-Video).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const item = (id: string, file: string, prompt: string, at: number) => ({
  id, type: 'image', filename: file, subfolder: '', prompt, negativePrompt: '', model: 'z-image', modelType: 'unknown',
  seed: 7, steps: 8, cfgScale: 1, sampler: '', scheduler: '', width: 1536, height: 864, batchSize: 1, createdAt: at,
  remoteUrl: `https://lu-labs.ai/e2e/${file}`, jobId: id, intent: 'image',
})

test('animate', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const a = ASSETS('animate')
  const rec = await bootPublic(page, 'animate', 'How Animate works', {
    gallery: [
      item('job-img-fox', 'fox.jpg', 'a fox in a pine forest, paper cut style', 1_760_000_100_000),
      item('job-img-lighthouse', 'lighthouse.jpg', 'a lighthouse at dusk', 1_760_000_000_000),
    ],
    files: {
      '/e2e/fox.jpg': { file: `${a}/fox.jpg`, type: 'image/jpeg' },
      '/e2e/lighthouse.jpg': { file: `${a}/lighthouse.jpg`, type: 'image/jpeg' },
    },
  })
  await rec.openCreate('Animate Image')
  const thumbs = page.getByRole('button', { name: 'Use this gallery image as the source' })
  await expect(thumbs).toHaveCount(2)
  await expect.poll(() => thumbs.first().locator('img').evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0)
  const prompt = page.locator('textarea').first()
  await page.mouse.move(820, 300)

  await rec.key()
  rec.hold(0.4)
  rec.scene('Start from a file, or from a picture in your gallery.')
  await rec.cam(page.getByText('or pick from your gallery'), 1.5)
  await rec.move(page.getByText('Drop an image to animate'), { dur: 0.7 })
  rec.hold(0.6)
  await rec.move(thumbs.first(), { dur: 0.6 })
  rec.hold(0.4)
  await rec.cam('full', 1, 0.9)
  await rec.click(thumbs.first(), { dur: 0.2, settle: 1200, after: 0.5 })
  await expect(page.getByAltText('source')).toBeVisible()

  rec.scene('The picture decides who and what is in the clip.')
  await rec.move(page.getByAltText('source'), { dur: 0.7, at: { fx: 0.7, fy: 0.75 } })
  rec.hold(1.6)

  rec.scene('The prompt only describes the movement.')
  await rec.cam(prompt, 1.45)
  await rec.click(prompt, { dur: 0.7, at: { fx: 0.12 }, after: 0.2 })
  await rec.move({ x: 940, y: 868 }, { dur: 0.35, real: false })
  await rec.type(prompt, 'slow zoom in, the fox turns its head, leaves drift in the wind', { per: 2, cps: 26, band: { up: 900 } })
  rec.hold(0.8)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.7)
})
