import { test, expect } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { hideRigAlert, ASSETS } from './create-fx'
import { bootNoPrice } from './no-price'

// How Motion works. Facts: SpecialIntentControls.tsx MotionControls ("Add
// character image", "Add driving video (dance/pose)"), laneHint.ts ("No
// prompt needed. Add a character image and a driving dance/pose video above,
// then hit Create.", a note above the prompt window),
// Composer.tsx (Motion draws no prompt field: intents.ts needsPrompt false).
//
// Fixtures (no-price.ts): the catalog is the app's bundled model list,
// without a price (none is public for Motion). The
// two files are examples: a picture copied from LU-Promo-Video and a short
// VP9 clip made with ffmpeg from its example frames (a landscape, not a
// dancer: there is no pose footage to use).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('motion', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const a = ASSETS('motion')
  const rec = await bootNoPrice(page, 'motion', 'How Motion works')
  await hideRigAlert(page)
  await rec.openCreate('Motion Control')
  const image = page.getByRole('button', { name: 'Add character image' })
  const video = page.getByRole('button', { name: 'Add driving video (dance/pose)' })
  const create = page.getByRole('button', { name: /^Create$/ }).last()
  await expect(image).toBeVisible()
  await expect(page.locator('textarea')).toHaveCount(0)
  await page.mouse.move(820, 560)

  await rec.key()
  rec.hold(0.6)
  rec.scene('Motion takes two files. First the character image.')
  await rec.cam({ x: 600, y: 850 }, 1.45)
  let chooser = page.waitForEvent('filechooser')
  await rec.click(image, { dur: 0.9, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${a}/fox.jpg`)
  await expect(page.getByRole('button', { name: 'Image ready' })).toBeVisible()
  await rec.key(600)
  rec.hold(1.6)

  rec.scene('Then the driving video: the movement the character copies.')
  chooser = page.waitForEvent('filechooser')
  await rec.click(video, { dur: 0.7, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${a}/drive.webm`)
  await expect(page.getByRole('button', { name: 'drive.webm' })).toBeVisible()
  await expect(create).toBeEnabled()
  await rec.key(700)
  rec.hold(1.8)

  rec.scene('There is no prompt on this tab. The two files are enough to hit Create.')
  await rec.move(create, { dur: 0.9 })
  await rec.key(400)
  rec.hold(1.8)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.8)
})
