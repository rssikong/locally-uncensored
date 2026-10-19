import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Music on a Mac (3.0.7). Recorded on integ/307 (0a62b652d) with platform
// 'mac' in Local mode. Facts, all from that head:
//  - components/models/ModelManager.tsx:66 to 69 and 293 (MUSIC_RAIL): on a Mac
//    the Model Manager has a Music rail of its own.
//  - src-tauri/src/commands/music.rs:134 to 147 and 493: the one model,
//    "ACE-Step 1.5 Turbo", WEIGHTS_BYTES 10_092_093_389 (the tile shows it in
//    GiB, 9.4 GB; the changelog says about 10 GB), MIN_RAM_GB 16.
//    MacMediaLane.tsx:312: Get also sets up the music engine on the way
//    (MAC_MUSIC_ENGINE_SIZE, about 3 GB, lib/mac-setup-sizes.ts:30).
//  - components/create/experimental/intents.ts:239 to 246 (runsOnMlx): the
//    Music tab is a local tab on a Mac while the engine and its model are
//    installed (lib/mac-music.ts mlxMakesMusic); without them it stays
//    locked (IntentBar.tsx:118 to 133: a locked pill opens the LU Cloud
//    sheet, not the Model Manager, so the film starts in the Model Manager).
//  - music.rs:154 and 155 (MIN_SECONDS 10, MAX_SECONDS 240) and
//    SpecialIntentControls.tsx:1118 to 1120: the Length slider runs from
//    0:10 to 4:00 on a Mac, in steps of 5 seconds (music-ui.ts:79).
//  - ParamGroups.tsx:130 to 136 and 314: on a Mac the advanced settings of
//    Music hold the Seed and no steps or CFG (the turbo model runs its own
//    eight steps, music.rs:150).
//  - hooks/useCreate.ts:1341 to 1380: a run takes style (the prompt), lyrics,
//    length and seed (runMacMusic) and puts the track in the gallery as
//    "ACE-Step 1.5 Turbo" with the seed the engine used.
//  - SpecialIntentControls.tsx:1215 and 1216: the Lyrics box and its
//    placeholder about [Verse] and [Chorus].
//
// Fixtures (nothing on the page is altered):
//  1. tauri platform 'mac', image engine set up, music engine not installed.
//     Not real: nothing is installed on a real Mac.
//  2. The Get on the ACE-Step tile runs the mock's install (two polls, then
//     installed). Not real: nothing is downloaded.
//  3. The run is the mock's (one poll, then complete). initScript wraps
//     __TAURI_INTERNALS__.invoke: read_media_file answers a WAV of silence
//     as long as the run asked for (the rig answers a tenth of a second, which
//     the player shows as 0:00). Not real: ACE-Step made no track, and the
//     film plays nothing.
//  4. Style, lyrics and the seed 42 are example values typed in the film.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

