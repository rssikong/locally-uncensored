// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('../mlx-invoke', () => ({ invokeMedia: (cmd: string, args?: unknown) => invoke(cmd, args) }))

import { buildMlxVideoModels, generateVideo, installVideoModel, deleteVideoModel, mlxTalking, mlxTalkingEntry, stageVoice, type VideoModel } from '../mlx-video'

const base: VideoModel = {
  id: 'ltx-2.3-q4', name: 'LTX-2.3 Distilled 4-bit', family: 'ltx_2q', repo: 'r', sizeGB: 20.5, sizeBytes: 20.5e9, minRamGB: 16,
  defaultFrames: 49, fps: 24, defaultWidth: 768, defaultHeight: 512, negativePrompt: false, userSampling: false,
  needsConvert: false, unfiltered: false, description: '', installed: true,
}

beforeEach(() => invoke.mockReset())

describe('Talking Character on a Mac', () => {
  it('a model that talks carries it into the Create list, ready or not', () => {
    const [ready] = buildMlxVideoModels([{ ...base, talking: true, talkingGB: 11.3, talkingReady: true }])
    expect(ready.mlxVideo?.talking).toBe('ready')
    expect(ready.mlxVideo?.talkingGB).toBe(11.3)
    const [missing] = buildMlxVideoModels([{ ...base, talking: true, talkingGB: 11.3, talkingReady: false }])
    expect(missing.mlxVideo?.talking).toBe('missing')
    const [quiet] = buildMlxVideoModels([{ ...base, id: 'wan', name: 'Wan', family: 'wan_2' }])
    expect(quiet.mlxVideo?.talking).toBeUndefined()
  })

  it('the tab is there with a model that talks, the run once its download is on disk', () => {
    const list = (talking?: 'ready' | 'missing') => [{ name: 'MLX A', mlxVideo: talking ? { talking } : {} }] as never
    expect(mlxTalking(list())).toEqual({ tab: false, ready: false })
    expect(mlxTalking(list('missing'))).toEqual({ tab: true, ready: false })
    expect(mlxTalking(list('ready'))).toEqual({ tab: true, ready: true })
    expect(mlxTalking([])).toEqual({ tab: false, ready: false })
  })

  it('the run takes a ready model that talks, the stored pick first', () => {
    const list = [
      { name: 'MLX Wan', mlxVideo: {} },
      { name: 'MLX Missing', mlxVideo: { talking: 'missing' } },
      { name: 'MLX Ready', mlxVideo: { talking: 'ready' } },
      { name: 'MLX Ready 2', mlxVideo: { talking: 'ready' } },
    ] as unknown as VideoModel[]
    expect(mlxTalkingEntry(list, 'MLX Wan')?.name).toBe('MLX Ready')
    expect(mlxTalkingEntry(list, 'MLX Ready 2')?.name).toBe('MLX Ready 2')
    expect(mlxTalkingEntry(list.slice(0, 2), 'MLX Wan')?.name).toBe('MLX Missing')
    expect(mlxTalkingEntry(list.slice(0, 1), 'MLX Wan')).toBeUndefined()
    expect(mlxTalkingEntry(null, '')).toBeUndefined()
  })

  it('the voice is staged as a file and the run names it, with no length of its own', async () => {
    invoke.mockResolvedValueOnce({ path: '/v/voices/a.wav' })
    expect(await stageVoice(new Blob([new Uint8Array([82, 73, 70, 70])]))).toBe('/v/voices/a.wav')
    expect(invoke).toHaveBeenLastCalledWith('video_stage_voice', { data: 'UklGRg==' })
    invoke.mockResolvedValueOnce({ ok: true })
    await generateVideo({ id: 'ltx-2.3-q4', prompt: 'p', initImage: '/i.png', audio: '/v/voices/a.wav' })
    const body = invoke.mock.calls.at(-1)?.[1] as Record<string, unknown>
    expect(body.audio).toBe('/v/voices/a.wav')
    expect(body.seconds).toBeUndefined()
    invoke.mockResolvedValueOnce({ ok: true })
    await generateVideo({ id: 'ltx-2.3-q4', prompt: 'p' })
    expect(invoke.mock.calls.at(-1)?.[1]).not.toHaveProperty('audio')
  })

  it('the download installs and goes as a part of the model', async () => {
    invoke.mockResolvedValue({ ok: true })
    await installVideoModel('ltx-2.3-q4', 'talking')
    expect(invoke).toHaveBeenLastCalledWith('video_install_model', { id: 'ltx-2.3-q4', part: 'talking' })
    await installVideoModel('ltx-2.3-q4')
    expect(invoke).toHaveBeenLastCalledWith('video_install_model', { id: 'ltx-2.3-q4' })
    await deleteVideoModel('ltx-2.3-q4', 'talking')
    expect(invoke).toHaveBeenLastCalledWith('video_delete_model', { id: 'ltx-2.3-q4', part: 'talking' })
  })
})
