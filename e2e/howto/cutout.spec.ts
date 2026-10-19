import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { HOWTO_OUT } from './rec'
import { bootNoPrice } from './no-price'

// How Cutout works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Cutout: no
// prompt, a PNG with a transparent background, several images at once),
// Stage.tsx, BatchStrip.tsx ("Add more images", the count line, the queue),
// lib/batch-edit (50 images at most).
//
// Network fixtures: no-price.ts (no price: none is public for Cutout), and
// the rig has no upload route and answers a job at once.
//  - **/api/jobs/upload** takes each source image.
//  - **/api/jobs/job-e2e-1 is held back, so the queue of a running list can be
//    photographed. No result picture is shown: the rig has no real cutout.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

test('cutout', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const asset = (name: string) => ({ name, mimeType: 'image/jpeg', buffer: readFileSync(`${HOWTO_OUT}/cutout/assets/${name}`) })
  let uploads = 0
  const rec = await bootNoPrice(page, 'cutout', 'How Cutout works', { own: async (page) => {
    await page.route('https://lu-labs.ai/api/jobs/upload**', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify({ path: `e2e-user-1/source-${++uploads}.png` }) })
    })
    await page.route('https://lu-labs.ai/api/jobs/job-e2e-1', (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
      // Never answered: the first image stays "running" for the photograph.
    })
  } })
  await rec.openCreate('Remove Background')
  // One image is in place from the start: picking a file is not the subject.
  await page.getByTestId('batch-files-input').first().setInputFiles(asset('mug.jpg'))
  const hint = page.getByText('Hit Create to cut out the subject and export a transparent PNG.')
  await expect(hint).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(600, 880)

  await rec.key()
  rec.hold(0.3)
  rec.scene('Cutout needs no prompt. The result is a PNG with a transparent background.')
  await rec.cam(hint, 1.45)
  await rec.move(hint, { dur: 0.9, at: { dy: 24 } })
  rec.hold(2.0)

  rec.scene('"Add more images" turns one cutout into a list.')
  const add = page.getByRole('button', { name: 'Add more images' })
  const chooser = page.waitForEvent('filechooser')
  // The click opens the file chooser, which Playwright answers with three example images.
  await rec.click(add, { dur: 0.6, settle: 100, after: 0.1 })
  await (await chooser).setFiles([asset('fox.jpg'), asset('whale.jpg'), asset('cabin.jpg')])
  const count = page.getByTestId('batch-count')
  await expect(count).toContainText('4 images.')
  await rec.key(700)
  await rec.cam(count, 1.45, 0.8)
  rec.hold(2.4)

  rec.scene('One Create runs them all, one after the other.')
  await rec.cam('full', 1, 0.9)
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), { dur: 0.9, settle: 1500, after: 0.4 })
  const queue = page.getByTestId('batch-queue')
  await expect(queue).toBeVisible()
  await rec.cam(queue, 1.45, 0.9)
  rec.hold(2.2)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.4)
})
