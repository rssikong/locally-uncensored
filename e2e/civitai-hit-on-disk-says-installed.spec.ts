import { test, expect, type Page } from '@playwright/test'
import { bootWithFakeComfy } from './support/fake-comfy'

/**
 * A feature request (3.0.7): in the CivitAI search of the
 * Model Manager a model that is already installed still offered Download. Here
 * the LoRA lane on Windows searches CivitAI (a canned answer), and the disk
 * check answers from a fake models folder: one hit lies in loras/ with its
 * exact size, one under the same name with another size (another version), one
 * only in checkpoints/ (another folder), one nowhere. Only the first is
 * Installed, and a click on the others still starts a download.
 */

const KB = 1024
const HITS = [
  { id: 101, name: 'Detail Tweaker XL', file: 'detail_tweaker_xl.safetensors', sizeKB: 222_000.5 },
  { id: 102, name: 'Film Grain', file: 'film_grain_v2.safetensors', sizeKB: 145_000.25 },
  { id: 103, name: 'Pixel Art', file: 'pixel_art_xl.safetensors', sizeKB: 170_000 },
  { id: 104, name: 'Watercolor', file: 'watercolor_xl.safetensors', sizeKB: 99_000 },
]
/** The fake disk, by ComfyUI folder and file name. */
const DISK: Record<string, number> = {
  'loras/detail_tweaker_xl.safetensors': Math.round(222_000.5 * KB),
  'loras/film_grain_v2.safetensors': Math.round(145_000.25 * KB) + 12_000_000,
  'checkpoints/pixel_art_xl.safetensors': 170_000 * KB,
}

async function boot(page: Page) {
  await bootWithFakeComfy(page, { checkpoints: ['juggernautXL.safetensors'], loras: [], imageModel: 'juggernautXL.safetensors' })
  await page.addInitScript(([hits, disk]) => {
    const w = window as unknown as {
      __CHECKED__: string[]
      __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown>) => Promise<unknown> }
    }
    w.__CHECKED__ = []
    const bridge = w.__TAURI_INTERNALS__
    const invoke = bridge.invoke
    bridge.invoke = (command, args) => {
      if (command === 'fetch_external' && String(args?.url).includes('/api/v1/models?')) {
        return Promise.resolve(JSON.stringify({
          items: (hits as typeof HITS).map((h) => ({
            id: h.id, name: h.name, stats: {},
            modelVersions: [{ downloadUrl: `https://civitai.com/api/download/models/${h.id}`, files: [{ name: h.file, sizeKB: h.sizeKB }] }],
          })),
        }))
      }
      if (command === 'check_model_sizes') {
        const files = args.files as Array<{ subfolder: string; filename: string }>
        return Promise.resolve(files.map((f) => {
          const key = `${f.subfolder}/${f.filename}`
          w.__CHECKED__.push(key)
          const bytes = (disk as Record<string, number>)[key]
          return { filename: f.filename, exists: bytes != null, actualBytes: bytes ?? 0, complete: bytes != null }
        }))
      }
      return invoke(command, args)
    }
  }, [HITS, DISK] as const)
  await page.goto('/')
}

test('a CivitAI hit already in its folder says Installed and offers no second download', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await boot(page)
  await page.getByRole('button', { name: 'Models', exact: true }).click()
  await page.getByRole('button', { name: 'LoRAs', exact: true }).click()
  await page.getByRole('button', { name: /^Get new/ }).first().click()

  const field = page.getByRole('textbox', { name: 'Search CivitAI for LoRAs' })
  await field.fill('xl')
  await page.getByRole('button', { name: 'Search CivitAI' }).click()

  const row = (name: string) => page.getByTestId('civitai-hit').filter({ hasText: name })
  await expect(page.getByTestId('civitai-hit')).toHaveCount(4)

  // On disk, right folder, right size: Installed, and no button that fetches it again.
  await expect(row('Detail Tweaker XL').getByText('Installed', { exact: true })).toBeVisible()
  await expect(row('Detail Tweaker XL').getByRole('button', { name: 'Download' })).toHaveCount(0)

  // Same name, another size; same name, another folder; not there at all: Download.
  for (const name of ['Film Grain', 'Pixel Art', 'Watercolor']) {
    await expect(row(name).getByRole('button', { name: 'Download' })).toBeVisible()
    await expect(row(name).getByText('Installed', { exact: true })).toHaveCount(0)
  }

  if (process.env.LU_SHOTS) await page.screenshot({ path: `${process.env.LU_SHOTS}/civitai-installed.png` })

  // Each hit was asked about in the folder its download writes to.
  const checked = await page.evaluate(() => (window as unknown as { __CHECKED__: string[] }).__CHECKED__)
  expect(checked).toEqual(expect.arrayContaining(HITS.map((h) => `loras/${h.file}`)))
  // Other cards of the page ask about their own files; none of these was looked for elsewhere.
  const files = new Set(HITS.map((h) => h.file))
  expect(checked.filter((k) => files.has(k.split('/').pop()!) && !k.startsWith('loras/'))).toEqual([])
})
