// @vitest-environment jsdom
/**
 * Music on the Mac (14.10.2026). The Music tab was a locked teaser
 * there: Windows makes a track as a ComfyUI graph, and a Mac has no ComfyUI.
 * The Mac now has a music engine of its own (ACE-Step 1.5, commands/music.rs),
 * and these cases hold what changes with it:
 *
 *   the tab is local on a Mac only while that engine is installed,
 *   without it the tab stays the teaser it was,
 *   the backend switch keeps Music where the Mac can run it,
 *   and the lane counts its one model like any other list.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/mac-music-lane.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({ mac: true }))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => io.mac, MLX_MODEL_PREFIX: 'MLX ' }))

import { isIntentAvailable, isIntentLocked, visibleIntents, INTENT_MAP } from '../intents'
import { laneModelCount, stageShowsSetupCard } from '../stageGate'
import { useCreateStore, deriveIntent } from '../../../../stores/createStore'
import { buildMacMusicModels, mlxMakesMusic, macMusicSeconds, MAC_MUSIC_MODEL_NAME } from '../../../../lib/mac-music'

const MUSIC = INTENT_MAP.music

beforeEach(() => {
  io.mac = true
  useCreateStore.setState({ backend: 'local', audioModelList: [], cloudOp: null, utilityOp: null } as never)
})

describe('the Music tab on a Mac', () => {
  it('is a local tab while the music engine is installed', () => {
    expect(isIntentLocked(MUSIC, 'local', true, false, false, false, true)).toBe(false)
    expect(isIntentAvailable('music', 'local', true, false, false, false, true)).toBe(true)
    expect(visibleIntents('local', true, false, false, false, false, true).map((m) => m.id)).toContain('music')
  })

  it('stays the locked teaser without it, as before', () => {
    expect(isIntentLocked(MUSIC, 'local', true)).toBe(true)
    expect(isIntentAvailable('music', 'local', true)).toBe(false)
    // With teasers switched off, a locked tab is not shown at all.
    expect(visibleIntents('local', true, false).map((m) => m.id)).not.toContain('music')
    expect(visibleIntents('local', true, true).map((m) => m.id)).toContain('music')
  })

  it('opens nothing else: Edit and Animate keep their own rule', () => {
    expect(isIntentAvailable('edit', 'local', true, false, false, false, true)).toBe(false)
    expect(isIntentAvailable('animate', 'local', true, false, false, false, true)).toBe(false)
    expect(isIntentAvailable('lipsync', 'local', true, false, false, false, true)).toBe(false)
  })

  it('NEGATIVE CONTROL: Windows and the other backend are untouched', () => {
    expect(isIntentLocked(MUSIC, 'local', false)).toBe(false)
    expect(isIntentLocked(MUSIC, 'cloud', true)).toBe(false)
    expect(isIntentAvailable('music', 'local', false)).toBe(true)
  })
})

describe('the lane list of a Mac', () => {
  it('holds the one model while the engine is installed, and reads it back', () => {
    const list = buildMacMusicModels({ installed: true })
    expect(list).toEqual([{ name: MAC_MUSIC_MODEL_NAME, type: 'ace', source: 'checkpoint' }])
    expect(mlxMakesMusic(list)).toBe(true)
    expect(buildMacMusicModels({ installed: false })).toEqual([])
    expect(buildMacMusicModels(null)).toEqual([])
    expect(mlxMakesMusic([])).toBe(false)
    // A ComfyUI audio checkpoint is not the Mac's engine.
    expect(mlxMakesMusic([{ name: 'ace_step_1.5_turbo_aio.safetensors' }])).toBe(false)
  })

  it('counts as the lane, and the Stage shows no ComfyUI setup card on a Mac', () => {
    const lists = { image: [], video: [], audio: buildMacMusicModels({ installed: true }), lipsync: [], motion: [] }
    expect(laneModelCount('music', MUSIC.requiresModels, lists)).toBe(1)
    for (const audio of [lists.audio, []]) {
      expect(stageShowsSetupCard({
        backend: 'local', requiresModels: MUSIC.requiresModels, mlxMissing: { image: false, video: false },
        connected: null, modelsLoaded: true, laneModelCount: audio.length,
      })).toBe(false)
    }
  })

  it('asks the engine for what it makes: ten seconds to four minutes', () => {
    expect(macMusicSeconds(5)).toBe(10)
    expect(macMusicSeconds(60)).toBe(60)
    expect(macMusicSeconds(59.6)).toBe(60)
    expect(macMusicSeconds(600)).toBe(240)
    expect(macMusicSeconds(Number.NaN)).toBe(120)
  })
})

describe('the backend switch on a Mac', () => {
  it('keeps Music when the Mac runs it', () => {
    useCreateStore.setState({ backend: 'cloud', audioModelList: buildMacMusicModels({ installed: true }) } as never)
    useCreateStore.getState().setIntent('music')
    useCreateStore.getState().setBackend('local')
    expect(deriveIntent(useCreateStore.getState())).toBe('music')
  })

  it('leaves Music for Image when it does not, as before', () => {
    useCreateStore.setState({ backend: 'cloud', audioModelList: [] } as never)
    useCreateStore.getState().setIntent('music')
    useCreateStore.getState().setBackend('local')
    expect(deriveIntent(useCreateStore.getState())).toBe('image')
  })
})
