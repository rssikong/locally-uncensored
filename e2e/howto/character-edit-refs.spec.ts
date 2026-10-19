import { test, expect } from '@playwright/test'
import { readFileSync } from 'fs'
import { Rec, HOWTO_OUT } from './rec'

// Edit with the photos a character was trained on (3.0.7). Recorded on the
// 3.0.7 Desktop release head 0a62b652d in Local mode on Windows. Facts, all
// from that head:
//  - components/create/experimental/ReferenceStrip.tsx: in Local mode the
//    strip under the Edit source holds the row TrainedCharacterChips; the line
//    under the strip reads "Name them in the prompt as image 2 to image 4." (lib/edit-references.ts referenceNames, 3.0.7 with up to ten images).
//  - TrainedCharacterChips.tsx: the row "Trained characters" lists the local
//    characters with kept training photos (charactersWithPhotos); a character
//    with none (trained before 3.0.7, or brought in from LU Cloud) is not
//    listed. A click loads the photos as references (loadTrainingPhotos),
//    title "Load N training photos of <name>".
//  - lib/edit-references.ts: MAX_EXTRA_REFERENCES 3; extraReferenceSlots gives
//    Qwen-Image 2.1 (type qwenimage) three references besides the source.
//  - lib/character-photos.ts and src-tauri/src/commands/character_files.rs
//    (PHOTO_EDGE 1024): the backend hands out the best photos as copies of at
//    most 1024 pixels.
//  - CHANGELOG 3.0.7: not tried with a real training set yet. The film shows
//    the controls and promises nothing about the edit.
//
// Fixtures (nothing on the page is altered; all answers come before the app
// loads, through Rec.boot's initScript and fixtures):
//  1. create-store in localStorage: Local backend with the Qwen-Image 2.1 file
//     as the image model, as an earlier session leaves it. Not real.
//  2. ComfyUI (port 8188, through the Tauri command proxy_localhost, the way
//     character-local.spec.ts does it): one 16 GB GPU; /object_info lists the
//     Qwen-Image 2.1 diffusion model with its text encoder and VAE, the Z
//     Image Turbo model, ComfyUI's built-in inpaint nodes and two LoRAs,
//     char_rustyfox_zimage.safetensors (trained here with 3.0.7) and
//     char_mossbear_zimage.safetensors (trained before 3.0.7). Not real: no
//     ComfyUI runs, no file exists, no run trained either character.
//  3. Tauri command character_photos: rustyfox has three kept photos, the
//     example crops fox-1, fox-3 and fox-4 of the Cloud character film;
//     mossbear has none, as a character trained before 3.0.7. Not real: no
//     training set exists.
//  4. detect_gpus and sniff_model_files: one 16 GB card, no header sniffing.
//  5. Tauri command comfy_upload_image (ComfyUI's /upload/image) answers with
//     the file's name, as ComfyUI does. Not real: nothing is uploaded.
// The Edit source picture is the example island of the Edit film (set through
// the stage's own file input; picking a file is not the subject).
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const FOX = (n: number) => `${HOWTO_OUT}/character/assets/fox-${n}.jpg`

