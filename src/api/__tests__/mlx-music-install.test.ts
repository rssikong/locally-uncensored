// @vitest-environment jsdom
/**
 * Get, Stop and Remove of the Mac's music engine (commands/music.rs).
 *
 * The engine and its one model install in one slot, so a Get shows one row
 * and never a second one for an engine, a Stop ends that slot, and the Model
 * Manager reads the model from `mlx_music_status`.
 *
 * Run: npx vitest run src/api/__tests__/mlx-music-install.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, renderHook } from '@testing-library/react'

type Reply = unknown | ((args: unknown) => unknown)
let replies: Record<string, Reply> = {}
const calls: string[] = []

vi.mock('../backend', () => ({
  backendCall: async (cmd: string, payload?: { args?: unknown }) => {
    calls.push(cmd)
    if (!(cmd in replies)) throw new Error(`unexpected command: ${cmd}`)
    const reply = replies[cmd]
    return typeof reply === 'function' ? (reply as (a: unknown) => unknown)(payload?.args) : reply
  },
  isTauri: () => true,
  isMacOS: () => true,
}))

import { installMlxModel } from '../mlx-install'
import { useMlxInstallStore, resetMlxInstallStoreForTest } from '../../stores/mlxInstallStore'
import { useMlxMedia, forgetMlxMediaForTest } from '../../hooks/useMlxMedia'

const idle = { status: 'idle', logs: [], error: null, download_progress: 0, download_total: 0, download_speed: 0 }
const installing = { ...idle, status: 'installing', download_progress: 5e9, download_total: 1.01e10 }
const complete = { ...idle, status: 'complete' }
const entries = () => useMlxInstallStore.getState().entries
const ACE = { id: 'acestep-v15-turbo', name: 'ACE-Step 1.5 Turbo' }
const sent = (cmd: string) => calls.filter((c) => c === cmd).length

const status = (installed: boolean) => ({
  available: true, appleSilicon: true, engineInstalled: installed, engineVersion: installed ? '1.5.0' : null,
  engineCommit: 'c', installed, running: false, outputsRoot: '/c/music',
  model: { ...ACE, repo: 'ACE-Step/Ace-Step1.5', sizeGB: 10.1, minRamGB: 16, unfiltered: false, description: 'd', installed },
})

beforeEach(() => {
  vi.useFakeTimers()
  replies = {
    mlx_music_status: status(false),
    mlx_music_install: { ok: true, status: 'installing', id: ACE.id },
    mlx_music_install_status: installing,
    mlx_music_cancel_install: { ok: true, cancelled: true },
  }
  calls.length = 0
  resetMlxInstallStoreForTest()
  forgetMlxMediaForTest()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Get on the music engine', () => {
  it('shows one row with the click, starts the one install and follows it to its end', async () => {
    const run = installMlxModel('music', ACE)
    run.catch(() => {})
    expect(entries()['music-model']).toMatchObject({ status: 'installing', modelId: ACE.id, pending: true })
    expect(Object.keys(entries())).toEqual(['music-model'])
    await vi.advanceTimersByTimeAsync(1600)
    expect(sent('mlx_music_install')).toBe(1)
    replies.mlx_music_install_status = complete
    await vi.advanceTimersByTimeAsync(3200)
    await run
    expect(entries()['music-model']?.status).toBe('complete')
    // There is no engine setup of its own to call.
    expect(calls.some((c) => c.startsWith('video_') || c === 'install_mlx_diffusion')).toBe(false)
  })

  it('refuses on a Mac without Apple Silicon before anything starts', async () => {
    replies.mlx_music_status = { ...status(false), appleSilicon: false }
    await expect(installMlxModel('music', ACE)).rejects.toThrow(/Apple Silicon/)
    expect(sent('mlx_music_install')).toBe(0)
    expect(entries()['music-model']).toBeUndefined()
  })

  it('Stop ends the music slot and the row is gone with the click', async () => {
    const run = installMlxModel('music', ACE)
    run.catch(() => {})
    await vi.advanceTimersByTimeAsync(1600)
    const stop = useMlxInstallStore.getState().stop('music')
    expect(entries()['music-model']).toBeUndefined()
    replies.mlx_music_install_status = idle
    await vi.advanceTimersByTimeAsync(500)
    await stop
    expect(sent('mlx_music_cancel_install')).toBe(1)
    expect(sent('video_cancel_model_install')).toBe(0)
  })
})

describe('the music lane of the Model Manager', () => {
  it('lists the one model from the engine status, with no engine card to set up', async () => {
    replies = { ...replies, mlx_status: { installed: true }, mlx_image_models: [], video_status: null, video_list_models: [] }
    replies.mlx_music_status = status(true)
    const { result } = renderHook(() => useMlxMedia(true))
    await act(async () => { await result.current.refresh() })
    expect(result.current.music.models).toEqual([
      expect.objectContaining({ id: ACE.id, name: ACE.name, installed: true, sizeBytes: 10_100_000_000, minRamGB: 16 }),
    ])
    expect(result.current.music.engineReady).toBe(true)
    expect(result.current.music.unsupported).toBeNull()
  })

  it('Remove asks Rust to delete the weights', async () => {
    replies = { ...replies, mlx_status: { installed: true }, mlx_image_models: [], video_status: null, video_list_models: [], mlx_music_delete: { ok: true, id: ACE.id } }
    replies.mlx_music_status = status(true)
    const { result } = renderHook(() => useMlxMedia(true))
    await act(async () => { await result.current.refresh() })
    replies.mlx_music_status = status(false)
    await act(async () => { await result.current.remove('music', ACE.id) })
    expect(sent('mlx_music_delete')).toBe(1)
    expect(result.current.music.models[0].installed).toBe(false)
  })
})
