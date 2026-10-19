import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { HOWTO_OUT } from './rec'
import { bootNoPrice } from './no-price'

// How Edit works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Edit 1, 2),
// MaskEditor.tsx ("Red = will be regenerated"), Stage.tsx ("This model needs
// no mask"), cloud-models.ts (qwen-image-edit, maskless).
//
// Network fixtures (no-price.ts): the app's own bundled model list, so the
// Edit picker holds the masked Flux Dev and the maskless "Qwen Image Edit (no
// mask needed)". Flux Dev carries its public price (1,200 per image,
// lu-labs.ai/pricing), Qwen Image Edit none; the balance is the Hosted plan's
// 900000.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('edit', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootNoPrice(page, 'edit', 'How Edit works')
  await rec.openCreate('Edit / Image to Image')
  // The source image is in place from the start: picking a file is not the subject.
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'island.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${HOWTO_OUT}/edit/assets/island.jpg`),
  })
  const paint = page.getByRole('button', { name: 'Paint mask' })
  await expect(paint).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(600, 880)

  await rec.key()
  rec.hold(0.4)
  rec.scene('Paint a mask: only the painted area is changed.')
  await rec.click(paint, { dur: 0.8, settle: 1000, after: 0.3 })
  const canvas = page.getByRole('dialog').locator('canvas').first()
  const b = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) => ({ x: Math.round(b.x + b.width * fx), y: Math.round(b.y + b.height * fy) })
  await rec.cam(at(0.62, 0.4), 1.35)
  const pts = [] as { x: number; y: number }[]
  for (let i = 0; i <= 26; i++) {
    const k = i / 26
    pts.push(at(0.585 + 0.115 * k, 0.335 + 0.045 * Math.sin(k * Math.PI * 5)))
  }
  const size = page.viewportSize()!
  await rec.drag(pts, { x: 0, y: Math.round(b.y - 10), w: size.width, h: Math.round(b.height + 20) }, { stepDur: 0.07 })
  rec.hold(0.5)

  rec.scene('Apply the mask, then say what should be there instead.')
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('button', { name: 'Apply mask' }), { dur: 0.8, settle: 900, after: 0.5 })
  await expect(page.getByText('mask painted')).toBeVisible()
  const prompt = page.locator('textarea').first()
  await rec.cam(prompt, 1.4)
  await rec.click(prompt, { dur: 0.6, at: { fx: 0.15 } })
  await rec.move({ x: 935, y: 870 }, { dur: 0.3, real: false })
  await rec.type(prompt, 'a small stone lighthouse', { cps: 22 })
  rec.hold(0.5)

  rec.scene('Some models need no mask. Pick one and the prompt alone is the edit.')
  const picker = page.locator('button[aria-haspopup="listbox"]').last()
  await rec.click(picker, { dur: 0.6, settle: 700, after: 0.5 })
  await rec.click(page.getByRole('option', { name: /Qwen Image Edit/ }), { dur: 0.5, settle: 900, after: 0.3 })
  const hint = page.getByText('This model needs no mask.', { exact: false })
  await expect(hint).toBeVisible()
  await rec.cam(hint, 1.5, 0.9)
  await rec.move(hint, { dur: 0.8, at: { dy: 26 } })
  rec.hold(1.6)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.4)
})