test('character-edit-refs', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const photos = [1, 3, 4].map((n) => ({ name: `fox-${n}.jpg`, mime: 'image/jpeg', base64: readFileSync(FOX(n)).toString('base64') }))
  const rec = await Rec.boot(page, 'character-edit-refs', 'Edit with the photos of a trained character', {
    mode: 'local',
    tauri: { platform: 'windows' },
    initScript: () => {
      const QWEN = 'qwen_image_2.1_bf16.safetensors'
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown> & { url?: string }) => Promise<unknown> }; __luPhotos?: unknown[] }
      // Fixture 1: the state an earlier session leaves.
      if (!localStorage.getItem('create-store')) {
        localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', imageModel: QWEN }, version: 2 }))
      }
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      const combo = (v: string[]) => [v]
      // Fixture 2: what a running ComfyUI lists.
      const nodes: Record<string, unknown> = {
        UNETLoader: { input: { required: { unet_name: combo([QWEN, 'z_image_turbo_bf16.safetensors']) } } },
        CLIPLoader: { input: { required: { clip_name: combo(['qwen_2.5_vl_7b_fp8_scaled.safetensors', 'qwen_3_4b.safetensors']) } } },
        LoraLoader: { input: { required: { lora_name: combo(['char_mossbear_zimage.safetensors', 'char_rustyfox_zimage.safetensors']) } } },
        VAELoader: { input: { required: { vae_name: combo(['qwen_image_2.1_vae_bf16.safetensors', 'ae.safetensors']) } } },
        KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
        LoadImage: { input: { required: { image: combo([]) } } },
        TextEncodeQwenImage21: { input: { required: {} } },
        VAEEncodeForInpaint: { input: { required: {} } },
        InpaintModelConditioning: { input: { required: {} } },
        SaveImage: { input: { required: {} } },
      }
      bridge.invoke = (command, args) => {
        // Fixture 3: the kept training photos.
        if (command === 'character_photos') {
          const all = (args.file === 'char_rustyfox_zimage.safetensors' ? (w.__luPhotos ?? []) : []).slice(0, Number(args.max ?? 3))
          return Promise.resolve({ count: all.length, photos: args.countOnly ? [] : all })
        }
        // Fixture 5: ComfyUI's /upload/image (a Rust multipart post in the app) keeps the file under its name.
        if (command === 'comfy_upload_image') return Promise.resolve(JSON.stringify({ name: String(args.filename), subfolder: '', type: 'input' }))
        // Fixture 4: one card, no header sniffing.
        if (command === 'sniff_model_files') return Promise.resolve([])
        if (command === 'detect_gpus') return Promise.resolve([{ index: 0, vendor: 'nvidia', name: 'GPU', memory_mib: 16384, source: 'fixture' }])
        if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
        const url = args.url
        if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'GPU', type: 'cuda', vram_total: 16 * 1024 ** 3 }] }))
        const one = /\/object_info\/([^/?]+)/.exec(url)
        if (one) return Promise.resolve(JSON.stringify(one[1] in nodes ? { [one[1]]: nodes[one[1]] } : {}))
        if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(nodes))
        return Promise.resolve('{}')
      }
    },
    fixtures: async (page) => {
      // Fixture 3: the photo data, read by the invoke wrapper at call time.
      await page.addInitScript((p) => { (window as unknown as { __luPhotos: unknown }).__luPhotos = p }, photos)
    },
  })

  await rec.openCreate('Edit / Image to Image')
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles({
    name: 'island.jpg', mimeType: 'image/jpeg', buffer: readFileSync(`${HOWTO_OUT}/edit/assets/island.jpg`),
  })
  const row = page.getByTestId('trained-characters')
  await expect(row).toBeVisible({ timeout: 20_000 })
  const chip = row.getByRole('button', { name: 'rustyfox' })
  await expect(chip).toBeVisible()
  await expect(row.getByRole('button', { name: 'mossbear' })).toHaveCount(0)
  await page.mouse.move(980, 520)

  await rec.key(800)
  rec.hold(0.3)
  rec.scene('In Edit with Qwen-Image 2.1, the reference strip has a row Trained characters.')
  await rec.cam(row, 1.5, 0.9)
  await rec.move(row.getByText('Trained characters'), { dur: 0.8, at: { dy: 18 } })
  await rec.key(300)
  rec.hold(1.0)

  rec.scene('A click adds up to three photos the character was trained on, at most 1024 pixels each.')
  await rec.click(chip, { dur: 0.6, settle: 400, after: 0.2, until: () => expect(page.getByTestId('reference-strip').locator('img')).toHaveCount(3, { timeout: 15_000 }) })
  await rec.key(500)
  await rec.cam(page.getByTestId('reference-strip'), 1.45, 0.8)
  await rec.move(page.getByTestId('reference-strip').locator('img').nth(1), { dur: 0.6, at: { dy: 44 }, real: false })
  rec.hold(1.6)

  rec.scene('The prompt names them as image 2 to image 4.')
  const hint = page.getByText(/Name them in the prompt as image 2 to image 4\./)
  await expect(hint).toBeVisible()
  const prompt = page.locator('textarea').first()
  await rec.cam('full', 1, 0.8)
  await rec.click(prompt, { dur: 0.6, at: { fx: 0.15 }, after: 0.1 })
  await rec.move({ x: 935, y: 870 }, { dur: 0.3, real: false })
  await rec.type(prompt, 'the fox from image 2 sits on the rocks by the waterfall', { cps: 28, band: { up: 700 } })
  rec.hold(0.6)

  rec.scene('A character trained before 3.0.7 kept no photos, so the row leaves it out.')
  const charChip = page.getByRole('button', { name: 'Character' })
  await rec.cam(charChip, 1.4, 0.8)
  await rec.click(charChip, { dur: 0.7, settle: 600, after: 0.2 })
  const old = page.getByRole('option', { name: /mossbear/ })
  await expect(old).toBeVisible()
  await rec.move(old, { dur: 0.6 })
  await rec.key(300)
  rec.hold(0.8)
  await rec.cam(row, 1.4, 0.8)
  await rec.move(chip, { dur: 0.8, at: { dy: 18 }, real: false })
  rec.hold(1.2)
  await rec.cam('full', 1, 0.8)
  rec.finish(0.8)
})
