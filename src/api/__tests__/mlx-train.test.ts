/**
 * Character training on the Mac (api/mlx-train.ts over commands/mlx_train.rs),
 * reached through the calls of api/trainer.ts that useCreate makes on every
 * system.
 *
 * The commands are mocked: what is held here is that a Mac sends its run to
 * the mlx_train commands and never to the Windows trainer, what the photos
 * travel as, and how a Mac progress reads in the Windows shape.
 *
 * Run: npx vitest run src/api/__tests__/mlx-train.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({
  mac: true,
  media: [] as { cmd: string; args?: Record<string, unknown> }[],
  backend: [] as { cmd: string; args?: Record<string, unknown> }[],
  progress: null as MacTrainProgress | Record<string, unknown> | null,
}))
vi.mock('../mlx-image', () => ({ isMlxImageHost: () => io.mac }))
vi.mock('../mlx-invoke', () => ({
  invokeMedia: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    io.media.push({ cmd, args })
    if (cmd === 'mlx_train_progress') return io.progress
    if (cmd === 'mlx_train_stage') return { staged: 'abc.png' }
    return { ok: true }
  }),
}))
vi.mock('../backend', async (orig) => ({
  ...(await orig<typeof import('../backend')>()),
  backendCall: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    io.backend.push({ cmd, args })
    return { status: 'started' }
  }),
}))

import { stageTrainingImage, clearTrainingSet, startCharacterTraining, characterTrainingStatus, cancelCharacterTraining } from '../trainer'
import { macTrainNote, macTrainRunStatus, type MacTrainProgress } from '../mlx-train'

const progress = (extra: Partial<MacTrainProgress>): MacTrainProgress => ({
  job: 'j', status: 'running', phase: 'Training', percent: 40, step: 120, steps: 400, trigger: 'luxfox',
  error: null, output: null, logs: [], running: true, ...extra,
})

beforeEach(() => {
  io.mac = true
  io.media.length = 0
  io.backend.length = 0
  io.progress = null
})

describe('a character run on a Mac', () => {
  it('goes to the mlx_train commands, with the photo as base64 and one run name', async () => {
    await clearTrainingSet('luxfox')
    await stageTrainingImage('luxfox', 'a.png', [137, 80, 78, 71], 'luxfox, a photo of luxfox')
    await startCharacterTraining('luxfox', 'luxfox', 'luxfox', 400)
    await cancelCharacterTraining()
    expect(io.backend).toHaveLength(0)
    expect(io.media.map((c) => c.cmd)).toEqual(['mlx_train_clear', 'mlx_train_stage', 'mlx_train_start', 'mlx_train_cancel'])
    expect(io.media[0].args).toEqual({ set: 'luxfox' })
    expect(io.media[1].args).toEqual({ set: 'luxfox', data: btoa('\x89PNG'), caption: 'luxfox, a photo of luxfox' })
    expect(io.media[2].args).toMatchObject({ set: 'luxfox', trigger: 'luxfox', steps: 400 })
    // Stop reaches the run that was started, by its name.
    expect(io.media[3].args?.run).toBe(io.media[2].args?.run)
  })

  it('reads its progress in the shape of the Windows trainer, with the reason of a failure as the phase', async () => {
    io.progress = progress({})
    expect(await characterTrainingStatus()).toEqual({ status: 'running', phase: 'Training', logs: [], step: 120, totalSteps: 400 })
    io.progress = progress({ status: 'error', running: false, error: 'The trainer was ended by macOS.' })
    expect((await characterTrainingStatus()).phase).toBe('The trainer was ended by macOS.')
    expect(macTrainRunStatus(progress({ status: 'complete', running: false })).status).toBe('complete')
  })

  it('encodes a large photo whole', async () => {
    const bytes = Array.from({ length: 100_000 }, (_, i) => i % 256)
    await stageTrainingImage('s', 'big.png', bytes, 'c')
    const data = String(io.media[0].args?.data)
    expect(atob(data).length).toBe(100_000)
    expect(atob(data).charCodeAt(99_999)).toBe(99_999 % 256)
  })

  it('says the adapter download only while the adapter is missing', () => {
    expect(macTrainNote('Quick, 400 steps', { adapterReady: false, adapterBytes: 340_194_488 })).toContain('downloads a 340 MB training adapter')
    expect(macTrainNote('Quick, 400 steps', { adapterReady: true, adapterBytes: 340_194_488 })).not.toContain('adapter')
  })
})

describe('off the Mac', () => {
  it('the same calls reach the Windows trainer and never the Mac one', async () => {
    io.mac = false
    await clearTrainingSet('luxfox')
    await stageTrainingImage('luxfox', 'a.png', [1, 2], 'c')
    await startCharacterTraining('luxfox', 'luxfox', 'luxfox', 400)
    await characterTrainingStatus()
    await cancelCharacterTraining()
    expect(io.media).toHaveLength(0)
    expect(io.backend.map((c) => c.cmd)).toEqual([
      'clear_training_set', 'stage_training_image', 'start_character_training', 'character_training_status', 'cancel_character_training',
    ])
    expect(io.backend[1].args).toEqual({ setId: 'luxfox', filename: 'a.png', fileBytes: [1, 2], caption: 'c' })
  })
})