test('mac-music', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  const rec = await Rec.boot(page, 'mac-music', 'Music on a Mac', {
    mode: 'local',
    // Fixtures 1 and 2.
    tauri: { platform: 'mac', mlx: { engineInstalled: true, musicInstalled: false } },
    // Fixture 3.
    initScript: () => {
      const bridge = (window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> } }).__TAURI_INTERNALS__
      const invoke = bridge.invoke
      let seconds = 60
      const silence = (secs: number) => {
        const rate = 8000
        const samples = rate * secs
        const bytes = new Uint8Array(44 + samples * 2)
        const view = new DataView(bytes.buffer)
        const text = (at: number, word: string) => { for (let i = 0; i < 4; i++) bytes[at + i] = word.charCodeAt(i) }
        text(0, 'RIFF'); view.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE')
        text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
        text(36, 'data'); view.setUint32(40, samples * 2, true)
        let binary = ''
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192))
        return btoa(binary)
      }
      bridge.invoke = (cmd, args) => {
        const a = args as { args?: { seconds?: number }; path?: string } | undefined
        if (cmd === 'mlx_music_generate' && typeof a?.args?.seconds === 'number') seconds = a.args.seconds
        if (cmd === 'read_media_file' && String(a?.path ?? '').endsWith('.wav')) return Promise.resolve(silence(seconds))
        return invoke(cmd, args)
      }
    },
  })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await page.locator('aside:has(+ [data-testid="models-pane"])').getByRole('button', { name: /^Music/ }).click()
  const tile = page.locator('[data-mac-media-tile="acestep-v15-turbo"]')
  await expect(tile).toBeVisible({ timeout: 15_000 })
  await page.mouse.move(900, 700)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On a Mac, Music runs ACE-Step 1.5: get it under Models, Music.')
  await rec.cam(tile, 1.5)
  await rec.move(tile.getByText('needs 16 GB memory'), { dur: 0.6, at: { dy: 22 } })
  rec.hold(0.5)
  await rec.click(tile.getByRole('button', { name: 'Get', exact: true }), {
    dur: 0.6, settle: 500, after: 0.3,
    until: () => expect(tile).toHaveAttribute('data-state', 'installed', { timeout: 20_000 }),
  })
  rec.hold(0.3)

  rec.scene('Then Music in Create is a local tab. The prompt sets the style, Lyrics takes your words.')
  await rec.cam('full', 1, 0.8)
  const music = page.getByRole('radio', { name: 'Music', exact: true })
  await rec.click(page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }), {
    dur: 0.6, settle: 900, after: 0.1,
    until: () => expect(music).toBeVisible({ timeout: 15_000 }),
  })
  const notice = page.getByText('Do not show again')
  if (await notice.isVisible().catch(() => false)) await notice.click()
  await rec.click(music, { dur: 0.5, settle: 700, after: 0.1 })
  await expect(music).toBeChecked()
  const prompt = page.locator('textarea').first()
  await rec.click(prompt, { dur: 0.5, at: { fx: 0.15 }, settle: 200, after: 0 })
  await rec.type(prompt, 'slow jazz, upright bass', { per: 2, cps: 40 })
  await rec.click(page.getByRole('button', { name: 'Lyrics', exact: true }), { dur: 0.45, settle: 500, after: 0 })
  const lyrics = page.getByRole('textbox', { name: 'Lyrics' })
  await rec.click(lyrics, { dur: 0.35, at: { fx: 0.12 }, settle: 200, after: 0 })
  await rec.type(lyrics, '[Verse]\nRain on the harbor', { per: 2, cps: 40 })

  rec.scene('Length runs from 10 seconds to 4 minutes, and the seed sits in the advanced settings.')
  const lengthBox = page.locator('input[type="range"]').first()
  const lb = (await lengthBox.boundingBox())!
  const atLen = (s: number) => ({ x: Math.round(lb.x + 7 + (lb.width - 14) * ((s - 10) / 230)), y: Math.round(lb.y + lb.height / 2) })
  await rec.cam(atLen(40), 1.4, 0.7)
  const size = page.viewportSize()!
  const band = { x: 0, y: Math.round(lb.y - 60), w: size.width, h: Math.round(lb.height + 80) }
  const pts = [] as { x: number; y: number }[]
  for (let i = 0; i <= 8; i++) {
    const s = 60 - (30 * i) / 8
    pts.push(atLen(s))
  }
  await rec.drag(pts, band, { stepDur: 0.06 })
  await expect(page.getByText('0:30', { exact: true })).toBeVisible()
  await rec.cam('full', 1, 0.6)
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.5, settle: 800, after: 0 })
  const seedLabel = page.getByText('Seed (−1 = random)', { exact: true })
  await expect(seedLabel).toBeVisible()
  const seed = seedLabel.locator('xpath=following-sibling::*[1]').locator('input').first()
  await rec.cam(seed, 1.6, 0.6)
  await rec.click(seed, { dur: 0.4, settle: 200, after: 0 })
  await seed.selectText()
  await rec.type(seed, '42', { per: 1, cps: 6, band: { up: 60, down: 60 } })
  rec.hold(0.5)
  await rec.cam('full', 1, 0.5)
  await rec.click(page.getByRole('button', { name: 'Close' }).last(), { dur: 0.4, settle: 600, after: 0 })

  rec.scene('Create makes the track on this Mac, and it lands in the gallery.')
  await rec.click(page.getByRole('button', { name: /^Create$/ }).last(), {
    dur: 0.7, settle: 900, after: 0.2,
    until: () => expect(page.getByText(/0:00 \/ 0:30/).first().or(page.getByText('Prompt and settings', { exact: true }).first())).toBeVisible({ timeout: 20_000 }),
  })
  await rec.click(page.getByRole('button', { name: 'Open the gallery' }), { dur: 0.6, settle: 900, after: 0.1 })
  const tileInGallery = page.locator('aside, [role="complementary"]').getByText(/slow jazz/i).first()
  await rec.cam(tileInGallery, 1.4, 0.8)
  await rec.move(tileInGallery, { dur: 0.6, at: { dy: 26 } })
  rec.hold(0.9)
  await rec.cam('full', 1, 0.8)
  rec.finish(0.6)
})
