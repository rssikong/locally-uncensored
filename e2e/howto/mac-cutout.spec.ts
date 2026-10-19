import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Cutout on a Mac (3.0.7). Recorded on integ/307 (9594dc1a2) with platform
// 'mac' in Local mode. Facts, all from that head:
//  - components/create/experimental/intents.ts:222 and 245 (MLX_LOCAL_INTENTS, runsOnMlx):
//    Remove Background is a local tab on every Mac. The subject mask comes
//    from the Vision framework of macOS, no model to install, no ComfyUI node.
//  - src-tauri/src/commands/mlx_cutout.rs:1 to 12 and 126: Vision finds every subject and its
//    mask becomes the alpha channel of a PNG. A picture without a subject gets
//    the sentence NO_SUBJECT and no empty image (not filmed, see the report).
//  - hooks/useCreate.ts:850 to 878 (Remove Background on a Mac): the result goes to the
//    gallery with "macOS Vision" as its tool (api/mlx-image.ts:296
//    MAC_CUTOUT_TOOL); the error line starts with "Remove Background failed:".
//  - Stage.tsx:479: "Hit Create to cut out the subject and export a transparent PNG."
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac': the mock pins navigator.platform, so the app takes
//     the Mac's local Create (MLX), not ComfyUI.
//  2. mlx.imageBase64: the answer of mlx_cutout is fox-cutout.png. That PNG is
//     a real macOS Vision cutout of the example fox (fox.jpg, the paper-cut fox
//     of the cutout film), made on this Mac outside the app with the same
//     request the command uses (VNGenerateForegroundInstanceMaskRequest). Not
//     real: the app did not run Vision in the rig.
//  3. initScript wraps mlx_cutout: the answer carries the size of the fox
//     (1536x864; the mock says 512x512), so the line under the result reads
//     what Vision would give back. Not real: an example size.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-cutout', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const dir = `${HOWTO_OUT}/mac-cutout/assets`
  const rec = await Rec.boot(page, 'mac-cutout', 'Cutout on a Mac', {
    mode: 'local',
    tauri: {
      platform: 'mac',
      // Fixture 2: the Vision cutout of the fox.
      mlx: { engineInstalled: true, installedImages: ['sd-turbo'], imageBase64: readFileSync(`${dir}/fox-cutout.png`).toString('base64') },
    },
    initScript: () => {
      // Fixture 3: the size of the cutout.
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: unknown) => Promise<unknown> } }
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      bridge.invoke = (command, args) => {
        if (command !== 'mlx_cutout') return invoke(command, args)
        return invoke(command, args).then((made) => ({ ...(made as object), width: 1536, height: 864 }))
      }
    },
  })
  await rec.openCreate('Remove Background')
  await page.locator('input[type="file"]').first().setInputFiles({ name: 'fox.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${dir}/fox.jpg`) })
  const hint = page.getByText('Hit Create to cut out the subject and export a transparent PNG.')
  await expect(hint).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(980, 880)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Cutout needs no download: macOS Vision finds the subject.')
  const tab = page.getByRole('radio', { name: 'Remove Background', exact: true })
  await rec.cam(tab, 1.5)
  await rec.move(tab, { dur: 0.8, at: { dy: 24 } })
  rec.hold(1.4)
  await rec.cam('full', 1, 0.8)
  await rec.move(hint, { dur: 0.7, at: { dy: 26 } })
  rec.hold(1.0)

  rec.scene('No prompt: Create cuts it out right on the Mac.')
  const create = page.getByRole('button', { name: /^Create$/ }).last()
  await rec.click(create, {
    dur: 0.9, settle: 900, after: 0.4,
    until: () => expect(page.locator('img[src^="data:image/png"]').first()).toBeVisible({ timeout: 20_000 }),
  })
  rec.hold(2.2)

  rec.scene('The PNG has a transparent background, and the line under it names macOS Vision.')
  const shown = page.getByText('macOS Vision').first()
  if (await shown.isVisible().catch(() => false)) {
    await rec.cam(shown, 1.5, 0.9)
    await rec.move(shown, { dur: 0.7, at: { dy: 24 } })
  }
  rec.hold(2.0)
  await rec.cam('full', 1, 1.0)
  rec.finish(1.2)
})
