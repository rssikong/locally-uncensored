import { test, expect } from '@playwright/test'
import { HOWTO_OUT } from './rec'
import { bootPublic, showAlerts } from './public-catalog'

// How Video works. Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Video 1, 3, 4);
// the prompt follows the app's own rewriter brief (src/lib/render/improve-prompt.ts:
// "one flowing paragraph in the present tense ... the subject, what moves and
// how, the camera, the light and the setting"); the lengths per model are
// video-durations.json; the last line is RENDER_CANNOT_STOP (useCloudCreate.ts).
//
// Network fixtures (public-catalog.ts):
//  - /api/jobs/catalog answers with the public price list (cloud-facts.json).
//    Every public video model starts from a picture, so the Video tab gets the
//    app's own text-to-video models from its bundled list, without a price:
//    their rows name no credits and the meter shows the balance alone.
//  - the balance is the Hosted plan's monthly credits.
//  - the started job stays "running" and its cancel answers 409, the answer of
//    the server once a GPU took the job.
//  - a ComfyUI that answers, so the rig's red "ComfyUI is not running" line
//    does not stand in the bar the cancel message appears in; Rec.boot's hide
//    of that bar is taken back (showAlerts).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const PROMPT = 'A red fox trots through a misty pine forest, leaves swirl up behind it. The camera tracks low beside it in soft morning light.'

test('video', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootPublic(page, 'video', 'How Video works', { withTextToVideo: true, runningJob: true, comfyUp: true })
  await showAlerts(page)
  await rec.openCreate('Video')
  await expect(page.getByRole('alert')).toHaveCount(0)
  const prompt = page.locator('textarea').first()
  const chip = page.locator('button[aria-haspopup="listbox"]').last()
  const length = page.getByRole('radio', { name: '8s', exact: true })
  const negative = page.getByRole('button', { name: 'Negative', exact: true })
  await expect(length).toBeVisible()
  await page.mouse.move(600, 420)

  await rec.key()
  rec.hold(0.3)
  rec.scene('Write the prompt in present tense: what moves and how, the camera, the light.')
  await rec.cam(prompt, 1.45)
  await rec.click(prompt, { dur: 0.6, at: { fx: 0.12 }, after: 0.2 })
  await rec.move({ x: 940, y: 868 }, { dur: 0.35, real: false })
  await rec.type(prompt, PROMPT, { per: 3, cps: 42, band: { up: 900 } })
  rec.hold(0.3)

  rec.scene('The Length choices belong to the model. Another model, other lengths.')
  await rec.move(length, { dur: 0.55 })
  rec.hold(0.4)
  await rec.click(chip, { dur: 0.55, settle: 700, after: 0.4 })
  await rec.click(page.getByRole('option', { name: /Wan 2\.2 Fast/ }), { dur: 0.5, settle: 700, after: 0.3 })
  await expect(length).toHaveCount(0)
  await rec.move(page.getByRole('radio', { name: '5s', exact: true }), { dur: 0.5 })
  rec.hold(0.8)

  rec.scene('"Negative" is there only on models that read a negative prompt.')
  await rec.move(negative, { dur: 0.6 })
  await rec.key(300)
  rec.hold(0.4)
  await rec.click(chip, { dur: 0.5, settle: 700, after: 0.35 })
  await rec.click(page.getByRole('option', { name: /LTX-2 \(with audio\)/ }), { dur: 0.5, settle: 700, after: 0.3 })
  await expect(negative).toHaveCount(0)
  rec.hold(0.8)

  rec.scene('A render that has started cannot be stopped. It finishes and is charged.')
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), { dur: 0.5, settle: 1500, after: 0.5 })
  const cancel = page.getByRole('button', { name: 'Cancel', exact: true })
  await expect(cancel).toBeVisible()
  await rec.click(cancel, { dur: 0.4, settle: 900, after: 0.2 })
  await expect(page.getByTestId('create-error-text')).toHaveText(/already started and can't be stopped/)
  await rec.cam({ x: 400, y: 340 }, 1.5, 0.8)
  await rec.move(page.getByTestId('create-error-text'), { dur: 0.8, at: { fx: 0.3, dy: 18 }, real: false })
  rec.finish(1.6)
})
