import { test, expect } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { hideRigAlert, ASSETS } from './create-fx'
import { bootNoPrice } from './no-price'

// How Character works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Character 1, 2, 3);
// Stage.tsx TrainSetBoard ("Drop 4 to 30 photos of your character here"),
// SpecialIntentControls.tsx CharacterPanel ("Train new" / "Use character",
// "Put “…” in your prompt to summon the character.", the Download button).
//
// Fixtures (no-price.ts): the catalog is the app's bundled model list (the
// rig's own has no training model), without a price (none is public for a
// training or a character run); /api/loras answers with one trained
// character, as the shelf of an account that has trained one. The example
// photos are crops of one example picture (a paper-cut fox), not portraits.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('character', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const a = ASSETS('character')
  const rec = await bootNoPrice(page, 'character', 'How Character works', {
    loras: [{ id: '0b9d7c1e-1111-4222-8333-444455556666', name: 'Rusty', trigger_word: 'rustyfox', base_family: 'z-image', created_at: '2026-10-09T10:00:00Z' }],
  })
  await hideRigAlert(page)
  await rec.openCreate('Character Studio')
  const board = page.getByText('Drop 4 to 30 photos of your character here')
  const trigger = page.getByPlaceholder('Trigger word, e.g. davechar')
  await expect(board).toBeVisible()
  await page.mouse.move(860, 620)

  await rec.key()
  rec.hold(0.4)
  rec.scene('"Train new" needs 4 to 30 photos of one character.')
  const chooser = page.waitForEvent('filechooser')
  await rec.click(board, { dur: 0.8, settle: 60, after: 0.1 })
  await (await chooser).setFiles([1, 2, 3, 4, 5].map((n) => `${a}/fox-${n}.jpg`))
  await expect(page.getByText(/^5\/30 photos\./)).toBeVisible()
  await rec.key(700)
  rec.hold(0.5)
  await rec.move(page.getByText(/^5\/30 photos\./), { dur: 0.7, at: { fx: 0.12, dy: 14 }, real: false })
  rec.hold(1.0)

  rec.scene('The trigger word is the name you call the character by.')
  await rec.cam({ x: 600, y: 850 }, 1.45)
  await rec.click(trigger, { dur: 0.7, at: { fx: 0.2 }, after: 0.2 })
  await rec.move(trigger, { dur: 0.3, at: { fx: 0.5, dy: 30 }, real: false })
  await rec.type(trigger, 'rustyfox', { cps: 10, band: { up: 120, down: 190 } })
  rec.hold(0.8)

  rec.scene('"Use character": pick it, then put its trigger word in the prompt.')
  await rec.click(page.getByRole('radio', { name: 'Use character' }), { dur: 0.6, settle: 900, after: 0.4 })
  const pick = page.getByTitle('Rusty, trigger word: rustyfox')
  await expect(pick).toBeVisible()
  await rec.click(pick, { dur: 0.5, settle: 600, after: 0.5 })
  await expect(page.getByText('Put “rustyfox” in your prompt to summon the character.')).toBeVisible()
  const prompt = page.locator('textarea').first()
  await rec.click(prompt, { dur: 0.5, at: { fx: 0.12 }, after: 0.2 })
  await rec.move({ x: 940, y: 880 }, { dur: 0.3, real: false })
  await rec.type(prompt, 'rustyfox sitting on a mossy rock, golden hour', { cps: 26, band: { up: 900 } })
  rec.hold(0.6)

  rec.scene('A trained character can be downloaded as a file.')
  const download = page.getByRole('button', { name: 'Download character' })
  await rec.cam(download, 1.6, 0.7)
  await rec.move(download, { dur: 0.7 })
  await rec.key(400)
  rec.hold(1.2)
  await rec.cam('full', 1, 0.9)
  rec.finish(1.5)
})
