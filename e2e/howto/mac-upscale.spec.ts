import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Enhance Image on a Mac (3.0.7). Recorded on integ/307 (9594dc1a2) with
// platform 'mac' in Local mode. Facts, all from that head:
//  - src-tauri/src/commands/mlx.rs:1421 (IMAGE_CATALOG, id "seedvr2-3b"):
//    SeedVR2 3B, 7.3 GB (the tile shows it in GiB), needs 16 GB memory, "makes
//    a picture two or four times larger and sharper in one step, without a
//    prompt".
//  - components/create/experimental/intents.ts:244 (runsOnMlx): Enhance Image
//    is a local tab on a Mac only while an upscaler is installed.
//  - Composer.tsx:505: the one setting is "Enhance factor", 2x or 4x, "Up to
//    4096 pixels on the longest side" (image_mflux.rs:1477 MAX_UPSCALE_SIDE).
//  - hooks/useCreate.ts:924: the result is a "SeedVR2 3B" tool result in the
//    gallery (api/mlx-image.ts:324 MAC_UPSCALE_TOOL).
//  - mlx.rs:176 to 199 and 2744 (02c7dc688): a run whose result would need
//    more than 70 percent of the Mac's memory is refused before it starts.
//    The filmed run fits every Mac SeedVR2 3B is for: 640x360 at 4x makes
//    2560x1440, about 10.9 GB, below the 11.2 GB a 16 GB Mac allows. The
//    refusal itself is not filmed: it shows in the red bar (role="alert"),
//    which Rec.boot hides for every film (rec.ts:76).
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second engine (mflux) set up,
//     SD Turbo installed. Not real: nothing is installed on a real Mac.
//  2. The Get on the SeedVR2 tile runs the mock's install (two polls, then
//     installed). Not real: nothing is downloaded.
//  3. mlx.imageBase64: the answer of mlx_upscale is mug-large.png, the large
//     original of the example mug (cutout/assets/mug.jpg, 1536x864), of which
//     the source mug-s.jpg (enhance/assets) is the 640x360 copy, scaled to
//     2560x1440 (4x of the source) with sips. The line under the result reads
//     the size of that picture. Not real: SeedVR2 did not make it.
//  4. The search field of Models holds "seedvr2" when the film starts (typed
//     through the real field before the first photograph).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-upscale', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const dir = `${HOWTO_OUT}/mac-upscale/assets`
  const rec = await Rec.boot(page, 'mac-upscale', 'Enhance Image on a Mac', {
    mode: 'local',
    tauri: {
      platform: 'mac',
      // Fixtures 1 and 3.
      mlx: {
        engineInstalled: true, mfluxEngineInstalled: true, installedImages: ['sd-turbo'],
        imageBase64: readFileSync(`${dir}/mug-large.png`).toString('base64'),
      },
    },
  })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await page.locator('aside:has(+ [data-testid="models-pane"])').getByRole('button', { name: /^Image/ }).click()
  // Fixture 4.
  await page.getByPlaceholder('Search models…').fill('seedvr2')
  const tile = page.locator('[data-mac-media-tile="seedvr2-3b"]')
  await expect(tile).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(900, 700)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Enhance Image runs SeedVR2 3B: get it under Models, Image.')
  await rec.cam(tile, 1.5)
  await rec.move(tile.getByText('needs 16 GB memory'), { dur: 0.8, at: { dy: 22 } })
  rec.hold(1.0)
  await rec.click(tile.getByRole('button', { name: 'Get' }), {
    dur: 0.6, settle: 500, after: 0.3,
    until: () => expect(tile).toHaveAttribute('data-state', 'installed', { timeout: 20_000 }),
  })
  rec.hold(0.8)

  rec.scene('Then the Enhance tab in Create runs on the Mac.')
  await rec.cam('full', 1, 0.8)
  const enhance = page.getByRole('radio', { name: 'Enhance Image', exact: true })
  await rec.click(page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }), {
    dur: 0.7, settle: 900, after: 0.2,
    until: () => expect(enhance).toBeVisible({ timeout: 15_000 }),
  })
  const notice = page.getByText('Do not show again')
  if (await notice.isVisible().catch(() => false)) await notice.click()
  await rec.click(enhance, { dur: 0.6, settle: 700, after: 0.2 })
  await expect(enhance).toBeChecked()
  // The drop area opens the file chooser, which Playwright answers with the example mug.
  const chooser = page.waitForEvent('filechooser')
  await rec.click(page.getByText('Drop an image to enhance'), { dur: 0.6, settle: 100, after: 0.1 })
  await (await chooser).setFiles({ name: 'mug.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${dir}/mug-s.jpg`) })
  await expect(page.getByText('Hit Create to upscale the image.')).toBeVisible({ timeout: 15_000 })
  await rec.key(700)
  rec.hold(0.4)

  rec.scene('No prompt, one setting: 2x or 4x, up to 4096 pixels on the longest side.')
  const factor = page.getByRole('radiogroup', { name: 'Enhance factor' })
  await rec.cam(factor, 1.5, 0.8)
  await rec.click(factor.getByRole('radio', { name: '4x' }), { dur: 0.7, settle: 500, after: 0.3 })
  await expect(factor.getByRole('radio', { name: '4x' })).toBeChecked()
  rec.hold(0.8)

  rec.scene('Create makes it four times larger, and the line under it names SeedVR2 3B.')
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), {
    dur: 0.8, settle: 900, after: 0.3,
    until: () => expect(page.getByText(/2560.1440/).first()).toBeVisible({ timeout: 20_000 }),
  })
  const line = page.getByText(/2560.1440/).first()
  await rec.cam(line, 1.5, 0.9)
  await rec.move(line, { dur: 0.7, at: { dy: 24 } })
  rec.hold(1.6)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.0)
})
