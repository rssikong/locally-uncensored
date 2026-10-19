import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from '../support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch } from '../support/cloud-mock'
import { Rec, HOWTO_OUT } from './rec'
import { noPriceFixtures } from './no-price'

// A character trained on LU Cloud, used on this machine (3.0.7). Recorded on
// the 3.0.7 Desktop release head 0a62b652d on Windows. Facts, all from that
// head:
//  - components/create/experimental/SpecialIntentControls.tsx: the cloud
//    Use character shelf has, per character, Download, CharacterUseLocally
//    and Delete; the family label (FAMILY_LABEL: z-image "Z-Image", flux
//    "Flux").
//  - CharacterUseLocally.tsx: the button "Use locally" (title "Use locally:
//    save it to the LoRA folder of this computer"); after the save the note
//    "Saved for local use" and the local shelves read again
//    (refreshLocalShelves); a character of another family gets the note
//    "Only Z-Image characters run locally", with the reason as its title, and
//    nothing is saved. A failure goes to the red bar as "Use locally failed:
//    ...".
//  - api/character-import.ts: canUseLocally (z-image only), ONLY_ZIMAGE_LOCALLY
//    "Only Z-Image characters run locally. This one was trained for another
//    model, so it stays in LU Cloud."; the answer 'exists' becomes "A local
//    character named <file> is already on this computer. Delete it under Use
//    character in the local lane first if you want to replace it." The file
//    name is the trainer's, char_<trigger>_zimage.
//  - SpecialIntentControls.tsx LocalCharacterShelf: the local Use character
//    shelf lists char_<trigger>_zimage files; "Delete character <trigger>"
//    opens the dialog "Delete the character <trigger>? Its file moves to the
//    Recycle Bin, so you can put it back from there."
//  - CHANGELOG 3.0.7: Use locally has run in automated tests only, not yet
//    against the real service. The film shows the controls, no transfer.
//
// Fixtures (nothing on the page is altered; all answers come before the app
// loads):
//  1. no-price.ts: the catalog without prices that are not public, the Hosted
//     balance of the public plan; /api/loras answers with two example cloud
//     characters, Rusty (Z-Image, trigger rustyfox) and Juniper (Flux,
//     trigger juniperowl). Not real: no training ran.
//  2. Tauri command import_cloud_character: the first call answers 'saved'
//     with the trainer's file name and from then on ComfyUI lists that file;
//     every later call answers 'exists', as the backend does once a file of
//     that name is there (commands/character_files.rs). Not real: nothing is
//     downloaded or written; the path is an example.
//  3. ComfyUI (port 8188, through the Tauri command proxy_localhost, as in
//     character-local.spec.ts): one 16 GB GPU, the Z Image Turbo model with
//     its text encoder and VAE, and in the LoRA list the file of fixture 2
//     once it was "saved". Not real: no ComfyUI runs.
//  4. character_trainer_status: the local trainer is set up (the local
//     Character Studio asks for it); detect_gpus and sniff_model_files: one
//     16 GB card, no header sniffing. Not real: example values.
// This film boots like Rec.boot but without its style that hides the red bar
// of Create: the red bar is a subject here. In Cloud mode the bar shows no
// ComfyUI line (CreateExperimental.tsx banner), and in Local mode fixture 3
// answers, so the bar stays empty unless the app has something to say.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const LORAS = [
  { id: '0b9d7c1e-1111-4222-8333-444455556666', name: 'Rusty', trigger_word: 'rustyfox', base_family: 'z-image', created_at: '2026-10-09T10:00:00Z' },
  { id: '7a2e4f90-5555-4666-8777-888899990000', name: 'Juniper', trigger_word: 'juniperowl', base_family: 'flux', created_at: '2026-10-08T15:00:00Z' },
]

function localFixtures() {
  const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: Record<string, unknown> & { url?: string }) => Promise<unknown> } }
  const FILE = 'char_rustyfox_zimage.safetensors'
  const bridge = w.__TAURI_INTERNALS__
  const invoke = bridge.invoke
  const combo = (v: string[]) => [v]
  let saved = false
  const nodes = (): Record<string, unknown> => ({
    UNETLoader: { input: { required: { unet_name: combo(['z_image_turbo_bf16.safetensors']) } } },
    CLIPLoader: { input: { required: { clip_name: combo(['qwen_3_4b.safetensors']) } } },
    LoraLoader: { input: { required: { lora_name: combo(saved ? [FILE] : []) } } },
    VAELoader: { input: { required: { vae_name: combo(['ae.safetensors']) } } },
    KSampler: { input: { required: { sampler_name: combo(['euler']), scheduler: combo(['simple']) } } },
  })
  bridge.invoke = (command, args) => {
    // Fixture 2: the first save lands, every later one meets the file.
    if (command === 'import_cloud_character') {
      if (saved) return Promise.resolve({ status: 'exists', file: FILE })
      saved = true
      return new Promise((r) => setTimeout(() => r({ status: 'saved', file: FILE, path: `C:\\Users\\example\\ComfyUI\\models\\loras\\${FILE}`, bytes: 170_000_000, keyFormat: 'same' }), 700))
    }
    // Fixture 4.
    if (command === 'character_trainer_status') {
      return Promise.resolve({
        envReady: true, basesReady: true,
        dit: 'z_image_bf16.safetensors', textEncoder: 'qwen_3_4b.safetensors', vae: 'ae.safetensors',
        root: 'C:\\Users\\example\\AppData\\Roaming\\LU\\trainer', customized: false, suggestedRoot: null,
        install: { status: 'complete', logs: [] },
      })
    }
    if (command === 'sniff_model_files') return Promise.resolve([])
    if (command === 'detect_gpus') return Promise.resolve([{ index: 0, vendor: 'nvidia', name: 'GPU', memory_mib: 16384, source: 'fixture' }])
    if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
    // Fixture 3: what a running ComfyUI lists.
    const url = args.url
    if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'GPU', type: 'cuda', vram_total: 16 * 1024 ** 3 }] }))
    const all = nodes()
    const one = /\/object_info\/([^/?]+)/.exec(url)
    if (one) return Promise.resolve(JSON.stringify(one[1] in all ? { [one[1]]: all[one[1]] } : {}))
    if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(all))
    return Promise.resolve('{}')
  }
}

