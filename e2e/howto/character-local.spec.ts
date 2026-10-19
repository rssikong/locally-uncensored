import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Character Studio in Local mode: the details people get stuck on (GitHub #161).
// Facts, all from this worktree's code:
//  - src/lib/trainer-presets.ts: the lengths "Quick" (400 steps), "Standard"
//    (1200, the default) and "Thorough" (2400); the note under the controls
//    names the length and its steps (trainStepsNote).
//  - SpecialIntentControls.tsx LocalTrainControls: the field "Trigger word,
//    e.g. davechar". That the trigger word should be one made up word is the
//    handbook's advice (docs/guide/character-studio, "Train on LU Cloud" 2);
//    the code backs that the trigger word is the character's name
//    (api/trainer.ts parseLocalCharacterLora, file char_<trigger>_zimage).
//  - SpecialIntentControls.tsx LocalCharacterShelf: picking a character turns
//    its LoRA on and switches to the Z Image model it was trained for
//    (lib/character-base.ts characterBaseModel). With another model the red
//    line reads "This character was trained for Z Image. Pick a Z Image model
//    to use it." with "Switch model", and the run is blocked.
//    Recorded on the 3.0.7 Desktop head 0c2b9bcda (probe/desktop-307-all-3).
//  - ModelChip.tsx LocalModelChip: the chip shows the model the run uses.
//  - ParamGroups.tsx: Advanced settings, Expert, "LoRA stack"; an active LoRA
//    that fits the model has a "Strength" (LoraStrength.tsx). On a model it
//    does not fit the row reads "Z-Image only" and has no Strength.
//
// Fixtures (nothing on the page is altered; all answers come before the app
// loads, through Rec.boot's initScript):
//  1. create-store in localStorage: Local backend with an SDXL checkpoint as
//     the image model, as an earlier session leaves it. Not real: no such
//     session happened.
//  2. Tauri command character_trainer_status: the trainer is set up and the
//     three Z Image base files are there. Not real: nothing was installed or
//     downloaded; the folder path is an example.
//  3. ComfyUI (port 8188, reached through the Tauri command proxy_localhost,
//     the way create-fx.ts comfyUp does it; the app never fetches ComfyUI
//     directly, so page.route cannot answer it): /system_stats reports one
//     16 GB GPU; /object_info lists one SDXL checkpoint, one Z Image Turbo
//     diffusion model, its text encoder and VAE, and one LoRA,
//     char_rustyfox_zimage.safetensors, the file a finished local training
//     run leaves. Not real: no ComfyUI runs, no file exists, no run trained it.
//  4. detect_gpus and sniff_model_files: one 16 GB card, no header sniffing,
//     so the picker shows no fit warning. Not real: example values.
// The photos are the example crops of a paper-cut fox that the Cloud film
// (character.spec.ts) uses; they are only added to the set, nothing is staged
// or trained.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('character-local', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'character-local', 'Character Studio on your own graphics card', {
    mode: 'local',
    tauri: { platform: 'windows' },
    initScript: () => {
      const SDXL = 'Juggernaut-XL_v9.safetensors'
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string }) => Promise<unknown> } }
      // Fixture 1: the state an earlier session leaves.
      if (!localStorage.getItem('create-store')) {
        localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', imageModel: SDXL }, version: 2 }))
      }
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      const combo = (v: string[]) => [v]
      // Fixture 3: what a running ComfyUI lists.
      const nodes: Record<string, unknown> = {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: combo([SDXL]) } } },
        UNETLoader: { input: { required: { unet_name: combo(['z_image_turbo_bf16.safetensors']) } } },
        CLIPLoader: { input: { required: { clip_name: combo(['qwen_3_4b.safetensors']) } } },
        LoraLoader: { input: { required: { lora_name: combo(['char_rustyfox_zimage.safetensors']) } } },
        VAELoader: { input: { required: { vae_name: combo(['ae.safetensors']) } } },
        KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
      }
      bridge.invoke = (command, args) => {
        // Fixture 2: trainer ready, base files there.
        if (command === 'character_trainer_status') {
          return Promise.resolve({
            envReady: true, basesReady: true,
            dit: 'z_image_bf16.safetensors', textEncoder: 'qwen_3_4b.safetensors', vae: 'ae.safetensors',
            root: 'C:\\Users\\example\\AppData\\Roaming\\LU\\trainer', customized: false, suggestedRoot: null,
            install: { status: 'complete', logs: [] },
          })
        }
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
  })
  await rec.openCreate('Character Studio')
  const trigger = page.getByPlaceholder('Trigger word, e.g. davechar')
  await expect(trigger).toBeVisible()
  // The set already holds five example photos when the film starts (the
  // stage's own file input, the same as the add button).
  await page.locator('input[type=file]').setInputFiles([1, 2, 3, 4, 5].map((n) => `${HOWTO_OUT}/character/assets/fox-${n}.jpg`))
  await expect(page.getByText(/^5\/100 photos$/)).toBeVisible()
  await page.mouse.move(980, 520)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('The trigger word is the name you call the character by in the prompt.')
  await rec.cam({ x: 600, y: 820 }, 1.5)
  await rec.click(trigger, { dur: 0.7, at: { fx: 0.25 }, after: 0.15 })
  await rec.move(trigger, { dur: 0.3, at: { fx: 0.5, dy: 30 }, real: false })
  await rec.type(trigger, 'rustyfox', { cps: 10, band: { up: 160, down: 160 } })
  rec.hold(0.3)

  rec.scene('Pick how long it trains: Quick, Standard or Thorough.')
  await rec.click(page.getByRole('radio', { name: 'Quick', exact: true }), { dur: 0.55, settle: 500, after: 0.5 })
  await expect(page.getByText(/\(Quick, 400 steps\)/)).toBeVisible()
  await rec.click(page.getByRole('radio', { name: 'Thorough', exact: true }), { dur: 0.55, settle: 500, after: 0.2 })
  await expect(page.getByText(/\(Thorough, 2400 steps\)/)).toBeVisible()
  await rec.move(page.getByText(/\(Thorough, 2400 steps\)/), { dur: 0.5, at: { fx: 0.3, dy: 16 }, real: false })
  rec.hold(0.9)

  rec.scene('Under "Use character", pick it: the image model switches to the Z Image model it was trained for.')
  await rec.click(page.getByRole('radio', { name: 'Use character' }), { dur: 0.6, settle: 900, after: 0.2 })
  const pick = page.getByTitle('Trigger word: rustyfox')
  await expect(pick).toBeVisible()
  await expect(page.locator('button[aria-haspopup="listbox"]').filter({ hasText: 'Juggernaut' })).toBeVisible()
  await rec.click(pick, { dur: 0.5, settle: 700, after: 0.2 })
  await expect(page.getByTestId('character-use-hint')).toBeVisible()
  const zchip = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Z-Image/ })
  await expect(zchip).toBeVisible()
  await rec.move(zchip, { dur: 0.5, at: { fx: 0.5, dy: -26 }, real: false })
  rec.hold(0.8)

  rec.scene('Pick another model by hand and a red line says so. "Switch model" brings Z Image back.')
  await rec.click(zchip, { dur: 0.6, settle: 600, after: 0.3 })
  const sdxl = page.getByRole('option', { name: /Juggernaut/ }).first()
  await expect(sdxl).toBeVisible()
  await rec.click(sdxl, { dur: 0.6, settle: 700, after: 0.3 })
  const warn = page.getByTestId('character-model-warning')
  await expect(warn).toContainText('This character was trained for Z Image. Pick a Z Image model to use it.')
  rec.hold(0.9)
  await rec.click(page.getByTestId('character-model-switch'), { dur: 0.6, settle: 700, after: 0.3 })
  await expect(page.getByTestId('character-use-hint')).toBeVisible()
  rec.hold(0.3)

  rec.scene('Advanced settings, Expert, "LoRA stack": the character\'s Strength.')
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.6, settle: 900, after: 0.2 })
  if (!(await page.getByText(/^LoRA stack/).isVisible().catch(() => false))) {
    await rec.click(page.getByRole('button', { name: 'Expert', exact: true }), { dur: 0.5, settle: 600 })
  }
  const strength = page.getByRole('textbox', { name: /^Strength of / })
  await expect(strength).toBeVisible()
  await strength.scrollIntoViewIfNeeded()
  await rec.key(400)
  await rec.cam(strength, 1.5, 0.8)
  await rec.click(strength, { dur: 0.6, settle: 300, after: 0.1 })
  for (let i = 0; i < 2; i++) {
    await page.keyboard.press('ArrowUp')
    rec.hold(0.3)
    await rec.key(150)
  }
  rec.hold(0.5)
  rec.finish(1.0)
})
