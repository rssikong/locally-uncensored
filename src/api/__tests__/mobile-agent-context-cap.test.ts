/**
 * Point 4 of the mobile groundwork: an agent run on a phone raises the
 * engine's context only as far as an injected cap allows, and not at all
 * until the shell has set one.
 *
 * On a desktop ensureBuiltinAgentCtx restarts the engine with up to 32768
 * tokens. On a phone that restart unloads and reloads the one model in the
 * slot and asks for a KV cache the device may not have.
 *
 * The desktop cases live in builtin-agent-ctx.test.ts and are untouched; the
 * twin here pins that a cap set by mistake does nothing on a desktop.
 *
 * Run: npx vitest run src/api/__tests__/mobile-agent-context-cap.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

vi.mock('../../stores/providerStore', () => ({
  useProviderStore: { getState: () => ({ providers: { openai: { enabled: true, managed: true } } }) },
}))
const settings = { builtinEngine: { ctx: 8192 } as Record<string, unknown>, contextWindowOverride: 0 }
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings }) },
}))
const backendCall = vi.fn()
vi.mock('../backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...args),
  isMacOS: () => false,
  isLinux: () => false,
}))

import { ensureBuiltinAgentCtx, __resetAgentCtxStateForTests } from '../builtin-ensure'
import {
  DEFAULT_MOBILE_CONTEXT_CAP, __resetModelSlotForTests, getMobileContextCap, setMobileContextCap,
} from '../../lib/model-slot'

function engineAt(ctx: number, ctxTrain = 32768) {
  backendCall.mockImplementation(async (cmd: unknown) => {
    if (cmd === 'bundled_engine_status') return { running: true, healthy: true, ctx }
    if (cmd === 'list_bundled_models') return { models: [{ name: 'small', path: '/m/small.gguf', ctx_train: ctxTrain }] }
    return { status: 'started' }
  })
}
const swaps = () => backendCall.mock.calls.filter((c) => c[0] === 'swap_bundled_model')

beforeEach(() => {
  backendCall.mockReset()
  __resetAgentCtxStateForTests()
  __resetModelSlotForTests()
  settings.builtinEngine = { ctx: 8192 }
  settings.contextWindowOverride = 0
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the agent context on a phone', () => {
  it('the default is conservative: no cap set, no raise, the engine is not even asked', async () => {
    standOn('android')
    expect(DEFAULT_MOBILE_CONTEXT_CAP).toBe(0)
    engineAt(4096)
    await ensureBuiltinAgentCtx('openai::small')
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('with a cap the raise stops there, below what the model was trained for', async () => {
    standOn('iphone')
    setMobileContextCap(12288)
    engineAt(4096)
    await ensureBuiltinAgentCtx('openai::small')
    expect(swaps()).toHaveLength(1)
    expect(swaps()[0][1]).toMatchObject({ modelPath: '/m/small.gguf', tuning: { ctx: 12288 } })
  })

  it('the cap also holds against a context override from the settings', async () => {
    standOn('android')
    setMobileContextCap(6144)
    settings.contextWindowOverride = 65536
    engineAt(4096)
    await ensureBuiltinAgentCtx('openai::small')
    expect(swaps()[0][1]).toMatchObject({ tuning: { ctx: 6144 } })
  })

  it('an engine already at the cap is left alone', async () => {
    standOn('android')
    setMobileContextCap(8192)
    engineAt(8192)
    await ensureBuiltinAgentCtx('openai::small')
    expect(swaps()).toHaveLength(0)
  })

  it('nonsense is "off"', () => {
    setMobileContextCap(Number.NaN); expect(getMobileContextCap()).toBe(0)
    setMobileContextCap(-5); expect(getMobileContextCap()).toBe(0)
    setMobileContextCap(8192.7); expect(getMobileContextCap()).toBe(8192)
  })
})

describe('the agent context on a desktop', () => {
  it('ignores the mobile cap and raises to the trained context as before', async () => {
    standOn('windows')
    setMobileContextCap(4096)
    engineAt(8192)
    await ensureBuiltinAgentCtx('openai::small')
    expect(swaps()).toHaveLength(1)
    expect(swaps()[0][1]).toMatchObject({ tuning: { ctx: 32768 } })
  })
})
