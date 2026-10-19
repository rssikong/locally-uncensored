import { test, expect } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { hideRigAlert, ASSETS } from './create-fx'
import { bootNoPrice } from './no-price'

// How Lipsync works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Lipsync 1, 2, 3);
// SpecialIntentControls.tsx LipsyncControls ("Add portrait" / "Add video to
// resync" by the model's lipsync_source) and VoiceChip ("Upload an audio file",
// "Generate a voice (AI)", "Voice" / "Describe", "warm narrator, slight rasp…");
// Composer.tsx LaneControls (no Length control on this tab: the clip follows
// the voice).
//
// Fixtures (no-price.ts): the catalog is the app's bundled model list (the
// rig's own has no talking model), without a price (none is public here). The audio file is a four second tone made
// with ffmpeg.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('lipsync', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootNoPrice(page, 'lipsync', 'How Lipsync works')
  await hideRigAlert(page)
  await rec.openCreate('Talking Character')
  const chip = page.locator('button[aria-haspopup="listbox"]').last()
  const portrait = page.getByRole('button', { name: 'Add portrait' })
  const resync = page.getByRole('button', { name: 'Add video to resync' })
  const voice = page.getByRole('button', { name: 'Add voice' })
  await expect(portrait).toBeVisible()
  await page.mouse.move(820, 560)

  await rec.key()
  rec.hold(0.4)
  rec.scene('The model decides what you add: a portrait, or a clip to resync.')
  await rec.cam({ x: 600, y: 850 }, 1.45)
  await rec.move(portrait, { dur: 0.7 })
  rec.hold(0.4)
  await rec.click(chip, { dur: 0.5, settle: 700, after: 0.4 })
  await rec.click(page.getByRole('option', { name: /LatentSync/ }), { dur: 0.5, settle: 700, after: 0.2 })
  await expect(resync).toBeVisible()
  await rec.move(resync, { dur: 0.5 })
  rec.hold(0.7)

  rec.scene('The voice is an audio file, or one the AI makes.')
  await rec.click(voice, { dur: 0.5, settle: 600, after: 0.3 })
  const upload = page.getByRole('button', { name: 'Upload an audio file' })
  const generate = page.getByRole('button', { name: 'Generate a voice (AI)' })
  await rec.move(generate, { dur: 0.4 })
  await rec.key(300)
  rec.hold(0.5)
  const chooser = page.waitForEvent('filechooser')
  await rec.click(upload, { dur: 0.35, settle: 60, after: 0.1 })
  await (await chooser).setFiles(`${ASSETS('lipsync')}/voice.wav`)
  const picked = page.getByRole('button', { name: 'voice.wav' })
  await expect(picked).toBeVisible()
  await rec.key(600)
  rec.hold(0.6)

  rec.scene('A generated voice: pick a ready one, or describe it.')
  await rec.click(picked, { dur: 0.35, settle: 600, after: 0.15 })
  await rec.click(generate, { dur: 0.35, settle: 600, after: 0.2 })
  const say = page.getByPlaceholder('What should the character say?')
  await rec.click(say, { dur: 0.4, at: { fx: 0.2 }, after: 0.1 })
  await rec.type(say, 'Hello, I am Rusty.', { cps: 30 })
  await rec.move(page.locator('select'), { dur: 0.4 })
  rec.hold(0.35)
  await rec.click(page.getByRole('radio', { name: 'Describe' }), { dur: 0.35, settle: 600, after: 0.3 })
  // The description field is not typed into: in this narrow panel the row is
  // wider than the panel, and focusing the field scrolls the panel sideways
  // (seen in the rig, reported). Its placeholder is the app's own example.
  await expect(page.getByPlaceholder('warm narrator, slight rasp…')).toBeVisible()
  await rec.move(page.getByPlaceholder('warm narrator, slight rasp…'), { dur: 0.45, at: { fx: 0.5, dy: 22 }, real: false })
  rec.hold(1.3)

  rec.scene('No length setting here: the clip is as long as the voice.')
  await rec.cam('full', 1, 0.9)
  await rec.click({ x: 560, y: 420 }, { dur: 0.6, settle: 600, after: 0.2 })
  rec.finish(1.7)
})
