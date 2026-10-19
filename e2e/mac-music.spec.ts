import { test, expect, type Page } from '@playwright/test'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from './support/tauri-mock'
import { routeCloud, seedOnboardingDone, cloudSwitch } from './support/cloud-mock'
import { mlxCalls, comfyCalls, requireCall } from './support/recorded'

/**
 * Music on a Mac: ACE-Step 1.5 as the Mac's own music engine
 * (src-tauri/src/commands/music.rs, src/api/mlx-music.ts).
 *
 * Until 14.10.2026 the Music tab was a locked teaser on every Mac. It is
 * still that on a Mac without the engine (mac-create-mlx.spec.ts holds it).
 * With the engine it is a local tab that hands the style, the lyrics, the
 * length and the seed to Rust and nothing else, and its result is a track in
 * the gallery. The Model Manager has a Music rail where the engine is got and
 * removed.
 */

const MAC: TauriMockOptions = { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'mac' }

async function boot(page: Page, opts: TauriMockOptions) {
  await page.addInitScript(tauriMockInit, opts)
  await seedOnboardingDone(page)
  await routeCloud(page, { license: 'active', access: true, mediaLive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
}

async function openCreate(page: Page) {
  await page.getByRole('button', { name: /^Create$/ }).click()
}

const lanes = (page: Page) => page.locator('aside:has(+ [data-testid="models-pane"])')
const tile = (page: Page, id: string) => page.locator(`[data-mac-media-tile="${id}"]`)

test('mac with the music engine: Music is a local tab and a track reaches the gallery', async ({ page }) => {
  await boot(page, { ...MAC, mlx: { musicInstalled: true } })
  await openCreate(page)

  const music = page.getByRole('radio', { name: 'Music', exact: true })
  await expect(music).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('radio', { name: 'Music, runs on LU Cloud' })).toHaveCount(0)
  await music.click()
  await expect(music).toBeChecked()

  // The engine's one model is on the chip. No steps slider: the turbo model
  // runs at its own eight steps.
  await expect(page.getByText('ACE-Step 1.5 Turbo').first()).toBeVisible()
  await expect(page.getByText('Quality (steps)')).toHaveCount(0)

  await page.locator('textarea').first().fill('slow jazz, smoky female vocals, upright bass')
  await page.getByRole('button', { name: 'Lyrics', exact: true }).click()
  await page.getByRole('textbox', { name: 'Lyrics' }).fill('[Verse]\nlate night in the city')
  await page.getByRole('button', { name: /^Create$/ }).last().click()

  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_music_generate').length, { timeout: 30_000 })
    .toBe(1)
  const gen = requireCall(await mlxCalls(page), 'mlx_music_generate')
  expect(gen.prompt).toBe('slow jazz, smoky female vocals, upright bass')
  expect(gen.raw.lyrics).toBe('[Verse]\nlate night in the city')
  expect(gen.seconds).toBeGreaterThanOrEqual(10)
  expect(gen.seconds).toBeLessThanOrEqual(240)
  expect(typeof gen.raw.run).toBe('string')
  // What the engine does not read does not go out.
  expect(gen.raw.steps).toBeUndefined()
  expect(gen.raw.negative_prompt).toBeUndefined()

  // The track is the result, and it plays from the WAV Rust wrote.
  await expect(page.locator('audio')).toHaveCount(1, { timeout: 20_000 })
  await expect.poll(async () => page.locator('audio').getAttribute('src')).toMatch(/^blob:/)
  await expect(page.getByText(/Generation failed/)).toHaveCount(0)
  expect(await comfyCalls(page)).toHaveLength(0)
})

test('mac with the music engine: Stop ends the track in Rust and is no error', async ({ page }) => {
  await boot(page, { ...MAC, mlx: { musicInstalled: true, musicPolls: 400 } })
  await openCreate(page)
  await page.getByRole('radio', { name: 'Music', exact: true }).click()
  await page.locator('textarea').first().fill('dreamy lofi hip hop')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_music_generate').length, { timeout: 30_000 })
    .toBe(1)
  // The guard in Composer ignores a Stop in the first 400 ms of a run.
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: /^(Stop|Cancel)$/ }).last().click()
  await expect
    .poll(async () => (await mlxCalls(page)).filter((c) => c.cmd === 'mlx_music_cancel').length, { timeout: 15_000 })
    .toBeGreaterThan(0)
  const calls = await mlxCalls(page)
  expect(requireCall(calls, 'mlx_music_cancel').raw.run).toBe(requireCall(calls, 'mlx_music_generate').raw.run)
  await expect(page.locator('audio')).toHaveCount(0)
  await expect(page.getByText(/Generation failed/)).toHaveCount(0)
})

