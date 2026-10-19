// @vitest-environment jsdom
/**
 * Motion Control on the Mac (3.0.8). Windows runs the tab as a ComfyUI graph
 * (Wan VACE or Animate), and a Mac has no ComfyUI. The Mac now runs it on an
 * LTX-2.3 pack of the second video engine with the IC-LoRA Union Control
 * (commands/video_motion.rs). These cases hold what changes with it:
 *
 *   the tab is local on a Mac while such a pack is installed,
 *   without one it stays the teaser it was,
 *   the lane's list is empty until the LoRA is there, and the Stage then
 *     offers the LoRA as its install card,
 *   the backend switch keeps the tab where the Mac can run it,
 *   the character chip shows on the tab only while the lane can run.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/mac-motion-lane.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const io = vi.hoisted(() => ({ mac: true }))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => io.mac, MLX_MODEL_PREFIX: 'MLX ' }))

import { isIntentAvailable, isIntentLocked, visibleIntents, INTENT_MAP } from '../intents'
import { laneModelCount, stageShowsSetupCard } from '../stageGate'
import { characterChipShown } from '../CharacterChip'
import { useCreateStore, deriveIntent } from '../../../../stores/createStore'
import { buildMlxMotionModels, buildMlxVideoModels, mlxFollowsMotion, type VideoModel } from '../../../../api/mlx-video'

const MOTION = INTENT_MAP.motion

function entry(id: string, motion: boolean): VideoModel {
  return {
    id, name: id, family: 'ltx_2q', repo: '', sizeGB: 20.5, sizeBytes: 0, minRamGB: 16, defaultFrames: 49, fps: 24,
    defaultWidth: 768, defaultHeight: 512, negativePrompt: false, userSampling: false, needsConvert: false,
    unfiltered: false, acceptsImage: true, motion, description: '', installed: true,
  }
}

const LTX23 = buildMlxVideoModels([entry('ltx-2.3-q4', true)])
const LTX25 = buildMlxVideoModels([entry('ltx-2.5-q4', false)])

beforeEach(() => {
  io.mac = true
  useCreateStore.setState({ backend: 'local', videoModelList: [], motionModelList: [], cloudOp: null, utilityOp: null } as never)
})

describe('the Motion Control tab on a Mac', () => {
  it('is a local tab while a pack that follows a motion video is installed', () => {
    expect(mlxFollowsMotion(LTX23)).toBe(true)
    expect(isIntentLocked(MOTION, 'local', true, false, false, false, false, true)).toBe(false)
    expect(isIntentAvailable('motion', 'local', true, false, false, false, false, true)).toBe(true)
    expect(visibleIntents('local', true, false, false, false, false, false, true).map((m) => m.id)).toContain('motion')
  })

  it('stays the locked teaser without one, as before, and LTX-2.5 is not one', () => {
    expect(mlxFollowsMotion(LTX25)).toBe(false)
    expect(isIntentLocked(MOTION, 'local', true)).toBe(true)
    expect(isIntentAvailable('motion', 'local', true)).toBe(false)
    expect(visibleIntents('local', true, false).map((m) => m.id)).not.toContain('motion')
  })

  it('opens nothing else', () => {
    for (const id of ['lipsync', 'music', 'animate', 'edit'] as const) {
      expect(isIntentAvailable(id, 'local', true, false, false, false, false, true)).toBe(false)
    }
  })

  it('NEGATIVE CONTROL: Windows and the cloud are untouched', () => {
    expect(isIntentLocked(MOTION, 'local', false)).toBe(false)
    expect(isIntentLocked(MOTION, 'cloud', true)).toBe(false)
    expect(isIntentAvailable('motion', 'local', false)).toBe(true)
  })
})

describe('the lane list and the install card', () => {
  it('holds the packs once the LoRA is installed, and none before', () => {
    expect(buildMlxMotionModels(LTX23, true).map((m) => m.name)).toEqual(['MLX ltx-2.3-q4'])
    expect(buildMlxMotionModels(LTX23, false)).toEqual([])
    expect(buildMlxMotionModels([...LTX23, ...LTX25], true)).toHaveLength(1)
  })

  it('shows the install card on a Mac while the list is empty, and not once it is filled', () => {
    const gate = (motion: unknown[]) => stageShowsSetupCard({
      backend: 'local', requiresModels: MOTION.requiresModels, mlxMissing: { image: false, video: false },
      connected: null, modelsLoaded: true,
      laneModelCount: laneModelCount('motion', MOTION.requiresModels, { image: [], video: LTX23, audio: [], lipsync: [], motion }),
    })
    expect(gate([])).toBe(true)
    expect(gate(buildMlxMotionModels(LTX23, true))).toBe(false)
    // Nothing flashes while the lists are still on their way.
    expect(stageShowsSetupCard({
      backend: 'local', requiresModels: MOTION.requiresModels, mlxMissing: { image: false, video: false },
      connected: null, modelsLoaded: false, laneModelCount: 0,
    })).toBe(false)
  })
})

describe('the store on a Mac', () => {
  it('keeps Motion Control through the backend switch where the Mac runs it', () => {
    useCreateStore.setState({ backend: 'cloud', videoModelList: LTX23 } as never)
    useCreateStore.getState().setIntent('motion')
    useCreateStore.getState().setBackend('local')
    expect(deriveIntent(useCreateStore.getState())).toBe('motion')
  })

  it('leaves it where it does not, as before', () => {
    useCreateStore.setState({ backend: 'cloud', videoModelList: LTX25 } as never)
    useCreateStore.getState().setIntent('motion')
    useCreateStore.getState().setBackend('local')
    expect(deriveIntent(useCreateStore.getState())).toBe('video')
  })

  it('takes length, rate and size from the pack, not from Wan Animate', () => {
    const lane = buildMlxMotionModels(LTX23, true)
    useCreateStore.setState({ videoModelList: LTX23, motionModelList: lane } as never)
    useCreateStore.getState().setIntent('motion')
    const s = useCreateStore.getState()
    expect([s.frames, s.fps, s.width, s.height]).toEqual([49, 24, 768, 512])
  })

  it('falls back to Video when the last pack goes', () => {
    useCreateStore.setState({ videoModelList: LTX23 } as never)
    useCreateStore.getState().setIntent('motion')
    useCreateStore.getState().setVideoModelList([])
    expect(deriveIntent(useCreateStore.getState())).toBe('video')
  })
})

describe('the character chip on the tab', () => {
  it('shows on a Mac only while the lane can run', () => {
    expect(characterChipShown('local', 'motion', true, true)).toBe(true)
    expect(characterChipShown('local', 'motion', true, false)).toBe(false)
    // The other Mac tabs without an engine stay without a chip.
    expect(characterChipShown('local', 'lipsync', true, true)).toBe(false)
  })

  it('NEGATIVE CONTROL: on Windows the chip is on the tab as before', () => {
    expect(characterChipShown('local', 'motion', false, false)).toBe(true)
  })
})
