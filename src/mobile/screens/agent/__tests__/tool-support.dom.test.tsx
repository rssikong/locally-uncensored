// @vitest-environment jsdom
/**
 * Round 5, N6: Agent mode could be switched on with a model of this phone
 * that cannot drive tools (SmolLM2 360M). The logic layer says "can" for
 * every model behind an OpenAI style server. The catalogue of the phone
 * knows which of its models carry the mark "Tools", and it decides.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/tool-support.dom.test.tsx
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { useToolSupport } from '../../../../hooks/useToolSupport'
import { useAgentModeStore } from '../../../../stores/agentModeStore'
import { useModelStore } from '../../../../stores/modelStore'
import { MOBILE_CHAT_MODELS } from '../../../data/mobile-models'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { agentMustTurnOff, deviceToolVerdict, packedTooSmallForAgent, agentBlockReason, toolModelFitsThisPhone, useAgentToolSupport } from '../parts/tool-support'
import { NEW_CHAT, chatKey } from '../parts/chat-ref'
import { AgentToolGuard } from '../ComposerStatus'

const toasts = vi.hoisted(() => [] as string[])
vi.mock('../../../ui', async (orig) => ({ ...(await orig<typeof import('../../../ui')>()), toast: (_text: string, options?: { testid?: string }) => { toasts.push(options?.testid ?? '') } }))

const engineName = (id: string) => `openai::${MOBILE_CHAT_MODELS.find((m) => m.id === id)!.filename.replace(/\.gguf$/i, '')}`
const choose = (name: string | null) => useModelStore.setState({ activeModel: name, models: name ? ([{ name, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'LU Engine' }] as never) : [] })

afterEach(() => {
  cleanup()
  choose(null)
})

describe('the catalogue of the phone decides for its own models', () => {
  it('the catalogue has both kinds, so the test means something', () => {
    expect(MOBILE_CHAT_MODELS.find((m) => m.id === 'smollm2-360m')?.agent).toBe(false)
    expect(MOBILE_CHAT_MODELS.find((m) => m.id === 'qwen3.5-2b')?.agent).toBe(true)
  })

  it('SmolLM2 360M: no tools, although the logic layer alone says yes', () => {
    choose(engineName('smollm2-360m'))
    expect(deviceToolVerdict(engineName('smollm2-360m'))).toBe(false)
    expect(renderHook(() => useToolSupport()).result.current.canUseTools).toBe(true)
    const mine = renderHook(() => useAgentToolSupport()).result.current
    expect(mine.canUseTools).toBe(false)
    expect(mine.support).toBe('none')
    expect(mine.deviceWithoutTools).toBe(true)
  })

  it('a model with the Tools mark can', () => {
    choose(engineName('qwen3.5-2b'))
    const mine = renderHook(() => useAgentToolSupport()).result.current
    expect(mine.canUseTools).toBe(true)
    expect(mine.deviceWithoutTools).toBe(false)
  })

  it('every model of the catalogue without the mark is locked, every one with it is free', () => {
    for (const model of MOBILE_CHAT_MODELS) {
      expect(deviceToolVerdict(engineName(model.id)), model.id).toBe(model.agent === true)
    }
  })

  it('LU Cloud and no model keep the answer of the logic layer', () => {
    expect(deviceToolVerdict('lu-cloud::SmolLM2-360M-Instruct-Q4_K_M')).toBeNull()
    expect(deviceToolVerdict(null)).toBeNull()
  })

  it('another packing of a catalogue model is the same model (acceptance Android, re-run, N1 and N4)', () => {
    expect(deviceToolVerdict('openai::Qwen3.5-2B-Q5_K_M')).toBe(true)
    expect(deviceToolVerdict('openai::Qwen3.5-2B-Q3_K_M')).toBe(true)
    expect(deviceToolVerdict('openai::SmolLM2-360M-Instruct-Q8_0')).toBe(false)
    choose('openai::SmolLM2-360M-Instruct-Q8_0')
    expect(renderHook(() => useAgentToolSupport()).result.current.deviceWithoutTools).toBe(true)
  })

  it('a file the catalogue does not know is judged by its name, not waved through', () => {
    // A family that calls tools.
    expect(deviceToolVerdict('openai::Mistral-7B-Instruct-v0.3-Q4_K_M')).toBe(true)
    expect(deviceToolVerdict('openai::Hermes-3-Llama-3.1-8B-Q4_K_M')).toBe(true)
    // A name that says nothing about tools: until round 5 this counted as "can".
    expect(deviceToolVerdict('openai::some-imported-file-Q4_K_M')).toBe(false)
    expect(deviceToolVerdict('openai::TinyStories-33M-Q8_0')).toBe(false)
    choose('openai::some-imported-file-Q4_K_M')
    const mine = renderHook(() => useAgentToolSupport()).result.current
    expect(mine.canUseTools).toBe(false)
    expect(mine.deviceWithoutTools).toBe(true)
    choose('openai::Mistral-7B-Instruct-v0.3-Q4_K_M')
    expect(renderHook(() => useAgentToolSupport()).result.current.canUseTools).toBe(true)
  })

  it('Agent mode that was on goes off when the chosen model of this phone cannot call tools', () => {
    expect(agentMustTurnOff(true, engineName('smollm2-360m'))).toBe(true)
    expect(agentMustTurnOff(true, 'openai::some-imported-file-Q4_K_M')).toBe(true)
    expect(agentMustTurnOff(true, engineName('qwen3.5-2b'))).toBe(false)
    expect(agentMustTurnOff(false, engineName('smollm2-360m'))).toBe(false)
    // Not a model of this phone: the logic layer decides, nothing is switched here.
    expect(agentMustTurnOff(true, 'lu-cloud::anything')).toBe(false)
    expect(agentMustTurnOff(true, null)).toBe(false)
    expect(T.status.agentTurnedOff).toBe('Agent mode is off now. This model cannot use tools.')
  })

  it('the reason names the mark the model cards carry, in English and without dashes', () => {
    expect(T.options.agentNoToolsDevice).toContain('Tools mark')
    expect(T.options.agentNoToolsDevice).not.toMatch(/[\u2013\u2014]/)
  })
})

// Small iPhone, K5: on a phone with 4 GB no model with the Tools mark fits, and the locked switch for Agent mode
// said "Pick a model with the Tools mark".
describe('a phone that no model with the Tools mark fits', () => {
  const phone = (platform: 'android' | 'ios', ramGb: number) => ({ platform, ramGb })

  it('4 GB: none fits, on Android and on an iPhone, with and without the unfiltered catalogue', () => {
    for (const platform of ['android', 'ios'] as const) {
      expect(toolModelFitsThisPhone(phone(platform, 4), { unfilteredCatalog: false })).toBe(false)
      expect(toolModelFitsThisPhone(phone(platform, 4), { unfilteredCatalog: true })).toBe(false)
      expect(toolModelFitsThisPhone(phone(platform, 3), { unfilteredCatalog: true })).toBe(false)
    }
  })

  it('from 6 GB on one fits', () => {
    for (const platform of ['android', 'ios'] as const) {
      for (const ram of [6, 8, 12]) expect(toolModelFitsThisPhone(phone(platform, ram), { unfilteredCatalog: false })).toBe(true)
    }
  })

  it('a phone whose memory is not known is not judged', () => {
    expect(toolModelFitsThisPhone(null, { unfilteredCatalog: true })).toBeNull()
    expect(toolModelFitsThisPhone(phone('android', 0), { unfilteredCatalog: true })).toBeNull()
  })

  it('the sheet says why and leads to the models that work, in English and without dashes', () => {
    expect(T.options.agentNoToolsFit).toBe('This model cannot use tools, and no model with the Tools mark fits the memory of this phone: use a cloud model or a phone with more memory.')
    expect(`${T.options.agentNoToolsFit}${T.options.agentNoToolsFitPacking}${T.options.agentOtherModel}${T.options.agentOtherModelSub}${T.options.agentOtherModelSubSignedOut}`).not.toMatch(/[\u2013\u2014]/)
    const sheet = readFileSync(resolve(__dirname, '..', 'ChatOptionsSheet.tsx'), 'utf8')
    expect(sheet).toContain('const noTools = AGENT_BLOCK_TEXT[agentBlockReason({ deviceWithoutTools: tools.deviceWithoutTools, packedTooSmall: tools.packedTooSmall, noneFits })]')
    // Check 4 on Android, F6: without a sign in the row does not promise a list.
    expect(sheet).toContain('subtitle={cloudSignedIn ? S.agentOtherModelSub : S.agentOtherModelSubSignedOut}')
    expect(T.options.agentOtherModelSubSignedOut).toBe('Opens LU Cloud. Its models need a sign in.')
    expect(sheet).toContain("nav.openSheet('model', { segment: 'cloud' })")
    expect(sheet).toContain('testid="m-options-agent-other-model"')
  })
})

// Round 9, N5 of the check on Android: in a new chat that is still empty the
// switch "Agent mode" stood on and could be used with a model without tools.
// The rule that turns it off ran inside the chips of a chat that has an id.
describe('Agent mode goes off for a model without tools, in a chat without an id as well', () => {
  const agentOn = (key: string) => useAgentModeStore.getState().agentModeActive[key] ?? false

  it('the empty new chat: off at once, and said once', () => {
    toasts.length = 0
    choose(engineName('smollm2-360m'))
    useAgentModeStore.getState().setAgentModeActive(NEW_CHAT, true)
    render(<AgentToolGuard chatKey={chatKey(null)} />)
    expect(agentOn(NEW_CHAT)).toBe(false)
    expect(toasts).toEqual(['agent-turned-off'])
  })

  it('the model is changed while the empty chat is open: off the moment the new model is chosen', () => {
    toasts.length = 0
    choose(engineName('qwen3.5-2b'))
    useAgentModeStore.getState().setAgentModeActive(NEW_CHAT, true)
    render(<AgentToolGuard chatKey={NEW_CHAT} />)
    expect(agentOn(NEW_CHAT)).toBe(true)
    act(() => choose(engineName('smollm2-360m')))
    expect(agentOn(NEW_CHAT)).toBe(false)
    expect(toasts).toEqual(['agent-turned-off'])
  })

  it('a model with tools, a cloud model and a chat where Agent mode is off are left alone', () => {
    toasts.length = 0
    choose(engineName('qwen3.5-2b'))
    useAgentModeStore.getState().setAgentModeActive('c1', true)
    render(<AgentToolGuard chatKey="c1" />)
    expect(agentOn('c1')).toBe(true)
    cleanup()
    choose(engineName('smollm2-360m'))
    useAgentModeStore.getState().setAgentModeActive('c2', false)
    render(<AgentToolGuard chatKey="c2" />)
    expect(toasts).toEqual([])
    useAgentModeStore.getState().setAgentModeActive('c1', false)
  })

  it('the chat page mounts the rule for every chat, and only there (twice would be two toasts)', () => {
    const page = readFileSync(resolve(__dirname, '../../chat/ChatPage.tsx'), 'utf8')
    expect(page).toContain('<AgentToolGuard chatKey={agentChatKey(chatId)} />')
    expect(page.match(/<AgentToolGuard /g)).toHaveLength(1)
    const chips = readFileSync(resolve(__dirname, '../ComposerStatus.tsx'), 'utf8')
    const drawn = chips.slice(chips.indexOf('export function ComposerStatus('))
    expect(drawn).not.toContain('agentMustTurnOff(')
  })
})

// Check on Android with 4 GB, F3: Qwen 3.5 2B IQ2_M ("Tight fit") was the only loadable file with the Tools mark
// there, Agent mode could be switched on with it, and what it wrote was of no use.
describe('Agent mode with a model of this phone asks for a packing of 3 bits or more', () => {
  it('a 1 or 2 bit packing of a model that drives tools does not', () => {
    for (const file of ['Qwen3.5-2B-UD-IQ2_M', 'Qwen3.5-2B-Q2_K', 'Qwen3.5-2B-IQ1_S', 'Qwen3.5-2B-IQ2_XXS']) {
      expect(deviceToolVerdict(`openai::${file}`), file).toBe(false)
      expect(packedTooSmallForAgent(`openai::${file}`), file).toBe(true)
      expect(agentMustTurnOff(true, `openai::${file}`), file).toBe(true)
    }
  })

  it('from 3 bit on nothing changes, and a model without tools is not called "packed too small"', () => {
    for (const file of ['Qwen3.5-2B-IQ3_M', 'Qwen3.5-2B-Q3_K_S', 'Qwen3.5-2B-Q4_K_M', 'Qwen3.5-2B-Q8_0']) {
      expect(deviceToolVerdict(`openai::${file}`), file).toBe(true)
      expect(packedTooSmallForAgent(`openai::${file}`), file).toBe(false)
    }
    expect(packedTooSmallForAgent('openai::SmolLM2-360M-Instruct-Q2_K')).toBe(false)
    expect(packedTooSmallForAgent('lu-cloud::Qwen3.5-2B-UD-IQ2_M')).toBe(false)
  })

  it('a file the catalogue does not know: the same rule, by the packing in its name', () => {
    expect(deviceToolVerdict('openai::Hermes-3-Llama-3.1-8B-Q2_K')).toBe(false)
    expect(packedTooSmallForAgent('openai::Hermes-3-Llama-3.1-8B-Q2_K')).toBe(true)
    expect(deviceToolVerdict('openai::Hermes-3-Llama-3.1-8B-Q3_K_M')).toBe(true)
  })

  it('the hook names the packing as the reason, and the sheet has a sentence for it', () => {
    choose('openai::Qwen3.5-2B-UD-IQ2_M')
    const got = renderHook(() => useAgentToolSupport()).result.current
    expect(got.canUseTools).toBe(false)
    expect(got.deviceWithoutTools).toBe(true)
    expect(got.packedTooSmall).toBe(true)
    choose('openai::SmolLM2-360M-Instruct-Q8_0')
    expect(renderHook(() => useAgentToolSupport()).result.current.packedTooSmall).toBe(false)
    expect(T.options.agentNoToolsPacking).toBe('This model is packed too small for Agent mode. Pick one packed with 3 bits or more that has the Tools mark.')
    expect(`${T.options.agentNoToolsPacking}${T.options.agentNoToolsFit}`).not.toMatch(/[\u2013\u2014]/)
  })

  // Check 4 on Android, F6: the sentence named the packing for every model, also for one in 4 bit without the Tools mark.
  it('the sentence names the one reason that applies', () => {
    const reason = (deviceWithoutTools: boolean, packedTooSmall: boolean, noneFits: boolean) => agentBlockReason({ deviceWithoutTools, packedTooSmall, noneFits })
    expect(reason(true, false, true)).toBe('none-fits')
    expect(reason(true, true, true)).toBe('none-fits-packing')
    expect(reason(true, true, false)).toBe('packing')
    expect(reason(true, false, false)).toBe('device')
    expect(reason(false, false, false)).toBe('provider')
    // Qwen 3.5 0.8B in 4 bit on a phone with 4 GB: no word about the packing.
    choose('openai::Qwen3.5-0.8B-Q4_K_M')
    const small = renderHook(() => useAgentToolSupport()).result.current
    expect(small.deviceWithoutTools).toBe(true)
    expect(small.packedTooSmall).toBe(false)
    expect(T.options.agentNoToolsFit).not.toMatch(/packed|3 bits/)
    expect(T.options.agentNoToolsFit).toContain('This model cannot use tools')
    // Qwen 3.5 2B in 2 bit: the packing is the reason, and no word that the model lacks the mark.
    expect(T.options.agentNoToolsFitPacking).toContain('packed too small')
    expect(T.options.agentNoToolsFitPacking).not.toContain('cannot use tools')
  })

  it('4 GB: the sentence names both ways, a cloud model or a phone with more memory', () => {
    expect(toolModelFitsThisPhone({ platform: 'android', ramGb: 4 }, { unfilteredCatalog: true })).toBe(false)
    expect(T.options.agentNoToolsFit).toContain('cloud model')
    expect(T.options.agentNoToolsFit).toContain('a phone with more memory')
  })
})
