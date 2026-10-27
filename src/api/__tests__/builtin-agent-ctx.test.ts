/**
 * Z36 finding 2 (W3 run 2026-08-16): an agent turn carries the tool
 * catalogue and outgrows the built-in engine's 8192 start default while the
 * GGUF itself was trained for 32k, and nobody ever restarted the engine
 * bigger, so the prompt silently overflowed the real window.
 * ensureBuiltinAgentCtx raises the managed engine to
 * min(ctx_train, AGENT_CONTEXT_CAP) before an agent run. These tests pin
 * when it raises, when it must NOT (the negative controls: already big
 * enough, no header value, explicit user tuning), and the fallback path
 * when the bigger KV cache does not fit the card.
 *
 * Run: npx vitest run src/api/__tests__/builtin-agent-ctx.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

let managed = true
let enabled = true
vi.mock('../../stores/providerStore', () => ({
  useProviderStore: {
    getState: () => ({ providers: { openai: { enabled, managed } } }),
  },
}))

const tuning: Record<string, unknown> = {}
let contextWindowOverride = 0
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { builtinEngine: tuning, contextWindowOverride } }),
  },
}))

const backendCall = vi.fn()
vi.mock('../backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...args),
}))

import { ensureBuiltinAgentCtx, __resetAgentCtxStateForTests } from '../builtin-ensure'
import { AGENT_CONTEXT_CAP } from '../../lib/context-window'

const MODELS = { models: [{ name: 'qwen3-8b', path: '/models/qwen3-8b.gguf', ctx_train: 32768 }] }

function mockEngine(opts: {
  running?: boolean
  ctx?: number | null
  ctxRequested?: number | null
  list?: unknown
  swapFails?: boolean
}) {
  backendCall.mockImplementation(async (cmd: unknown) => {
    if (cmd === 'bundled_engine_status') {
      return { running: opts.running ?? true, healthy: opts.running ?? true, ctx: opts.ctx ?? null, ctxRequested: opts.ctxRequested ?? null }
    }
    if (cmd === 'list_bundled_models') return opts.list ?? MODELS
    if (cmd === 'swap_bundled_model') {
      if (opts.swapFails) throw new Error('llama-server exited: failed to allocate KV cache')
      return { status: 'started' }
    }
    if (cmd === 'start_bundled_engine') return { status: 'started' }
    throw new Error(`unexpected command ${String(cmd)}`)
  })
}

const callsTo = (cmd: string) => backendCall.mock.calls.filter((c) => c[0] === cmd)

describe('ensureBuiltinAgentCtx', () => {
  beforeEach(() => {
    backendCall.mockReset()
    __resetAgentCtxStateForTests()
    managed = true
    enabled = true
    contextWindowOverride = 0
    for (const k of Object.keys(tuning)) delete tuning[k]
    tuning.ctx = 8192 // the untouched shipped default
  })

  it('raises a running 8192 engine to the GGUF trained ctx', async () => {
    mockEngine({ running: true, ctx: 8192 })
    await ensureBuiltinAgentCtx('openai::qwen3-8b')
    const swaps = callsTo('swap_bundled_model')
    expect(swaps).toHaveLength(1)
    expect(swaps[0][1]).toMatchObject({ modelPath: '/models/qwen3-8b.gguf', tuning: { ctx: 32768 } })
  })

  it('caps a 131072-trained model at AGENT_CONTEXT_CAP', async () => {
    mockEngine({
      running: true,
      ctx: 8192,
      list: { models: [{ name: 'big', path: '/m/big.gguf', ctx_train: 131072 }] },
    })
    await ensureBuiltinAgentCtx('big')
    expect(callsTo('swap_bundled_model')[0][1]).toMatchObject({ tuning: { ctx: AGENT_CONTEXT_CAP } })
  })

  it('NEGATIVE: leaves an engine alone that already runs at the target', async () => {
    mockEngine({ running: true, ctx: 32768 })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(callsTo('swap_bundled_model')).toHaveLength(0)
    expect(callsTo('start_bundled_engine')).toHaveLength(0)
  })

  it('NEGATIVE: never raises when the GGUF header states no trained ctx', async () => {
    mockEngine({
      running: true,
      ctx: 8192,
      list: { models: [{ name: 'mystery', path: '/m/mystery.gguf', ctx_train: null }] },
    })
    await ensureBuiltinAgentCtx('mystery')
    expect(callsTo('swap_bundled_model')).toHaveLength(0)
    expect(callsTo('start_bundled_engine')).toHaveLength(0)
  })

  it('NEGATIVE: an explicit user engine ctx wins, nothing is even probed', async () => {
    tuning.ctx = 12288 // the user touched the expert setting
    mockEngine({ running: true, ctx: 12288 })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('NEGATIVE: eine ausdrueckliche Wahl von 8K wird nicht ueberstimmt (GH #129)', async () => {
    /*
     * Der zweite Befund des Melders: "wenn ich die Lu-Engine benutze und den
     * Agenten einschalte, ruckelt mein PC so stark, dass er unbrauchbar ist".
     *
     * Der Deckel hier hebt den Motor vor einem Agentenlauf auf
     * min(ctx_train, 32768), gemessen auf einer RTX 3060 12 GB. Wer auf einem
     * schwaecheren Geraet ausdruecklich 8K waehlt, meint 8K. Bis hierher war
     * genau dieser eine Wert nicht als Wahl erkennbar, weil die
     * Voreinstellung dieselbe Zahl ist; jeder andere war es laengst (die
     * Probe darueber mit 12288). Die Marke schliesst die Luecke.
     */
    tuning.ctx = 8192
    tuning.ctxChosen = true
    mockEngine({ running: true, ctx: 8192 })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(backendCall).not.toHaveBeenCalled()
  })

  it('ohne die Marke bleibt die 8192 die Voreinstellung und wird gehoben', async () => {
    // Die Gegenprobe zur Probe darueber: ein bestehendes Profil traegt die
    // 8192 seit dem ersten Start. Sie als Wahl zu lesen waere Z36 zurueck.
    tuning.ctx = 8192
    tuning.ctxChosen = false
    mockEngine({ running: true, ctx: 8192 })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(callsTo('swap_bundled_model')[0][1]).toMatchObject({ tuning: { ctx: 32768 } })
  })

  it('contextWindowOverride wins over the GGUF ceiling', async () => {
    contextWindowOverride = 24576
    mockEngine({ running: true, ctx: 8192 })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(callsTo('swap_bundled_model')[0][1]).toMatchObject({ tuning: { ctx: 24576 } })
  })

  it('starts a stopped engine directly at the agent ctx (no start-then-swap)', async () => {
    mockEngine({ running: false })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(callsTo('swap_bundled_model')).toHaveLength(0)
    const starts = callsTo('start_bundled_engine')
    expect(starts).toHaveLength(1)
    expect(starts[0][1]).toMatchObject({ tuning: { ctx: 32768 } })
  })

  it('falls back to the previous tuning when the raise fails, and never retries that pair', async () => {
    mockEngine({ running: true, ctx: 8192, swapFails: true })
    await ensureBuiltinAgentCtx('qwen3-8b')
    // Fallback restart with the untouched settings tuning, chat survives.
    const starts = callsTo('start_bundled_engine')
    expect(starts).toHaveLength(1)
    expect(starts[0][1]).toMatchObject({ tuning: { ctx: 8192 } })
    // Second agent turn: the refusal is remembered, no swap attempt again.
    backendCall.mockClear()
    mockEngine({ running: true, ctx: 8192, swapFails: true })
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(callsTo('swap_bundled_model')).toHaveLength(0)
  })

  it('does nothing when the slot is not the managed engine', async () => {
    managed = false
    await ensureBuiltinAgentCtx('qwen3-8b')
    expect(backendCall).not.toHaveBeenCalled()
  })
  // 3.0.8 (A25): the VRAM plan answers a context nobody chose with as much
  // as fits the card. An engine that was asked for 32K and runs 16K has had
  // its answer; asking again on every agent turn would restart it each time.
  it('does not ask again for a raise the plan already answered with less', async () => {
    mockEngine({ running: true, ctx: 16384, ctxRequested: AGENT_CONTEXT_CAP })
    await ensureBuiltinAgentCtx('openai::qwen3-8b')
    expect(callsTo('swap_bundled_model')).toHaveLength(0)
    expect(callsTo('start_bundled_engine')).toHaveLength(0)
  })

  it('still raises when the running engine was asked for less', async () => {
    mockEngine({ running: true, ctx: 16384, ctxRequested: 8192 })
    await ensureBuiltinAgentCtx('openai::qwen3-8b')
    expect(callsTo('swap_bundled_model')).toHaveLength(1)
  })
})

describe('wiring: the agent surfaces actually call the raise', () => {
  const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8')

  it('useAgentChat and useCodex raise the engine before resolving the run budget', () => {
    expect(read('../../hooks/useAgentChat.ts')).toContain('ensureBuiltinAgentCtx(modelToUse)')
    expect(read('../../hooks/useCodex.ts')).toContain('ensureBuiltinAgentCtx(modelToUse)')
  })

  it('the run budget reads the started ctx from the engine status (openai provider clamp)', () => {
    const src = read('../providers/openai-provider.ts')
    expect(src).toContain("backendCall<{ running?: boolean; ctx?: number | null }>('bundled_engine_status')")
  })

})
