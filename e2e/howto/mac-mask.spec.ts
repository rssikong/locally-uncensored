import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Edit with a mask on a Mac (3.0.7). Recorded on integ/307 (9594dc1a2) with
// platform 'mac' in Local mode. Facts, all from that head:
//  - components/create/experimental/intents.ts:244 (runsOnMlx): Edit is a local
//    tab on a Mac while a model that edits is installed (Qwen-Image 2.1).
//  - Stage.tsx:489: the Mac's sentence "Paint an area to change just that, or
//    leave the mask empty to edit the whole image." (Windows says "restyle").
//  - Composer.tsx:51 MAC_EDIT_PLACEHOLDER: "Describe what to change in this
//    image. Paint a mask to change only that area…"
//  - MaskEditor.tsx:265 "Apply mask"; MaskEditor.tsx:237 to 240: on the Mac
//    the mask is written to disk at submit time with its edge softened by
//    the feather slider.
//  - ParamGroups.tsx:410 to 417 (macEdit): Expert has "Edit strength" (1.00
//    is the edit from the prompt alone, lower starts from the image and keeps
//    more of it) and "Mask edge feather" (0 to 64 px).
//  - src-tauri/src/commands/image_mflux.rs:734 to 738 and 918 to 925: the
//    mask is white where the prompt paints and black where the image stays;
//    it goes to the engine as --mask-image, the strength as --strength, a
//    mask only with an image.
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second engine (mflux) set up,
//     Qwen-Image 2.1 4-bit installed. Not real: nothing is installed.
//  2. The source image is in place when the film starts: island.jpg, the
//     example island of the Edit film (edit/assets), through the stage's own
//     file input. No run is made, so no result picture is shown.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-mask', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'mac-mask', 'Edit with a mask on a Mac', {
    mode: 'local',
    // Fixture 1.
    tauri: { platform: 'mac', mlx: { engineInstalled: true, mfluxEngineInstalled: true, installedImages: ['qwen-image-2.1-4bit'] } },
  })
  await rec.openCreate('Edit / Image to Image')
  // Fixture 2.
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'island.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${HOWTO_OUT}/mac-mask/assets/island.jpg`),
  })
  const hint = page.getByText(/leave the mask empty to edit the whole image/)
  await expect(hint).toBeVisible({ timeout: 15_000 })
  const paint = page.getByRole('button', { name: 'Paint mask' })
  await expect(paint).toBeVisible()
  await page.mouse.move(600, 880)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Qwen-Image 2.1 edits under a mask, or the whole image without one.')
  await rec.cam(hint, 1.45)
  await rec.move(hint, { dur: 0.8, at: { dy: 26 } })
  rec.hold(1.8)

  rec.scene('Paint the area and apply the mask: only that part is repainted.')
  await rec.cam('full', 1, 0.7)
  await rec.click(paint, { dur: 0.7, settle: 1000, after: 0.2 })
  const canvas = page.getByRole('dialog').locator('canvas').first()
  const b = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) => ({ x: Math.round(b.x + b.width * fx), y: Math.round(b.y + b.height * fy) })
  await rec.cam(at(0.62, 0.4), 1.35)
  const pts = [] as { x: number; y: number }[]
  for (let i = 0; i <= 24; i++) {
    const k = i / 24
    pts.push(at(0.585 + 0.115 * k, 0.335 + 0.045 * Math.sin(k * Math.PI * 5)))
  }
  const size = page.viewportSize()!
  await rec.drag(pts, { x: 0, y: Math.round(b.y - 10), w: size.width, h: Math.round(b.height + 20) }, { stepDur: 0.06 })
  await rec.cam('full', 1, 0.7)
  await rec.click(page.getByRole('button', { name: 'Apply mask' }), { dur: 0.7, settle: 900, after: 0.3 })
  await expect(page.getByText('mask painted')).toBeVisible()
  rec.hold(0.6)

  rec.scene('In Expert, Edit strength 1.00 edits from the prompt alone; lower keeps more of the image.')
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.7, settle: 900, after: 0.2 })
  const strength = page.getByText('Edit strength', { exact: true })
  if (!(await strength.isVisible().catch(() => false))) {
    await rec.click(page.getByRole('button', { name: 'Expert', exact: true }), { dur: 0.5, settle: 700, after: 0.2 })
  }
  await expect(strength).toBeVisible()
  await strength.scrollIntoViewIfNeeded()
  await rec.key(400)
  await rec.cam(strength, 1.5, 0.8)
  await rec.move(strength, { dur: 0.7, at: { dy: 26 }, real: false })
  rec.hold(1.8)

  rec.scene('Mask edge feather softens the edge of the mask, up to 64 px.')
  const feather = page.getByText('Mask edge feather', { exact: true })
  await rec.cam(feather, 1.5, 0.7)
  await rec.move(feather, { dur: 0.6, at: { dy: 26 }, real: false })
  rec.hold(1.8)
  await rec.cam('full', 1, 0.9)
  rec.finish(1.0)
})
