import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { HOWTO_OUT } from './rec'
import { bootPublic } from './public-catalog'

// How Image works: the things in the Image tab nobody finds alone.
// Facts: LU-HowTo/04-inhalte/04-INHALTE.md (Image 2, 4, 5), ImproveToggle.tsx,
// ParamGroups.tsx ("Seed (−1 = random)"), PromptDetails.tsx, OutputView.tsx.
//
// Network fixtures (the rig cannot produce these by itself):
//  - **/e2e/result.png answers with an example picture instead of the 1px PNG.
//  - **/api/inference/v1/chat/completions answers the one chat call that
//    "Improve my prompt" makes, with an example rewrite.
//  - public-catalog.ts: the catalog is the public price list (cloud-facts.json),
//    the balance the Hosted plan's monthly credits.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const PROMPT = 'a lighthouse at dusk'
const REWRITE = 'A white lighthouse on a rocky cliff at dusk, storm clouds rolling in, warm light in the lantern room, low wide-angle shot, cinematic photograph'
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS' }

test('image', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await bootPublic(page, 'image', 'How Image works')
  await page.route('**/e2e/result.png', (route) =>
    route.fulfill({ status: 200, headers: CORS, contentType: 'image/jpeg', body: readFileSync(`${HOWTO_OUT}/image/assets/lighthouse.jpg`) }))
  await page.route('**/api/inference/v1/chat/completions', (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
    return route.fulfill({ status: 200, headers: CORS, contentType: 'text/event-stream',
      body: `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: REWRITE } }] })}\n\ndata: [DONE]\n\n` })
  })
  await rec.openCreate('Image')
  // The prompt itself is not the subject of this film: it is there from the start.
  await page.locator('textarea').first().fill(PROMPT)
  await page.getByText('16:9', { exact: true }).first().click()
  await page.mouse.move(600, 500)

  await rec.key()
  rec.hold(0.4)
  rec.scene('Advanced settings has "Improve my prompt": your chat model rewrites the prompt before the run.')
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.8, settle: 900 })
  const improve = page.getByRole('switch', { name: /Improve my prompt/ })
  await rec.cam(improve, 1.5)
  await rec.click(improve, { dur: 0.6, after: 1.3 })
  await expect(improve).toHaveAttribute('aria-checked', 'true')

  rec.scene('Seed −1 is random. Set a number to repeat a picture.')
  const seed = page.locator('aside').getByText('Seed (−1 = random)').locator('..').locator('input')
  await seed.scrollIntoViewIfNeeded()
  await rec.key(300)
  await rec.cam(seed, 1.5)
  await rec.click(seed, { dur: 0.6, at: { fx: 0.3 } })
  await page.keyboard.press('ControlOrMeta+A')
  await rec.type(seed, '42', { cps: 6 })
  rec.hold(0.9)

  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)
  await rec.cam('full', 1, 0.8)
  await rec.key(300)
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), { dur: 0.7, settle: 300, after: 0.5 })
  const picture = page.locator('img[src*="/e2e/result.png"]').first()
  await expect(picture).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('result-facts')).toBeVisible()
  await rec.key(1200)

  // The folded "Prompt" box under the picture is cut off by the stage at this
  // window size, so the film opens the large view, where it stands unfolded.
  rec.scene('Click the picture: the large view shows what you wrote and what was sent to the model.')
  await rec.click(picture, { dur: 0.7, settle: 900, after: 0.3 })
  const sent = page.locator('.fixed.inset-0').getByTestId('prompt-details').last()
  await expect(sent.getByText('Sent to the model')).toBeVisible()
  await rec.cam(sent, 1.35, 0.8)
  rec.hold(2.2)
  await rec.cam('full', 1, 0.6)
  rec.hold(0.6)
  await page.keyboard.press('Escape')
  await expect(sent).toHaveCount(0)
  await rec.key(500)

  // The two buttons carry their names as native tooltips, which a screenshot
  // cannot show. The click shows what the first one does.
  rec.scene('Hover the picture: the wand is "Edit with mask", the film strip is "Animate this image".')
  await rec.move(picture, { dur: 0.5 })
  await rec.key(500)
  await rec.cam(page.getByTitle('Animate this image'), 1.5, 0.7)
  await rec.move(page.getByTitle('Animate this image'), { dur: 0.6 })
  await rec.key(700)
  rec.hold(0.7)
  await rec.cam('full', 1, 0.9)
  await rec.click(page.getByTitle('Edit with mask'), { dur: 0.45, settle: 1200, after: 0.2 })
  await expect(page.getByRole('button', { name: 'Paint mask' })).toBeVisible()
  rec.finish(1.5)
})
