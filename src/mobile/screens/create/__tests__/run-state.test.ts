import { describe, expect, it } from 'vitest'
import { blockReason, initialRun, runPhase, runReducer, runShare, uploadCount, walletVerdict, type ReadyInput, type RunEvent, type RunState } from '../parts/run-state'

const play = (events: RunEvent[], from: RunState = initialRun('image')) => events.reduce(runReducer, from)

describe('the run of the stage', () => {
  it('starts empty', () => {
    expect(initialRun('image')).toMatchObject({ view: 'empty', resultId: null, error: null, cancelling: false })
  })

  it('a run that lands a result ends on the result', () => {
    const s = play([{ type: 'start', at: 100 }, { type: 'landed', id: 'a' }, { type: 'end' }])
    expect(s).toMatchObject({ view: 'result', resultId: 'a', resultIds: ['a'], startedAt: null })
  })

  it('keeps the waiting face while several images land and shows the first one after', () => {
    const mid = play([{ type: 'start', at: 1 }, { type: 'landed', id: 'a' }, { type: 'landed', id: 'b' }])
    expect(mid.view).toBe('running')
    expect(mid.resultIds).toEqual(['b', 'a'])
    expect(runReducer(mid, { type: 'end' })).toMatchObject({ view: 'result', resultId: 'a' })
  })

  it('the same result does not land twice', () => {
    const s = play([{ type: 'start', at: 1 }, { type: 'landed', id: 'a' }, { type: 'landed', id: 'a' }])
    expect(s.resultIds).toEqual(['a'])
  })

  it('an error without a result ends on the failed face and keeps the sentence', () => {
    const s = play([{ type: 'start', at: 1 }, { type: 'error', message: 'Could not reach the server.' }, { type: 'end' }])
    expect(s).toMatchObject({ view: 'failed', error: 'Could not reach the server.' })
    expect(runReducer(s, { type: 'dismiss-error' })).toMatchObject({ view: 'empty', error: null })
  })

  it('an error next to a result shows the result and keeps the sentence', () => {
    const s = play([{ type: 'start', at: 1 }, { type: 'landed', id: 'a' }, { type: 'error', message: '1 of 2 images failed.' }, { type: 'end' }])
    expect(s).toMatchObject({ view: 'result', resultId: 'a', error: '1 of 2 images failed.' })
  })

  it('cancel marks the run and a clean end goes back to empty', () => {
    const mid = play([{ type: 'start', at: 1 }, { type: 'cancel' }])
    expect(mid).toMatchObject({ view: 'running', cancelling: true })
    expect(runReducer(mid, { type: 'end' })).toMatchObject({ view: 'empty', cancelling: false })
  })

  it('cancel without a run does nothing', () => {
    const s = initialRun('image')
    expect(runReducer(s, { type: 'cancel' })).toBe(s)
    expect(runReducer(s, { type: 'end' })).toBe(s)
  })

  it('a new start clears the last result and error', () => {
    const s = play([{ type: 'start', at: 1 }, { type: 'error', message: 'x' }, { type: 'end' }, { type: 'start', at: 2 }])
    expect(s).toMatchObject({ view: 'running', error: null, resultId: null, resultIds: [], startedAt: 2 })
  })

  it('another tool starts clean, but a run in flight keeps its face', () => {
    const done = play([{ type: 'start', at: 1 }, { type: 'landed', id: 'a' }, { type: 'end' }])
    expect(runReducer(done, { type: 'tool', tool: 'video' })).toEqual(initialRun('video'))
    expect(runReducer(done, { type: 'tool', tool: 'image' })).toBe(done)
    const flying = play([{ type: 'start', at: 1 }])
    expect(runReducer(flying, { type: 'tool', tool: 'video' })).toMatchObject({ view: 'running', tool: 'video' })
  })

  it('a result picked up after a restart is shown, but never over a running job', () => {
    expect(runReducer(initialRun('image'), { type: 'show', id: 'z' })).toMatchObject({ view: 'result', resultId: 'z', resultIds: ['z'] })
    const flying = play([{ type: 'start', at: 1 }])
    expect(runReducer(flying, { type: 'show', id: 'z' })).toBe(flying)
  })

  it('deleting the shown result moves on or empties the stage', () => {
    const two = play([{ type: 'start', at: 1 }, { type: 'landed', id: 'a' }, { type: 'landed', id: 'b' }, { type: 'end' }])
    const one = runReducer(two, { type: 'removed', id: 'a' })
    expect(one).toMatchObject({ view: 'result', resultId: 'b', resultIds: ['b'] })
    expect(runReducer(one, { type: 'removed', id: 'b' })).toMatchObject({ view: 'empty', resultId: null })
    expect(runReducer(two, { type: 'removed', id: 'unknown' })).toBe(two)
  })
})

