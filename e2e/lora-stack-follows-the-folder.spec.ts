import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * GH #146 (2026-10-01), nachgeklickt wie gemeldet: zwei LoRAs
 * sind aus models/loras geloescht, stehen aber noch im gespeicherten Stapel.
 * Der Stapel zeigte "2 active" ohne Haken, und jeder Lauf schickte sie mit.
 * Hier antwortet ein nachgebautes ComfyUI ueber proxy_localhost, und die Liste
 * der LoRAs laesst sich waehrend des Tests aendern (Datei geloescht).
 */

const STALE = ['char_gracechar_e110.safetensors', 'char_gracechar_zimage.safetensors']
const STYLE = 'film_grain_xl.safetensors'
const CHAR = 'char_mira_zimage.safetensors'

async function bootWithFakeComfy(page: Page, loras: string[], imageModel: string) {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'windows' as const })
  await seedOnboardingDone(page)
  await page.addInitScript(([list, model, stale]) => {
    const w = window as unknown as { __LORAS__: string[]; __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string }) => Promise<unknown> } }
    if (!localStorage.getItem('create-store')) {
      localStorage.setItem('create-store', JSON.stringify({
        state: { backend: 'local', imageModel: model, selectedLoras: (stale as string[]).map((name) => ({ name, strength: 0.8 })) },
        version: 2,
      }))
    }
    w.__LORAS__ = list as string[]
    const bridge = w.__TAURI_INTERNALS__
    const invoke = bridge.invoke
    const combo = (v: string[]) => [v]
    const nodes = () => ({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: combo(['juggernautXL.safetensors']) } } },
      UNETLoader: { input: { required: { unet_name: combo(['z_image_turbo_bf16.safetensors']) } } },
      LoraLoader: { input: { required: { lora_name: combo(w.__LORAS__) } } },
      VAELoader: { input: { required: { vae_name: combo(['ae.safetensors']) } } },
      KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
    })
    bridge.invoke = (command, args) => {
      // Rust answers a list for every file; the header itself is not under test.
      if (command === 'sniff_model_files') return Promise.resolve([])
      if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
      const url = args.url
      if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'RTX 3060', type: 'cuda', vram_total: 12 * 1024 ** 3 }] }))
      const one = /\/object_info\/([^/?]+)/.exec(url)
      const all = nodes() as Record<string, unknown>
      if (one) return Promise.resolve(JSON.stringify(one[1] in all ? { [one[1]]: all[one[1]] } : {}))
      if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(all))
      return Promise.resolve('{}')
    }
  }, [loras, imageModel, STALE] as const)
}

async function openStack(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced settings' }).click()
  const expert = page.getByRole('button', { name: 'Expert', exact: true })
  await expect(expert).toBeVisible({ timeout: 15_000 })
  if (!(await page.getByText(/^LoRA stack/).isVisible())) await expert.click()
  await expect(page.getByRole('button', { name: /Rescan/ })).toBeVisible({ timeout: 15_000 })
}

const saved = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('create-store') || '{}').state?.selectedLoras)

test('picks whose files are gone leave the stack, the count matches what is ticked', async ({ page }) => {
  await bootWithFakeComfy(page, [STYLE], 'juggernautXL.safetensors')
  await openStack(page)
  await expect(page.getByText(STYLE.replace('.safetensors', ''))).toBeVisible()
  await expect(page.getByText(/active/)).toHaveCount(0)
  await expect.poll(() => saved(page)).toEqual([])

  // Pick the one that exists, then delete its file and rescan.
  await page.getByRole('button', { name: /film_grain_xl/ }).click()
  await expect(page.getByText('· 1 active')).toBeVisible()
  // Gegenprobe 8: the strength reads as a number.
  await expect(page.getByText('Strength')).toBeVisible()
  const strength = page.getByRole('textbox', { name: 'Strength of film_grain_xl' })
  await expect(strength).toHaveValue('0.80')
  // Discord 2026-10-02: the number can be typed, negative
  // and beyond the slider's 0 to 2, and more than 20 stops at 20.
  await strength.fill('-4')
  await strength.blur()
  await expect(strength).toHaveValue('-4.00')
  await expect.poll(() => saved(page)).toEqual([{ name: STYLE, strength: -4 }])
  await strength.fill('abc')
  await strength.blur()
  await expect(strength).toHaveValue('-4.00')
  await strength.fill('25')
  await strength.blur()
  await expect(strength).toHaveValue('20.00')
  await expect.poll(() => saved(page)).toEqual([{ name: STYLE, strength: 20 }])
  await page.evaluate(() => { (window as unknown as { __LORAS__: string[] }).__LORAS__ = [] })
  await page.getByRole('button', { name: /Rescan/ }).click()
  await expect(page.getByText(/active/)).toHaveCount(0)
  await expect.poll(() => saved(page)).toEqual([])
})

