import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Use character on a Mac (3.0.7). Recorded on integ/307 (ddeccc9ce, first take on 0a62b652d) with
// platform 'mac' in Local mode. Facts, all from that head:
//  - components/create/experimental/intents.ts MLX_LOCAL_INTENTS: Character
//    Studio is a local tab on a Mac; "Use character" runs a character's LoRA
//    from the Mac's LoRA folder on the second image engine (mflux --lora).
//  - SpecialIntentControls.tsx CharacterPanel and MacTrainControls: on this
//    head Train new trains on the Mac itself (3.0.7 changelog "On a Mac,
//    Train new trains a character on this Mac"); the earlier note "Training
//    a character does not run on a Mac yet" is gone. The old first scene
//    said training does not run on a Mac and is struck; training has its
//    own film, mac-train.
//  - SpecialIntentControls.tsx LocalCharacterShelf and lib/characters.ts
//    localLoraNames: the shelf lists the char_<name>_zimage files of the Mac's
//    LoRA folder; a pick turns the LoRA on and sets the Z Image model it was
//    trained for (lib/character-base.ts characterBaseModel).
//  - CharacterChip.tsx MAC_CHARACTER_LANES: on a Mac the Character chip is on
//    Image, Video and Animate (not Edit). Its note on a video tab reads
//    "First an image of <name> is made with Z Image, then the video starts
//    from it."
//  - hooks/useCreate.ts (the character chain) with
//    lib/characters.ts CHAIN_STEP_IMAGE: the run shows "Step 1 of 2:
//    character image" while the picture is made on the Mac, then step 2 is
//    the video from it. On a Mac that needs a video model that takes a start
//    image (useCreate.ts mlxTakesStartImage).
//  - Not shown: the chat tools taking the character.
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine and second image engine (mflux) set
//     up, SD Turbo and Z-Image Turbo 4-bit installed, both video engines set
//     up and LTX-2.3 Distilled 4-bit installed. Not real: nothing is installed.
//  2. The Mac's LoRA folder holds char_rustyfox_zimage.safetensors, the file
//     name a finished training leaves (mock option mlx.loras). Not real: no
//     such file exists, no run trained it; rustyfox is the example character
//     of the other character films.
//  3. mlx_generate does not come back (mock option imageGenerateWaits), so the
//     run stands at step 1. Not real: no picture is made.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-character', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'mac-character', 'Use a character on a Mac', {
    mode: 'local',
    tauri: {
      platform: 'mac',
      // Fixtures 1 to 3.
      mlx: {
        engineInstalled: true, mfluxEngineInstalled: true,
        installedImages: ['sd-turbo', 'z-image-turbo-4bit'],
        videoEngineInstalled: true, ltx2EngineInstalled: true, installedVideos: ['ltx-2.3-q4'],
        loras: [{ name: 'char_rustyfox_zimage.safetensors' }],
        imageGenerateWaits: true,
      },
    },
  })
  await rec.openCreate('Character Studio')
  await expect(page.getByRole('radio', { name: 'Use character' })).toBeVisible()
  await page.mouse.move(1000, 520)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('Use character lists the characters in the Mac\'s LoRA folder. A pick brings the Z Image model it was trained for.')
  await rec.click(page.getByRole('radio', { name: 'Use character' }), { dur: 0.6, settle: 900, after: 0.2 })
  const pick = page.getByTitle('Trigger word: rustyfox')
  await expect(pick).toBeVisible()
  await rec.click(pick, { dur: 0.6, settle: 800, after: 0.2 })
  await expect(page.getByTestId('character-use-hint')).toBeVisible()
  const zchip = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Z-Image/ })
  await expect(zchip).toBeVisible()
  await rec.cam({ x: 600, y: 850 }, 1.4, 0.8)
  await rec.move(zchip, { dur: 0.6, at: { dy: -26 }, real: false })
  rec.hold(1.4)

  rec.scene('On Video, the clip starts from a picture of the character made on the Mac.')
  await rec.cam('full', 1, 0.8)
  await rec.click(page.getByRole('radio', { name: 'Video', exact: true }), { dur: 0.8, settle: 900, after: 0.2 })
  const cnote = page.getByTestId('character-note')
  await expect(cnote).toContainText('First an image of rustyfox is made with Z Image, then the video starts from it.')
  await rec.cam({ x: 600, y: 800 }, 1.4, 0.8)
  await rec.move(cnote, { dur: 0.6, at: { dy: 22 }, real: false })
  rec.hold(0.7)
  const vprompt = page.locator('textarea').first()
  await rec.click(vprompt, { dur: 0.5, at: { fx: 0.15 }, after: 0.1 })
  await rec.move({ x: 935, y: 870 }, { dur: 0.3, real: false })
  await rec.type(vprompt, 'walks through autumn leaves', { cps: 30 })
  const create = page.getByRole('button', { name: 'Create', exact: true }).last()
  await expect(create).toBeEnabled()

  rec.scene('Create makes the character image first: Step 1 of 2.')
  await rec.click(create, { dur: 0.6, settle: 500, after: 0.1, until: () => expect(page.getByText(/^Step 1 of 2: character image/)).toBeVisible({ timeout: 20_000 }) })
  const step = page.getByText(/^Step 1 of 2: character image/).first()
  await rec.cam({ x: 600, y: 620 }, 1.3, 0.8)
  await rec.move(step, { dur: 0.5, at: { dy: 22 }, real: false })
  rec.hold(1.4)
  await rec.cam('full', 1, 0.9)
  rec.finish(1.0)
})
