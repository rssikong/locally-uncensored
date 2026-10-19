/**
 * The Cloud switch to Local on a Mac keeps Talking Character and Character
 * Studio where the Mac runs them itself (15.10.2026).
 *
 * setBackend left every cloud lane on the Mac the way a click on Image or
 * Video does, except Extend, Music and Motion while the Mac runs them. Talking
 * Character (LTX-2.3 a2v) and Character Studio (mflux, mflux-train) were
 * missing from that list: with a model that talks installed, Talking Character
 * jumped to Video, and Character Studio always jumped to Image, although the
 * bar offers both as local tabs.
 *
 * Run: npx vitest run src/stores/__tests__/mac-flip-keeps-talking-and-character.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

const io = vi.hoisted(() => ({ mac: true }))
vi.mock('../../api/mlx-image', () => ({ isMlxImageHost: () => io.mac, MLX_MODEL_PREFIX: 'MLX ' }))

import { useCreateStore, deriveIntent } from '../createStore'
import { isIntentAvailable } from '../../components/create/experimental/intents'

const TALKS = { name: 'MLX LTX-2.3 4-bit', type: 'ltx', source: 'checkpoint', mlxVideo: { talking: 'ready' } }
const SILENT = { name: 'MLX Wan 2.1 T2V 1.3B', type: 'wan', source: 'checkpoint', startImage: 'none' }
const now = () => deriveIntent(useCreateStore.getState())

function flip(intent: 'lipsync' | 'character', videoModelList: unknown[]) {
  useCreateStore.setState({ backend: 'cloud', videoModelList } as never)
  useCreateStore.getState().setIntent('image')
  useCreateStore.getState().setIntent(intent)
  expect(now()).toBe(intent)
  useCreateStore.getState().setBackend('local')
}

beforeEach(() => { io.mac = true })

describe('Mac: Cloud to Local keeps the lanes the Mac runs itself', () => {
  it('Talking Character stays while a model that talks is installed', () => {
    expect(isIntentAvailable('lipsync', 'local', true, false, false, false, false, false, true)).toBe(true)
    flip('lipsync', [TALKS])
    expect(now()).toBe('lipsync')
    expect(useCreateStore.getState().backend).toBe('local')
  })

  it('Talking Character still falls back to Video without such a model', () => {
    flip('lipsync', [SILENT])
    expect(now()).toBe('video')
  })

  it('Character Studio stays', () => {
    expect(isIntentAvailable('character', 'local', true)).toBe(true)
    flip('character', [])
    expect(now()).toBe('character')
  })
})

describe('Windows is unchanged', () => {
  it('both lanes stay, as before', () => {
    io.mac = false
    flip('lipsync', [])
    expect(now()).toBe('lipsync')
    flip('character', [])
    expect(now()).toBe('character')
  })
})