test('Clear turns every LoRA off', async ({ page }) => {
  await bootWithFakeComfy(page, [STYLE, CHAR], 'z_image_turbo_bf16.safetensors')
  await openStack(page)
  await page.getByRole('button', { name: /film_grain_xl/ }).click()
  await page.getByRole('button', { name: /char_mira_zimage/ }).click()
  await expect(page.getByText('· 2 active')).toBeVisible()
  await page.getByRole('button', { name: /Clear/ }).click()
  await expect(page.getByText(/active/)).toHaveCount(0)
  await expect.poll(() => saved(page)).toEqual([])
})

test('a Z-Image character on an SDXL checkpoint says so and is not counted', async ({ page }) => {
  await bootWithFakeComfy(page, [STYLE, CHAR], 'juggernautXL.safetensors')
  await openStack(page)
  const row = page.getByRole('button', { name: /char_mira_zimage/ })
  // Gegenprobe 8: the row says so before anyone ticks it.
  await expect(row).toContainText('Z-Image only')
  await row.click()
  await expect(row).toContainText('Z-Image only')
  await expect(page.getByText(/active/)).toHaveCount(0)
  // Gegenprobe 02.10.: the row showed a strength slider as if it applied.
  await expect(row.locator('xpath=..').getByRole('slider')).toHaveCount(0)
})

// Found on 2026-10-03: after the download of the MiniMax H3 Turbo LoRA the
// stack offered it on the image model Z-Image too, with its long file name
// cut off. A LoRA from the catalogue is listed where its family runs, under
// its catalogue name.
const H3_TURBO = 'minimax_h3_fl2v_turbo_8step_v1.0_comfyui_bf16.safetensors'
const PIXEL = 'pixel-art-xl.safetensors'

test('Z-Image is not offered the MiniMax H3 turbo LoRA or the SDXL LoRA from the catalogue', async ({ page }) => {
  await bootWithFakeComfy(page, [STYLE, H3_TURBO, PIXEL, CHAR], 'z_image_turbo_bf16.safetensors')
  await openStack(page)
  await expect(page.getByRole('button', { name: /film_grain_xl/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /char_mira_zimage/ })).toBeVisible()
  await expect(page.getByText(/minimax_h3/i)).toHaveCount(0)
  await expect(page.getByText(/MiniMax H3 Turbo LoRA/)).toHaveCount(0)
  await expect(page.getByText(/Pixel Art XL/)).toHaveCount(0)
})

test('an SDXL checkpoint is offered Pixel Art XL under its catalogue name, and the run gets the file name', async ({ page }) => {
  await bootWithFakeComfy(page, [STYLE, H3_TURBO, PIXEL], 'juggernautXL.safetensors')
  await openStack(page)
  const row = page.getByRole('button', { name: /Pixel Art XL · SDXL LoRA/ })
  await expect(row).toBeVisible()
  await expect(row).toHaveAttribute('title', PIXEL)
  await expect(page.getByText(/MiniMax H3 Turbo LoRA/)).toHaveCount(0)
  await row.click()
  await expect(page.getByText('· 1 active')).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Strength of Pixel Art XL · SDXL LoRA' })).toHaveValue('0.80')
  await expect.poll(() => saved(page)).toEqual([{ name: PIXEL, strength: 0.8 }])
})

test('a render that left a LoRA out says so under the result', async ({ page }) => {
  // Gegenprobe 8 (02.10.): the "Skipping LoRA" progress line was gone a
  // second later, so the picture looked as if the style had been applied.
  await page.addInitScript(() => {
    localStorage.setItem('create-store', JSON.stringify({
      state: {
        backend: 'local',
        gallery: [{
          id: 'g1', type: 'image', filename: 'apple_k3f9q2_00001_.png', subfolder: '', prompt: 'a red apple', negativePrompt: '',
          model: 'sd_turbo.safetensors', modelType: 'sd15', seed: 7, steps: 4, cfgScale: 1, sampler: 'euler',
          scheduler: 'simple', width: 512, height: 512, batchSize: 1, createdAt: Date.now(),
          runNote: 'Skipping LoRA no longer in models/loras: zz_gegenprobe_style',
        }],
      },
      version: 2,
    }))
  })
  await bootWithFakeComfy(page, [], 'sd_turbo.safetensors')
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
  await page.route('**/view?**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: png }))
  await page.goto('/')
  await page.getByRole('button', { name: /^Create$/ }).click()
  await page.getByRole('button', { name: 'Open the gallery' }).click()
  await page.locator('aside').filter({ hasText: 'Gallery' }).locator('.group').first().locator('button').first().click()
  await expect(page.getByTestId('run-note')).toHaveText('Skipping LoRA no longer in models/loras: zz_gegenprobe_style')
})
