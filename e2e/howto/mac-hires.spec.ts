import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Native HiRes on a Mac (3.0.7). Recorded on integ/307 (9594dc1a2) with
// platform 'mac' in Local mode. Facts, all from that head:
//  - components/create/experimental/ParamGroups.tsx:142 to 144, 265, 291:
//    on the Mac, Native HiRes is on the Image tab only with a model that edits
//    (Qwen-Image 2.1), in Advanced settings under Quality; its line reads "A
//    second pass over the picture at a larger size"; the latent upscale
//    method is not offered there.
//  - lib/mac-hires.ts:1 to 15 and hooks/useCreate.ts:1070 to 1095: the finished picture
//    goes back in as the image of an edit at the larger size, started at the
//    HiRes denoise; only the final picture is kept. The progress line reads
//    "HiRes pass at <w>x<h>...".
//  - stores/createStore.ts:968 to 970: Upscale 1.5x, HiRes steps 12, HiRes denoise 0.50
//    to start with.
//  - src-tauri/src/commands/mlx.rs:1310 to 1314 (IMAGE_CATALOG): Qwen-Image 2.1 4-bit, for
//    Macs from 16 GB (min_ram_gb 16).
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second engine (mflux) set up,
//     Qwen-Image 2.1 4-bit installed. Not real: nothing is installed.
//  2. mlx.imageBase64: both passes answer with lighthouse.png, the example
//     lighthouse of the image film (image/assets/lighthouse.jpg, 1536x864, as
//     PNG). Not real: no model made it.
//  3. initScript holds the second mlx_generate (the HiRes pass, the one with
//     an image) back for 2.5 s, so its progress line can be photographed; the
//     mock answers at once. Not real: the timing.
//  4. Before the first photograph the aspect 16:9 is picked and the example
//     prompt chip is clicked, both through the real controls.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-hires', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const dir = `${HOWTO_OUT}/mac-hires/assets`
  const rec = await Rec.boot(page, 'mac-hires', 'Native HiRes on a Mac', {
    mode: 'local',
    tauri: {
      platform: 'mac',
      // Fixtures 1 and 2.
      mlx: {
        engineInstalled: true, mfluxEngineInstalled: true, installedImages: ['qwen-image-2.1-4bit'],
        imageBase64: readFileSync(`${dir}/lighthouse.png`).toString('base64'),
      },
    },
    initScript: () => {
      // Fixture 3: the HiRes pass takes a moment.
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      bridge.invoke = (command, args) => {
        const raw = args as { args?: { images?: unknown[] }; images?: unknown[] } | undefined
        const images = raw?.args?.images ?? raw?.images
        if (command !== 'mlx_generate' || !images?.length) return invoke(command, args)
        return new Promise((resolve) => setTimeout(resolve, 2500)).then(() => invoke(command, args))
      }
    },
  })
  await rec.openCreate('Image')
  // Fixture 4.
  await page.getByRole('radio', { name: '16:9', exact: true }).first().click()
  await page.getByRole('button', { name: 'a lighthouse at dusk, dramatic storm clouds, cinematic' }).click()
  const chip = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: 'Qwen-Image 2.1' })
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(1000, 700)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Native HiRes is there with Qwen-Image 2.1, the image model that also edits.')
  await rec.cam(chip, 1.5)
  await rec.move(chip, { dur: 0.8, at: { dy: -26 } })
  rec.hold(0.8)
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.6, settle: 900, after: 0.2 })
  const toggle = page.getByRole('button', { name: /Native HiRes/ })
  await expect(toggle).toBeVisible()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await rec.cam(toggle, 1.5, 0.8)
  await rec.move(toggle, { dur: 0.6, at: { fx: 0.4 } })
  rec.hold(0.6)

  rec.scene('Turn it on: the finished picture is edited again at the larger size.')
  await rec.click(toggle, { dur: 0.4, settle: 600, after: 0.2 })
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  const sizes = page.getByText('→').first()
  await rec.move(sizes, { dur: 0.6, at: { dy: 22 }, real: false })
  rec.hold(1.6)

  rec.scene('Upscale sets the larger size, and the second pass starts at the HiRes denoise.')
  const denoise = page.getByText('HiRes denoise', { exact: true })
  await rec.cam(denoise, 1.4, 0.8)
  await rec.move(denoise, { dur: 0.7, at: { dy: 26 }, real: false })
  rec.hold(1.6)

  rec.scene('Create makes the picture, then the HiRes pass. Only the final picture is kept.')
  await rec.cam('full', 1, 0.8)
  await page.keyboard.press('Escape')
  await rec.key(400)
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), {
    dur: 0.8, settle: 300, after: 0.2,
    until: () => expect(page.getByText(/HiRes pass at/).first()).toBeVisible({ timeout: 20_000 }),
  })
  const pass = page.getByText(/HiRes pass at/).first()
  await rec.cam(pass, 1.5, 0.8)
  rec.hold(1.4)
  await expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText(/HiRes pass at/)).toHaveCount(0, { timeout: 20_000 })
  await rec.cam('full', 1, 0.8)
  await rec.key(800)
  rec.hold(1.6)
  rec.finish(1.0)
})
