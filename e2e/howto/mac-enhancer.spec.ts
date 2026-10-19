import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// The Qwen prompt enhancer on a Mac (3.0.7). Recorded on integ/307
// (0a62b652d) with platform 'mac' in Local mode. Facts, all from that head:
//  - src-tauri/src/commands/mlx_enhancer.rs:79 to 102 (ENHANCERS): two packs,
//    "Qwen-Image 2.1 Prompt Enhancer 4-bit" for new pictures (t2i) and
//    "Qwen-Image 2.1 Edit Prompt Enhancer 4-bit" for edits (i2i), 5_970_346_649
//    and 5_970_346_537 bytes (the tile shows 5.6 GB in GiB; the changelog says
//    about 6 GB), 16 GB memory each. The edit one "looks at the images and
//    rewrites your instruction before the edit starts". They are listed under
//    Models, Image (family "enhancer", lib/image-engines.ts:12 to 27).
//  - components/create/experimental/ImproveToggle.tsx:24 to 112 and
//    lib/render/qwen-enhancer.ts:117 to 143 (improveWriters): with Qwen-Image
//    2.1 picked and an enhancer installed, Improve my prompt in the advanced
//    settings shows "Rewritten by" with "Qwen enhancer" marked and, for a new
//    picture, "Chat model" next to it. In Edit there is no chat model entry.
//  - hooks/useCreate.ts:1033 to 1048: on a Mac the enhancer rewrites after the
//    chat model has left memory and before the image model loads; in Edit it
//    gets the same images the edit reads (mode i2i). takeRewrite
//    (useCreate.ts:788 to 795) stores what was written and who rewrote it.
//  - PromptDetails.tsx: Prompt and settings shows You wrote, Sent to the model
//    and Rewritten by.
//  - mlx_enhancer.rs:20 to 22: "No model was loaded for it yet"; the film
//    shows the controls, not a real rewrite.
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second engine (mflux) set up,
//     Qwen-Image 2.1 4-bit installed, no enhancer. Not real: nothing is
//     installed on a real Mac.
//  2. The Get on the enhancer tile runs the mock's install (two polls, then
//     installed). Not real: nothing is downloaded.
//  3. mlx.enhancerAnswer: the rewrite is an example text written for this
//     film, in the shape the enhancer answers (reasoning closed by </think>,
//     then the prompt). Not real: no enhancer wrote it.
//  4. mlx.imageBase64: the picture is lighthouse-sq.png, a 1024x1024 crop of
//     the example lighthouse of the image film (image/assets/lighthouse.jpg,
//     through mac-hires/assets/lighthouse.png), so it matches the 1:1 canvas.
//     Not real: Qwen-Image 2.1 did not make it.
//  5. The search field of Models holds "enhancer" when the film starts (typed
//     through the real field before the first photograph).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const REWRITE = 'A tall red lighthouse on a rocky islet at dusk, storm clouds glowing orange and violet overhead, green waves breaking white against brown rocks, painted in thick, textured brushstrokes.'

test('mac-enhancer', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const dir = `${HOWTO_OUT}/mac-enhancer/assets`
  const rec = await Rec.boot(page, 'mac-enhancer', 'Prompt enhancer on a Mac', {
    mode: 'local',
    tauri: {
      platform: 'mac',
      // Fixtures 1, 3 and 4.
      mlx: {
        engineInstalled: true, mfluxEngineInstalled: true, installedImages: ['qwen-image-2.1-4bit'],
        enhancerAnswer: `The user wants a lighthouse at dusk.\n</think>\n\n${REWRITE}`,
        imageBase64: readFileSync(`${dir}/lighthouse-sq.png`).toString('base64'),
      },
    },
  })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await page.locator('aside:has(+ [data-testid="models-pane"])').getByRole('button', { name: /^Image/ }).click()
  // Fixture 5.
  await page.getByPlaceholder('Search models…').fill('enhancer')
  const t2i = page.locator('[data-mac-media-tile="qwen-image-2.1-pe-t2i-4bit"]')
  const i2i = page.locator('[data-mac-media-tile="qwen-image-2.1-pe-i2i-4bit"]')
  await expect(t2i).toBeVisible({ timeout: 15_000 })
  await expect(i2i).toBeVisible()
  await page.mouse.move(700, 760)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('Two Qwen enhancers for Qwen-Image 2.1: one for new pictures, one for edits that also looks at the picture.')
  const pair = t2i.locator('xpath=../..')
  await rec.cam(pair, 1.3)
  await rec.move(i2i.getByRole('heading'), { dur: 0.7, at: { dy: 24 } })
  rec.hold(1.4)
  await rec.click(t2i.getByRole('button', { name: 'Get', exact: true }), {
    dur: 0.7, settle: 500, after: 0.2,
    until: () => expect(t2i).toHaveAttribute('data-state', 'installed', { timeout: 20_000 }),
  })
  rec.hold(0.5)

  rec.scene('With one installed, Improve my prompt can hand your prompt to the Qwen enhancer.')
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }), {
    dur: 0.6, settle: 900, after: 0.1,
    until: () => expect(page.getByRole('radio', { name: 'Image', exact: true })).toBeVisible({ timeout: 15_000 }),
  })
  const notice = page.getByText('Do not show again')
  if (await notice.isVisible().catch(() => false)) await notice.click()
  await expect(page.getByText('MLX Qwen-Image 2.1 4-bit').first()).toBeVisible()
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.6, settle: 800, after: 0 })
  const improve = page.getByRole('switch', { name: /Improve my prompt/ })
  await rec.cam(improve, 1.5, 0.6)
  await rec.click(improve, { dur: 0.5, settle: 500, after: 0.1 })
  await expect(improve).toHaveAttribute('aria-checked', 'true')
  const writers = page.getByRole('radiogroup', { name: 'Rewritten by' })
  await expect(writers.getByRole('radio', { name: 'Qwen enhancer' })).toHaveAttribute('aria-checked', 'true')
  await rec.move(writers.getByRole('radio', { name: 'Qwen enhancer' }), { dur: 0.5, at: { dy: 20 } })
  rec.hold(1.1)
  await rec.cam('full', 1, 0.5)
  await rec.click(page.getByRole('button', { name: 'Close' }).last(), { dur: 0.4, settle: 600, after: 0 })

  rec.scene('It rewrites on this Mac before the picture starts. Prompt and settings shows both texts.')
  const prompt = page.locator('textarea').first()
  await rec.click(prompt, { dur: 0.5, at: { fx: 0.15 }, settle: 200, after: 0 })
  await rec.type(prompt, 'a lighthouse at dusk', { per: 2, cps: 36 })
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), {
    dur: 0.6, settle: 900, after: 0.1,
    until: () => expect(page.getByText('Prompt and settings', { exact: true }).first()).toBeVisible({ timeout: 30_000 }),
  })
  const details = page.getByText('Prompt and settings', { exact: true }).first()
  await rec.click(details, { dur: 0.5, settle: 700, after: 0 })
  const sent = page.getByText(REWRITE, { exact: true }).first()
  await expect(sent).toBeVisible()
  await expect(page.getByText('Qwen enhancer', { exact: true }).last()).toBeVisible()
  await rec.cam(sent, 1.45, 0.8)
  await rec.move(sent, { dur: 0.6, at: { dy: 24 }, real: false })
  rec.hold(1.6)
  await rec.cam('full', 1, 0.8)
  rec.finish(0.6)
})