/** Rec.boot in Cloud mode, without the style that hides the red bar. */
async function boot(page: Page): Promise<Rec> {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'windows' as const })
  await page.addInitScript(localFixtures)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true, studioCatalog: true, tier: 'hosted' })
  await noPriceFixtures({ loras: LORAS })(page)
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
  await signInViaGate(page)
  await expect(cloudSwitch(page)).toBeChecked({ timeout: 20_000 })
  return new Rec(page, 'character-cloud-local', 'Use a cloud character on your machine')
}

test('character-cloud-local', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const rec = await boot(page)
  await rec.openCreate('Character Studio')
  // The Use character shelf is open when the film starts.
  await page.getByRole('radio', { name: 'Use character' }).click()
  const rusty = page.getByTitle('Rusty, trigger word: rustyfox')
  await expect(rusty).toBeVisible({ timeout: 15_000 })
  const useLocally = page.getByTestId('character-use-locally')
  await expect(useLocally).toHaveCount(2)
  await page.mouse.move(980, 560)

  await rec.key(800)
  rec.hold(0.3)
  rec.scene('On the cloud character shelf, Use locally saves a Z-Image character into this computer\'s LoRA folder.')
  await rec.cam(rusty, 1.6, 0.9)
  await rec.move(rusty, { dur: 0.7, real: false })
  rec.hold(0.3)
  const note = page.getByTestId('character-use-locally-note')
  await rec.click(useLocally.first(), { dur: 0.6, settle: 200, after: 0.2 })
  await expect(note).toHaveText('Saved for local use', { timeout: 15_000 })
  await rec.key(300)
  rec.hold(1.2)

  rec.scene('A character of another model family stays in LU Cloud, and LU says why.')
  await rec.cam(page.getByTitle('Juniper, trigger word: juniperowl'), 1.5, 0.8)
  await rec.click(useLocally.nth(1), { dur: 0.7, settle: 500, after: 0.2 })
  await expect(page.getByText('Only Z-Image characters run locally', { exact: true })).toBeVisible()
  await rec.move(page.getByText('Only Z-Image characters run locally', { exact: true }), { dur: 0.5, at: { dy: 20 }, real: false })
  rec.hold(1.4)

  rec.scene('Once the file is there, LU stops and says so instead of replacing it.')
  await rec.click(useLocally.first(), { dur: 0.6, settle: 600, after: 0.2 })
  const bar = page.getByText(/^Use locally failed: A local character named char_rustyfox_zimage\.safetensors is already on this computer\./)
  await expect(bar).toBeVisible({ timeout: 10_000 })
  // The red bar runs the width of the window: the whole window is shown.
  await rec.cam('full', 1, 0.9)
  await rec.move(bar, { dur: 0.7, at: { fx: 0.3, dy: 22 }, real: false })
  await rec.key(300)
  rec.hold(1.6)

  rec.scene('In Local mode, the Use character shelf lists it.')
  // The red bar is closed with its own button first.
  await rec.click(page.getByRole('button', { name: 'Dismiss' }), { dur: 0.6, settle: 500, after: 0.1 })
  await expect(bar).toHaveCount(0)
  await rec.click(cloudSwitch(page), { dur: 0.8, settle: 900, after: 0.2 })
  await expect(cloudSwitch(page)).not.toBeChecked()
  const local = page.getByTitle('Trigger word: rustyfox')
  if (!(await local.isVisible().catch(() => false))) {
    await page.getByRole('radio', { name: 'Use character' }).click()
  }
  await expect(local).toBeVisible({ timeout: 15_000 })
  await rec.key(600)
  await rec.cam(local, 1.6, 0.9)
  await rec.move(local, { dur: 0.7, real: false })
  rec.hold(1.0)

  rec.scene('Its delete button asks first, and the file goes to the Recycle Bin.')
  await rec.click(page.getByRole('button', { name: 'Delete character rustyfox' }), { dur: 0.6, settle: 700, after: 0.2 })
  const ask = page.getByRole('dialog', { name: 'Delete character' })
  await expect(ask).toContainText('Its file moves to the Recycle Bin, so you can put it back from there.')
  await rec.cam(ask, 1.4, 0.8)
  await rec.move(ask.getByText(/Recycle Bin/), { dur: 0.6, at: { dy: 18 }, real: false })
  rec.hold(1.6)
  rec.finish(0.6)
})
