import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { HOWTO_OUT } from './rec'
import { bootNoPrice } from './no-price'

// How Erase works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Erase: paint over
// what should go, no prompt), Composer.tsx ("Paint over what should go, then
// hit Create." / "Mask ready. Hit Create."), MaskEditor.tsx.
// Network fixtures: no-price.ts (no price: none is public for Erase). The
// film ends before a run, the rig has no erased picture.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('erase', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootNoPrice(page, 'erase', 'How Erase works')
  await rec.openCreate('Erase Object')
  // The source image is in place from the start: picking a file is not the subject.
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'desert.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${HOWTO_OUT}/erase/assets/desert.jpg`),
  })
  const paint = page.getByRole('button', { name: 'Paint mask' })
  await expect(paint).toBeVisible({ timeout: 15_000 })
  const waiting = page.getByText('Paint over what should go, then hit Create.')
  await expect(waiting).toBeVisible()
  await page.mouse.move(600, 880)

  await rec.key()
  rec.hold(0.3)
  rec.scene('Erase has no prompt field. Create waits for a mask.')
  await rec.cam(waiting, 1.4)
  await rec.move(waiting, { dur: 0.9, at: { dy: 26 } })
  rec.hold(1.9)

  rec.scene('Paint over what should go.')
  await rec.cam('full', 1, 0.8)
  await rec.click(paint, { dur: 0.9, settle: 1000, after: 0.3 })
  const canvas = page.getByRole('dialog').locator('canvas').first()
  const b = (await canvas.boundingBox())!
  const at = (fx: number, fy: number) => ({ x: Math.round(b.x + b.width * fx), y: Math.round(b.y + b.height * fy) })
  await rec.cam(at(0.42, 0.45), 1.4)
  const pts = [] as { x: number; y: number }[]
  for (let i = 0; i <= 30; i++) {
    const k = i / 30
    pts.push(at(0.385 + 0.032 * Math.sin(k * Math.PI * 5), 0.31 + 0.25 * k))
  }
  const size = page.viewportSize()!
  await rec.drag(pts, { x: 0, y: Math.round(b.y - 10), w: size.width, h: Math.round(b.height + 20) }, { stepDur: 0.07 })
  rec.hold(0.6)

  rec.scene('Apply the mask. "Mask ready": now Create removes it.')
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('button', { name: 'Apply mask' }), { dur: 0.8, settle: 900, after: 0.4 })
  const ready = page.getByText('Mask ready. Hit Create.').last()
  await expect(ready).toBeVisible()
  await rec.cam(ready, 1.4, 0.9)
  await rec.move(page.getByRole('button', { name: /^Create$/ }).last(), { dur: 0.9 })
  await rec.key(400)
  rec.hold(1.6)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.4)
})
