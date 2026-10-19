/**
 * The Character Studio panel picks a running base-file download back up when
 * it is mounted again (Phase G finding, 2026-09-06). Pins the predicate and the
 * mount hook.
 *
 * Run: npx vitest run src/api/__tests__/base-download-running.test.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { baseDownloadRunning, baseDownloadPercent, missingTrainerBases, missingBasesLine, aboutSize, TRAINER_BASE_FILES } from '../trainer'

describe('baseDownloadRunning', () => {
  it('is true while any base file downloads or connects', () => {
    for (const f of TRAINER_BASE_FILES) {
      expect(baseDownloadRunning({ [f.filename]: { status: 'downloading' } })).toBe(true)
      expect(baseDownloadRunning({ [f.filename]: { status: 'connecting' } })).toBe(true)
    }
  })

  it('is false when the base files are done, failed, absent, or another file downloads', () => {
    const [a, b, c] = TRAINER_BASE_FILES.map((f) => f.filename)
    expect(baseDownloadRunning({})).toBe(false)
    expect(baseDownloadRunning({ [a]: { status: 'complete' }, [b]: { status: 'error' }, [c]: undefined })).toBe(false)
    expect(baseDownloadRunning({ 'some-other-model.gguf': { status: 'downloading' } })).toBe(false)
  })

  it('is asked by the panel on mount, before the button decides what it says', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'create', 'experimental', 'SpecialIntentControls.tsx'), 'utf8')
    const mount = src.indexOf('if (live && baseDownloadRunning(prog)) setBusy(\'bases\')')
    const button = src.indexOf("'Download base files'")
    expect(mount).toBeGreaterThan(0)
    expect(button).toBeGreaterThan(mount)
  })
})

describe('baseDownloadPercent', () => {
  const [dit, enc, vae] = TRAINER_BASE_FILES.map((f) => f.filename)

  it('sums all three files, finished ones included, like the tray does', () => {
    // 0.335 GB done, 4 of 8 GB, 1.2 of 12 GB: 5.535 of 20.335 GB is 27 percent.
    const pct = baseDownloadPercent({
      [vae]: { status: 'complete', progress: 335, total: 335 },
      [enc]: { status: 'downloading', progress: 4000, total: 8000 },
      [dit]: { status: 'downloading', progress: 1200, total: 12000 },
    })
    expect(pct).toBe(27)
  })

  it('is null when nothing moves, and 0 while the sizes are still unknown', () => {
    expect(baseDownloadPercent({})).toBeNull()
    expect(baseDownloadPercent({ [vae]: { status: 'complete', progress: 335, total: 335 } })).toBeNull()
    expect(baseDownloadPercent({ [dit]: { status: 'connecting', progress: 0, total: 0 } })).toBe(0)
  })

  it('never runs past 100', () => {
    expect(baseDownloadPercent({ [dit]: { status: 'downloading', progress: 999, total: 100 } })).toBe(100)
  })

  it('feeds the note under the button', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'components', 'create', 'experimental', 'SpecialIntentControls.tsx'), 'utf8')
    expect(src).toContain('const pct = baseDownloadPercent(prog, fetching.length ? fetching.map((f) => f.filename) : undefined)')
    expect(src).toContain('Downloading base files (${pct}% of ${size})...')
    expect(src).not.toContain('about 19 GB')
  })

  it('counts only the files being fetched when told which', () => {
    // Box run: qwen_3_4b and ae were already there, only z_image_bf16 loaded.
    // A finished ae row from earlier must not pad the percent.
    const pct = baseDownloadPercent({
      [vae]: { status: 'complete', progress: 335, total: 335 },
      [dit]: { status: 'downloading', progress: 1200, total: 12000 },
    }, [dit])
    expect(pct).toBe(10)
  })
})

describe('missing base files are named and sized', () => {
  const none = { dit: null, textEncoder: null, vae: null }
  const all = { dit: '/m/z.safetensors', textEncoder: '/m/q.safetensors', vae: '/m/ae.safetensors' }

  it('takes the backend list when it sends one', () => {
    const only = missingTrainerBases({ ...all, dit: null, missingBases: [{ filename: 'z_image_bf16.safetensors', bytes: 12_309_866_400 }] })
    expect(only.map((f) => f.filename)).toEqual(['z_image_bf16.safetensors'])
    expect(missingTrainerBases({ ...all, missingBases: [] })).toEqual([])
  })

  it('falls back to the resolved paths for an older backend', () => {
    expect(missingTrainerBases(none)).toHaveLength(3)
    expect(missingTrainerBases({ ...all, dit: null }).map((f) => f.filename)).toEqual(['z_image_bf16.safetensors'])
    expect(missingTrainerBases(all)).toEqual([])
  })

  it('says the size of what is missing, not always 19 GB', () => {
    expect(missingBasesLine(TRAINER_BASE_FILES)).toBe('Z Image training base files are missing (about 19 GB, one time).')
    expect(missingBasesLine(missingTrainerBases({ ...all, dit: null }))).toBe('Missing for Z Image training: Z Image base model (about 11 GB, one time).')
    expect(missingBasesLine(missingTrainerBases({ ...all, textEncoder: null, vae: null }))).toBe('Missing for Z Image training: Text encoder, VAE (about 7.8 GB, one time).')
    expect(missingBasesLine(missingTrainerBases({ ...all, vae: null }))).toBe('Missing for Z Image training: VAE (about 320 MB, one time).')
  })

  it('rounds sizes the way the rest of the app quotes them', () => {
    expect(aboutSize(12_309_866_400)).toBe('about 11 GB')
    expect(aboutSize(8_044_982_048)).toBe('about 7.5 GB')
    expect(aboutSize(335_304_388)).toBe('about 320 MB')
  })
})
