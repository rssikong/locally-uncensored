/**
 * Round 6, acceptance on Android 8 GB, find B4: a question sent while a
 * document was being read ended twice in "This answer stopped with an error.
 * The model did not finish loading within 120 seconds."
 *
 * The 120 seconds belong to the engine (src-tauri, LOAD_TIMEOUT) and start
 * when the engine is asked to load. They may not run while the send still
 * waits for the one model slot, and no reading may start under a load that is
 * running. This file holds the side of the load: the engine is not asked,
 * not even for its state, before the slot is free, and from then until the
 * engine answered the load is marked (lib/model-slot.ts). The side of the
 * reading is in mobile-document-job.test.ts.
 *
 * Run: npx vitest run src/api/__tests__/mobile-load-waits-for-reading.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

vi.mock('../../stores/providerStore', () => ({
  useProviderStore: { getState: () => ({ providers: { openai: { enabled: true, managed: true } } }) },
}))
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { builtinEngine: { ctx: 4096 } } }) },
}))
const backendCall = vi.fn()
vi.mock('../backend', () => ({ backendCall: (...args: unknown[]) => backendCall(...args) }))

import { ensureBuiltinEngineAlive } from '../builtin-ensure'
import { __resetModelSlotForTests, beginDocumentJob, chatModelLoading, claimSlotForChatLoad, getDocumentJobState, markDocumentJobWaiting } from '../../lib/model-slot'

const MODELS = { models: [{ name: 'Qwen3-1.7B-Q4_K_M', path: '/models/Qwen3-1.7B-Q4_K_M.gguf' }] }
const tick = () => new Promise((r) => setTimeout(r, 5))
const callsTo = (cmd: string) => backendCall.mock.calls.filter((c) => c[0] === cmd)

/** An engine that is down and takes as long to load as the test says. */
function engineThatLoads() {
  let finish: () => void = () => undefined
  const loading = new Promise<void>((r) => { finish = r })
  backendCall.mockImplementation(async (cmd: string) => {
    if (cmd === 'bundled_engine_status') return { running: false, healthy: false }
    if (cmd === 'list_bundled_models') return MODELS
    if (cmd === 'start_bundled_engine') {
      await loading
      return { status: 'started' }
    }
    throw new Error(`unexpected command ${cmd}`)
  })
  return { finish: () => finish() }
}

beforeEach(() => {
  backendCall.mockReset()
  __resetModelSlotForTests()
})
afterEach(() => { vi.unstubAllGlobals() })

describe('B4: the load of the chat model and a reading on a phone', () => {
  it('the engine is not asked while a document is read, so its 120 seconds do not run during the wait', async () => {
    standOn('android')
    const engine = engineThatLoads()
    const readingDone = beginDocumentJob()
    const send = ensureBuiltinEngineAlive('Qwen3-1.7B-Q4_K_M')
    await tick()
    await tick()
    // Not the load, and not even the question for the state: nothing has started.
    expect(backendCall).not.toHaveBeenCalled()
    expect(chatModelLoading()).toBe(false)

    readingDone()
    await vi.waitFor(() => expect(callsTo('start_bundled_engine')).toHaveLength(1))
    // From here the load is marked, until the engine answered.
    expect(chatModelLoading()).toBe(true)
    engine.finish()
    await send
    expect(chatModelLoading()).toBe(false)
  })

  it('a load that fails ends its mark, so the next reading is not held forever', async () => {
    standOn('android')
    backendCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'bundled_engine_status') return { running: false, healthy: false }
      if (cmd === 'list_bundled_models') return MODELS
      throw new Error('The model did not finish loading within 120 seconds.')
    })
    await expect(ensureBuiltinEngineAlive('Qwen3-1.7B-Q4_K_M')).rejects.toThrow(/120 seconds/)
    expect(chatModelLoading()).toBe(false)
  })

  it('a reading that begins in the same tick as the claim is seen: the claim asks again', async () => {
    standOn('android')
    const first = beginDocumentJob()
    let claimed = false
    const claim = claimSlotForChatLoad().then((done) => { claimed = true; return done })
    // The first reading ends and a second one begins before the claim runs on.
    first()
    const second = beginDocumentJob()
    await tick()
    expect(claimed).toBe(false)
    second()
    const done = await claim
    expect(chatModelLoading()).toBe(true)
    done()
    done()
    expect(chatModelLoading()).toBe(false)
  })

  it('what a waiting reading waits for has a name: the answer, or the model that is loading', async () => {
    standOn('android')
    markDocumentJobWaiting(true)
    expect(getDocumentJobState()).toBe('waiting-for-answer')
    const done = await claimSlotForChatLoad()
    expect(getDocumentJobState()).toBe('waiting-for-model')
    done()
    markDocumentJobWaiting(false)
    expect(getDocumentJobState()).toBe('none')
  })

  it('a desktop marks nothing and waits for nothing', async () => {
    standOn('windows')
    const engine = engineThatLoads()
    const readingDone = beginDocumentJob()
    const send = ensureBuiltinEngineAlive('Qwen3-1.7B-Q4_K_M')
    await vi.waitFor(() => expect(callsTo('start_bundled_engine')).toHaveLength(1))
    expect(chatModelLoading()).toBe(false)
    engine.finish()
    await send
    readingDone()
  })
})