test('mac with the music engine: a failed track says why', async ({ page }) => {
  await boot(page, { ...MAC, mlx: { musicInstalled: true, musicError: 'The music engine was ended by macOS. This usually means the model did not fit into memory.' } })
  await openCreate(page)
  await page.getByRole('radio', { name: 'Music', exact: true }).click()
  await page.locator('textarea').first().fill('epic orchestral trailer')
  await page.getByRole('button', { name: /^Create$/ }).last().click()
  await expect(page.getByText(/did not fit into memory/)).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('audio')).toHaveCount(0)
})

test('mac Model Manager: the Music rail gets the engine, and Create then has the Music tab', async ({ page }) => {
  await boot(page, MAC)
  // Without the engine the tab is the teaser it always was.
  await openCreate(page)
  await expect(page.getByRole('radio', { name: 'Music, runs on LU Cloud' })).toBeVisible({ timeout: 15_000 })

  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await lanes(page).getByRole('button', { name: /^Music/ }).click()
  const lane = page.getByTestId('mac-media-music')
  await expect(lane).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Music models' })).toBeVisible()
  // One model: no catalogue switch, no memory buckets, no engine card.
  await expect(lane.getByRole('group', { name: 'Catalogue' })).toHaveCount(0)
  await expect(lane.locator('[data-engine-state]')).toHaveCount(0)
  await expect(lane).toContainText('music engine')

  const ace = tile(page, 'acestep-v15-turbo')
  await expect(ace).toHaveAttribute('data-state', 'idle')
  await ace.getByRole('button', { name: /^Get/ }).click()
  await expect(ace).toHaveAttribute('data-state', 'installed', { timeout: 30_000 })
  expect((await mlxCalls(page)).filter((c) => c.cmd === 'mlx_music_install')).toHaveLength(1)
  await expect(lanes(page).getByRole('button', { name: /^Music/ })).toContainText('1')

  await openCreate(page)
  await expect(page.getByRole('radio', { name: 'Music', exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('radio', { name: 'Music, runs on LU Cloud' })).toHaveCount(0)

  // Remove takes it out again, and the tab is the teaser once more.
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await lanes(page).getByRole('button', { name: /^Music/ }).click()
  await tile(page, 'acestep-v15-turbo').getByRole('button', { name: 'Remove ACE-Step 1.5 Turbo' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
  await expect(tile(page, 'acestep-v15-turbo')).toHaveAttribute('data-state', 'idle', { timeout: 15_000 })
  expect((await mlxCalls(page)).filter((c) => c.cmd === 'mlx_music_delete')).toHaveLength(1)
  await openCreate(page)
  await expect(page.getByRole('radio', { name: 'Music, runs on LU Cloud' })).toBeVisible({ timeout: 15_000 })
})

test('windows keeps its Music lane and has no Music rail of the Mac', async ({ page }) => {
  await boot(page, { ...MAC, platform: 'windows' })
  await page.getByRole('banner').getByRole('button', { name: 'Models', exact: true }).click()
  await expect(lanes(page).getByRole('button', { name: /^Image/ })).toBeVisible()
  await expect(lanes(page).getByRole('button', { name: /^Music/ })).toHaveCount(0)
  expect((await mlxCalls(page)).filter((c) => c.cmd.startsWith('mlx_music'))).toHaveLength(0)
})
