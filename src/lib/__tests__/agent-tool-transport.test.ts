/**
 * The Agent surface falls back to the prompt transport like Coding (G26, R18
 * witness 2026-08-07): a Qwen3 abliterated GGUF passed the family heuristic,
 * the native run died in 42 s with "This model does not support tool calling,
 * so it can't run in Agent or Code mode", while the Coding surface drove the
 * very same model through 51 tool steps on the hermes prompt transport. The
 * gate text was also factually wrong.
 *
 * Run: npx vitest run src/lib/__tests__/agent-tool-transport.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { PLATFORM_TEXTS } from '../platform-text'

const here = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(resolve(here, rel), 'utf8')
const agent = read('../../hooks/useAgentChat.ts')
const strategyMod = read('../agent-strategy.ts')

describe('pre-flight strategy resolution', () => {
  it('G37b: the Agent surface calls the ONE shared resolution instead of an inline copy', () => {
    // The inline copy is what drifted in G32b, and it is where G37b hid: the
    // copies could not gain the live server overlay together. One resolver,
    // every surface.
    expect(agent).toContain('await resolveToolCallingStrategy(activeModel)')
    expect(agent).not.toContain('strategy = toolStrategyFor({')
  })

  it('uses the layered resolution shared with Code and the toggle, not the bare name heuristic', () => {
    expect(strategyMod).toContain('toolStrategyFor({')
    expect(strategyMod).toContain("supportsTools: pickerMeta && pickerMeta.type === 'text' ? pickerMeta.supportsTools : undefined")
    expect(agent).not.toContain('strategy = getToolCallingStrategy(')
  })

  it('R18: overlays Ollama\'s own /api/show capabilities before the first request', () => {
    expect(strategyMod).toContain('strategy = applyLiveCapabilities(strategy, await getModelCapabilities(modelToUse))')
  })

  it('G32 (R20-Mac): the layered resolution runs for EVERY provider', () => {
    // The old gate here read "cloud providers are always native", but
    // providerId 'openai' also covers LM Studio, vLLM and llama.cpp. Proven
    // at the wire 2026-08-07: the app saw a capability answer WITHOUT
    // tool_use and still sent a native `tools` payload, because the
    // resolution only ran in the Ollama branch.
    expect(agent).not.toContain('isNativeToolProvider(providerId)')
    expect(strategyMod).not.toContain('isNativeToolProvider(')
  })

  it('NEGATIVE CONTROL: only Ollama pays the /api/show overlay and template_fix', () => {
    // getModelCapabilities speaks Ollama's /api/show; running it for an LM
    // Studio or cloud model would probe the wrong server. Cloud models stay
    // native through the resolution itself (see tool-support.test.ts), not
    // through a provider gate.
    expect(strategyMod).toContain("if (providerId === 'ollama') {")
  })
})

describe('the runtime refusal is a downgrade, not a dead end', () => {
  it('records the refusal so the next run resolves to the prompt transport', () => {
    expect(agent).toContain('markToolsUnsupported(modelToUse)')
  })

  it('a local provider gets the fallback message, factually correct', () => {
    expect(agent).toContain("getProviderIdFromModel(activeModel) !== 'lu-cloud'")
    // The sentence lives in lib/platform-text.ts since the phone work; the
    // branch asks for it by key.
    expect(agent).toContain("? platformText('agentToolTransportSwitched')")
    expect(PLATFORM_TEXTS.agentToolTransportSwitched.desktop).toContain('LU has switched it to the prompt-based tool transport')
  })

  it('the factually wrong gate text is gone', () => {
    // Code mode ran this exact model, so the old text was a lie.
    expect(agent).not.toContain("can't run in Agent or Code mode")
  })

  it('NEGATIVE CONTROL: an LU Cloud model with no transport at all stays blocked', () => {
    // The server already translates prompts itself; its refusal is final and
    // a client-side hermes retry would only burn paid tokens.
    expect(agent).toContain(": platformText('agentNoToolSupport')")
    expect(PLATFORM_TEXTS.agentNoToolSupport.desktop).toContain("it can't run in Agent mode")
  })
})
