import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { HOWTO_OUT } from './rec'
import { bootNoPrice } from './no-price'

// How Enhance works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Enhance: 2K, 4K,
// 8K, no prompt; the tab is for images, a video is enhanced from the large
// view of a cloud video), Composer.tsx (the 2K/4K/8K control), Lightbox.tsx
// (the "Enhance" button on a cloud video).
//
// Network fixtures: no-price.ts (no price: none is public for Enhance), and
// the rig only ever answers an image job with a 1px PNG.
//  - **/api/jobs/job-e2e-1 answers as a finished cloud VIDEO job, so the
//    gallery holds a cloud clip (made before the film starts).
//  - **/e2e/clip.webm is that clip: an example clip, VP9 (the headless browser
//    plays no H.264).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

test('enhance', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootNoPrice(page, 'enhance', 'How Enhance works', { own: async (page) => {
    await page.route('https://lu-labs.ai/api/jobs/job-e2e-1', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      const now = new Date().toISOString()
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ job: {
        id: 'job-e2e-1', kind: 'video', model: 'wan-2.2-720p', provider: 'upstream', status: 'succeeded',
        result_url: 'https://lu-labs.ai/e2e/clip.webm', attestation: null, cost_units: 40000,
        created_at: now, completed_at: now, error: null,
      } }) })
    })
    await page.route('**/e2e/clip.webm', (route) =>
      route.fulfill({ status: 200, headers: { ...CORS, 'accept-ranges': 'bytes' }, contentType: 'video/webm', body: readFileSync(`${HOWTO_OUT}/enhance/assets/clip.webm`) }))
  } })
  // Before the film: one cloud clip in the gallery.
  await rec.openCreate('Video')
  await page.locator('textarea').first().fill('northern lights over a snowy lake, a cabin on the shore, slow pan')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.locator('video[src*="/e2e/clip.webm"]').first()).toBeVisible({ timeout: 30_000 })
  await page.getByRole('radio', { name: 'Enhance Image', exact: true }).click()
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'mug.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${HOWTO_OUT}/enhance/assets/mug-s.jpg`),
  })
  await expect(page.getByText('Hit Create to upscale the image.')).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(600, 880)
  if (process.env.LU_HOWTO_PROBE) { await page.screenshot({ path: `${process.env.LU_HOWTO_PROBE}/enh0.png` }) }

  await rec.key()
  rec.hold(0.3)
  rec.scene('Enhance needs no prompt. Pick the target: 2K, 4K or 8K.')
  const k4 = page.getByRole('radio', { name: '4K', exact: true })
  const k8 = page.getByRole('radio', { name: '8K', exact: true })
  await rec.cam(k4, 1.5)
  await rec.click(k4, { dur: 0.9, after: 0.9 })
  await rec.click(k8, { dur: 0.5, after: 1.3 })

  rec.scene('This tab takes images. For a video, open the clip from your gallery.')
  await rec.cam('full', 1, 0.9)
  await rec.click(page.getByRole('button', { name: 'Open the gallery' }), { dur: 0.8, settle: 900, after: 0.5 })
  const tile = page.locator('aside').filter({ hasText: 'Gallery' }).locator('.group').first()
  await rec.move(tile, { dur: 0.6 })
  rec.hold(0.5)

  rec.scene('Its large view has an "Enhance" button that upscales the clip.')
  await rec.click(tile, { dur: 0.2, settle: 1500, after: 0.5 })
  const enhance = page.getByRole('button', { name: 'Enhance', exact: true })
  await expect(enhance).toBeVisible()
  await rec.cam(enhance, 1.5, 0.9)
  await rec.move(enhance, { dur: 0.8 })
  await rec.key(500)
  rec.hold(1.8)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.4)
})
