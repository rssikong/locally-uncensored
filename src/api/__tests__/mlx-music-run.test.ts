/**
 * One track of the Mac's music engine, as Create waits for it
 * (api/mlx-music.ts runMacMusic over commands/music.rs).
 *
 * The commands are mocked: what is held here is what goes to Rust, how the
 * polls are read, and that a Stop reaches the run it was meant for.
 *
 * Run: npx vitest run src/api/__tests__/mlx-music-run.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const rust = vi.hoisted(() => ({
  calls: [] as { cmd: string; args?: Record<string, unknown> }[],
  polls: [] as Record<string, unknown>[],
}))
vi.mock('../mlx-invoke', () => ({
  invokeMedia: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    rust.calls.push({ cmd, args })
    if (cmd === 'mlx_music_generate') {
      return { ok: true, jobId: 'j1', pid: 7, output: '/c/music/music-j1.wav', seconds: args?.seconds, seed: 4242, steps: 8 }
    }
    if (cmd === 'mlx_music_progress') return rust.polls.shift() ?? { job: 'j1', status: 'running', phase: 'Making the track', detail: '', percent: 50, step: 4, steps: 8, error: null }
    if (cmd === 'mlx_music_cancel') return { ok: true, stopped: true }
    throw new Error(`unexpected ${cmd}`)
  }),
}))
vi.mock('../mlx-video', () => ({ readMediaAsBlobUrl: vi.fn(async (path: string, type: string) => `blob:${type}:${path}`) }))

import { runMacMusic, musicRunLine, musicCatalogModel, MusicRunCancelled } from '../mlx-music'

const poll = (status: string, extra: Record<string, unknown> = {}) =>
  ({ job: 'j1', status, phase: 'Making the track', detail: '', percent: 60, step: 6, steps: 8, error: null, ...extra })

beforeEach(() => {
  vi.useFakeTimers()
  rust.calls.length = 0
  rust.polls.length = 0
})
afterEach(() => {
  vi.useRealTimers()
})

/** Run the polls out. The outcome is caught before the clock moves, so a
 *  run that fails early is not an unhandled rejection meanwhile. */
async function settle<T>(p: Promise<T>): Promise<T> {
  const out = p.then((value) => ({ value }), (error: unknown) => ({ error }))
  for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(1500)
  const r = await out
  if ('error' in r) throw r.error
  return r.value
}

describe('a track', () => {
  it('sends style, lyrics, length, seed and its own run name, and reads the WAV back as audio', async () => {
    rust.polls.push(poll('running'), poll('complete', { percent: 100 }))
    const seen: [number, string][] = []
    const track = await settle(runMacMusic(
      { prompt: 'slow jazz', lyrics: 'la la', seconds: 60, seed: 7 },
      { onProgress: (p, t) => seen.push([p, t]) },
    ))
    const start = rust.calls.find((c) => c.cmd === 'mlx_music_generate')!
    expect(start.args).toMatchObject({ prompt: 'slow jazz', lyrics: 'la la', seconds: 60, seed: 7 })
    expect(String(start.args?.run)).toMatch(/^music-/)
    // Nothing else of Create's goes along.
    expect(Object.keys(start.args ?? {}).sort()).toEqual(['lyrics', 'prompt', 'run', 'seconds', 'seed'])
    expect(track).toMatchObject({ url: 'blob:audio/wav:/c/music/music-j1.wav', output: '/c/music/music-j1.wav', seed: 4242, steps: 8, seconds: 60 })
    expect(seen[0][1]).toMatch(/^Making the track, step 6 of 8 \(\d+s\)$/)
    // The bar stops short of the end until the gallery has the track.
    expect(seen.every(([p]) => p <= 99)).toBe(true)
  })

  it('a poll of the run before this one is not this one', async () => {
    rust.polls.push(poll('complete', { job: 'older' }), poll('complete'))
    const track = await settle(runMacMusic({ prompt: 'x' }, {}))
    expect(track.output).toBe('/c/music/music-j1.wav')
    expect(rust.calls.filter((c) => c.cmd === 'mlx_music_progress')).toHaveLength(2)
  })

  it('says why it failed', async () => {
    rust.polls.push(poll('error', { error: 'The music engine stopped: out of memory' }))
    await expect(settle(runMacMusic({ prompt: 'x' }, {}))).rejects.toThrow('The music engine stopped: out of memory')
  })

  it('a Stop ends this run in Rust, by its name, and is not an error', async () => {
    const stop = new AbortController()
    const run = runMacMusic({ prompt: 'x' }, { signal: stop.signal })
    const caught = run.catch((e) => e)
    await vi.advanceTimersByTimeAsync(1500)
    stop.abort()
    await vi.advanceTimersByTimeAsync(10)
    const e = await caught
    expect(e).toBeInstanceOf(MusicRunCancelled)
    const name = rust.calls.find((c) => c.cmd === 'mlx_music_generate')!.args?.run
    expect(rust.calls.filter((c) => c.cmd === 'mlx_music_cancel').map((c) => c.args)).toEqual([{ run: name }])
  })

  it('a run Rust reports as cancelled is a Stop too', async () => {
    rust.polls.push(poll('cancelled', { error: 'cancelled' }))
    await expect(settle(runMacMusic({ prompt: 'x' }, {}))).rejects.toBeInstanceOf(MusicRunCancelled)
  })
})

describe('the words and the tile', () => {
  it('names the phase, and the step once the engine counts them', () => {
    expect(musicRunLine({ phase: 'Loading the music model', detail: '', step: 0, steps: 0 }, 4)).toBe('Loading the music model (4s)')
    expect(musicRunLine({ phase: 'Making the track', detail: 'Phase 2: Generating audio codes', step: 0, steps: 0 }, 9))
      .toBe('Making the track: Phase 2: Generating audio codes (9s)')
    expect(musicRunLine({ phase: 'Making the track', detail: 'x', step: 3, steps: 8 }, 20)).toBe('Making the track, step 3 of 8 (20s)')
  })

  it('the tile carries the size in bytes, from the decimal GB of the catalogue', () => {
    const tile = musicCatalogModel({ id: 'acestep-v15-turbo', name: 'ACE-Step 1.5 Turbo', repo: 'ACE-Step/Ace-Step1.5', sizeGB: 10.1, minRamGB: 16, unfiltered: false, description: 'd', installed: false })
    expect(tile).toEqual({ id: 'acestep-v15-turbo', name: 'ACE-Step 1.5 Turbo', repo: 'ACE-Step/Ace-Step1.5', sizeBytes: 10_100_000_000, minRamGB: 16, unfiltered: false, description: 'd', installed: false })
  })
})
