/**
 * "A model for this phone is on its way": the state the last onboarding step
 * and the chat read while the starter model downloads (acceptance Android
 * 08.10.2026, M1).
 */
import { describe, expect, it } from 'vitest'
import type { DownloadProgress } from '../../../../types/downloads'
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL } from '../../../data/mobile-models'
import { arrivingModel } from '../parts/arriving'

const row = (patch: Partial<DownloadProgress>): DownloadProgress => ({ progress: 0, total: 1000, speed: 0, filename: 'a.gguf', status: 'downloading', ...patch })
const small = MOBILE_CHAT_MODELS[0]
const other = MOBILE_CHAT_MODELS[1]

describe('the chat model that is being downloaded', () => {
  it('is nothing without a download, with only finished ones, and for the document model alone', () => {
    expect(arrivingModel({}, true)).toBeNull()
    expect(arrivingModel({ [small.filename]: row({ status: 'complete', progress: 1000 }) }, true)).toBeNull()
    expect(arrivingModel({ [MOBILE_EMBED_MODEL.filename]: row({ progress: 300 }) }, true)).toBeNull()
  })

  it('names the model as the screens do, with how far it is', () => {
    const a = arrivingModel({ [small.filename]: row({ progress: 380 }) }, true)
    expect(a).toMatchObject({ id: small.filename, name: small.name, file: small.filename.replace(/\.gguf$/, ''), state: 'downloading', kind: 'running', share: 0.38, percent: 38 })
    // Before the source said how large the file is, the size the catalogue expects counts.
    const early = arrivingModel({ [small.filename]: row({ total: 0, progress: 250, status: 'downloading' }) }, true, { [small.filename]: 1000 })
    expect(early?.percent).toBe(25)
    // A file nobody knows keeps its own name.
    expect(arrivingModel({ 'My-Own.Q4_K_M.gguf': row({}) }, true)?.name).toBe('My-Own.Q4_K_M')
  })

  it('tells moving, held and failed apart', () => {
    const one = (patch: Partial<DownloadProgress>, online = true) => arrivingModel({ [small.filename]: row(patch) }, online)
    expect(one({ status: 'connecting' })?.state).toBe('downloading')
    expect(one({ progress: 1000 })).toMatchObject({ state: 'downloading', kind: 'verifying', percent: 100 })
    expect(one({ status: 'paused' })?.state).toBe('paused')
    expect(one({ status: 'pausing' })?.state).toBe('paused')
    // No network: it goes on by itself, so it is held, not failed.
    expect(one({ status: 'downloading' }, false)).toMatchObject({ state: 'paused', kind: 'waiting-network' })
    expect(one({ status: 'error', error: 'connection reset' }, false)?.state).toBe('paused')
    expect(one({ status: 'error', error: 'connection reset' })).toMatchObject({ state: 'failed', kind: 'interrupted' })
    expect(one({ status: 'error', error: 'Download failed (HTTP 404)' })).toMatchObject({ state: 'failed', kind: 'gone' })
  })

  it('with several picks the one asked for, else the moving one, else the furthest', () => {
    const rows = {
      [small.filename]: row({ status: 'paused', progress: 900 }),
      [other.filename]: row({ progress: 100 }),
      [MOBILE_EMBED_MODEL.filename]: row({ progress: 999 }),
    }
    expect(arrivingModel(rows, true)?.id).toBe(other.filename)
    expect(arrivingModel(rows, true, {}, small.filename)?.id).toBe(small.filename)
    expect(arrivingModel(rows, true, {}, small.filename.replace(/\.gguf$/, ''))?.id).toBe(small.filename)
    // The one asked for is not being downloaded: the rule for several counts.
    expect(arrivingModel(rows, true, {}, 'nothing')?.id).toBe(other.filename)
    const bothPaused = { [small.filename]: row({ status: 'paused', progress: 900 }), [other.filename]: row({ status: 'paused', progress: 100 }) }
    expect(arrivingModel(bothPaused, true)?.id).toBe(small.filename)
  })
})