describe('the phase of a running job', () => {
  it('reads the phase from what the cloud layer reports', () => {
    expect(runPhase({ progress: 2, phase: '', text: 'Uploading image' })).toBe('uploading')
    expect(runPhase({ progress: 5, phase: '', text: 'Improving your prompt' })).toBe('improving')
    expect(runPhase({ progress: 8, phase: '', text: 'Checking the price' })).toBe('pricing')
    expect(runPhase({ progress: 10, phase: '', text: 'Submitting' })).toBe('submitting')
    expect(runPhase({ progress: 20, phase: '', text: 'Waiting for a free machine' })).toBe('queued')
    expect(runPhase({ progress: 40, phase: 'sampling', text: 'Rendering' })).toBe('rendering')
    expect(runPhase({ progress: 100, phase: '', text: '' })).toBe('finishing')
    expect(runPhase({ progress: 0, phase: '', text: '' })).toBe('uploading')
  })

  it('gives no number before there is one', () => {
    expect(runShare({ progress: 0, phase: '' })).toBeUndefined()
    expect(runShare({ progress: 50, phase: '' })).toBe(0.5)
    expect(runShare({ progress: 400, phase: '' })).toBe(1)
  })

  it('reads the upload count', () => {
    expect(uploadCount('Uploading training photos 3/12')).toEqual({ done: 3, total: 12 })
    expect(uploadCount('Uploading')).toBeNull()
    expect(uploadCount('9/3')).toBeNull()
  })
})

describe('may the run start', () => {
  const ok: ReadyInput = {
    online: true, tool: 'image', promptNeeded: true, prompt: 'a fox', sourceNeeded: false, hasSource: false, maskNeeded: false, hasMask: false,
    characterUse: false, hasCharacter: false, trainPhotos: 0, minTrainPhotos: 4, hasVoice: false, needsPortrait: false, needsClip: false, hasVideo: false,
    hasExtendClip: false, hasModel: true, priceState: 'known', quotaKnown: true,
  }

  it('a complete image run may start', () => {
    expect(blockReason(ok)).toBeNull()
  })

  it('names the first thing that is missing', () => {
    expect(blockReason({ ...ok, online: false })).toBe('offline')
    expect(blockReason({ ...ok, hasModel: false })).toBe('no-model')
    expect(blockReason({ ...ok, prompt: '   ' })).toBe('no-prompt')
    expect(blockReason({ ...ok, tool: 'edit', sourceNeeded: true })).toBe('no-source')
    expect(blockReason({ ...ok, tool: 'eraser', sourceNeeded: true, hasSource: true, maskNeeded: true, promptNeeded: false })).toBe('no-mask')
    expect(blockReason({ ...ok, quotaKnown: false })).toBe('quota-unknown')
  })

  it('a price that is still being confirmed does not block, one that failed does', () => {
    expect(blockReason({ ...ok, priceState: 'pending' })).toBeNull()
    expect(blockReason({ ...ok, priceState: 'unavailable' })).toBe('price-unavailable')
  })

  it('knows what each special tool needs', () => {
    const c = { ...ok, tool: 'character' as const, promptNeeded: false }
    expect(blockReason({ ...c, trainPhotos: 3 })).toBe('no-photos')
    expect(blockReason({ ...c, trainPhotos: 4 })).toBeNull()
    expect(blockReason({ ...c, characterUse: true })).toBe('no-character')
    const t = { ...ok, tool: 'lipsync' as const, promptNeeded: false }
    expect(blockReason({ ...t, needsPortrait: true })).toBe('no-portrait')
    expect(blockReason({ ...t, needsPortrait: true, hasSource: true })).toBe('no-voice')
    expect(blockReason({ ...t, needsClip: true })).toBe('no-clip')
    expect(blockReason({ ...ok, tool: 'extend' })).toBe('no-clip')
    expect(blockReason({ ...ok, tool: 'motion', promptNeeded: false, hasSource: true })).toBe('no-motion-video')
  })

  it('maps the wallet', () => {
    expect(walletVerdict('ok')).toBe('ok')
    expect(walletVerdict('insufficient')).toBe('credits')
    expect(walletVerdict('no-trainings')).toBe('trainings')
    expect(walletVerdict('no-video-budget')).toBe('video_budget')
  })
})
