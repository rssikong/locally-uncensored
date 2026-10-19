// @vitest-environment jsdom
/**
 * GitHub #173 follow-up, for the reporter's own setup: LM Studio and
 * KoboldCpp next to each other in a group chat, with the context budget his
 * issues #166, #167 and #171 are about.
 *
 * A model of an additional OpenAI-compatible entry has to be measured on ITS
 * server, not on whatever sits in the `openai` slot:
 *
 *   - the window (resolveModelContext): not the LU Engine's -c when the
 *     engine holds the slot, not the window of a model of the same name in
 *     this machine's LM Studio, and through the entry's own server
 *     (KoboldCpp /api/extra/true_max_context_length, llama.cpp /props);
 *   - the send cap: a server on the LAN bills nobody, even while the slot is
 *     a paid cloud endpoint (sendsToALanBackend);
 *   - the room for an attached file (#171), which asks the same window;
 *   - the chat budget (#166, getChatWindowTokens);
 *   - the extra samplers (#175): a LAN entry is a local server.
 *
 * Run: npx vitest run src/hooks/__tests__/entries-get-their-own-context-window.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KOBOLD = 'http://192.168.1.20:5001/v1'
const LLAMA = 'http://192.168.1.21:8080/v1'

const seen: { url: string; body?: Record<string, unknown> }[] = []

vi.mock('../../api/backend', async () => {
  const lan = (host: string) => /^(127\.|localhost$|\[?::1\]?$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  const answer = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    seen.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    if (url === 'http://192.168.1.20:5001/api/extra/true_max_context_length') {
      return new Response(JSON.stringify({ value: 32768 }))
    }
    if (url === 'http://192.168.1.21:8080/props') {
      return new Response(JSON.stringify({ default_generation_settings: { n_ctx: 65536 } }))
    }
    if (url.endsWith('/chat/completions')) {
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`,
        { headers: { 'Content-Type': 'text/event-stream' } },
      )
    }
    return new Response('{}', { status: 404 })
  }
  return {
    localFetch: vi.fn(answer),
    localFetchStream: vi.fn(answer),
    isPrivateOrLanHost: lan,
    hostnameOf: (url: string) => { try { return new URL(url).hostname } catch { return '' } },
    isDirectFetchAllowed: () => false,
    ensureProxyAllowsHost: vi.fn(async () => {}),
    backendCall: vi.fn(async () => { throw new Error('no backend in this test') }),
    isTauri: () => false,
    isOllamaLocal: () => true,
    secretGet: vi.fn(async () => { throw new Error('no keychain here') }),
    secretSet: vi.fn(async () => { throw new Error('no keychain here') }),
    secretDelete: vi.fn(async () => { throw new Error('no keychain here') }),
    secretParkGet: vi.fn(async () => { throw new Error('no keychain here') }),
    secretParkSet: vi.fn(async () => { throw new Error('no keychain here') }),
    secretParkDelete: vi.fn(async () => { throw new Error('no keychain here') }),
  }
})
// This machine's LM Studio has a model of the same name, loaded small.
vi.mock('../../api/lmstudio', async () => {
  const actual = await vi.importActual<typeof import('../../api/lmstudio')>('../../api/lmstudio')
  return { ...actual, getLmStudioModelContext: vi.fn(async () => ({ loaded: 4096, max: 4096, state: 'loaded' })) }
})
// The LU Engine runs with -c 8192.
vi.mock('../../api/engine', async () => {
  const actual = await vi.importActual<typeof import('../../api/engine')>('../../api/engine')
  return { ...actual, bundledEngineStatus: vi.fn(async () => ({ running: true, healthy: true, ctx: 8192 })), bundledCtxTrain: () => 0 }
})

import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { clearProviderCache, getProviderForModel } from '../../api/providers/registry'
import { resolveModelContext, currentContextKnobs } from '../useActiveContextWindow'
import { sendsToALanBackend } from '../../lib/lan-openai-slot'
import { getChatWindowTokens } from '../../lib/context-compaction'
import { fitFilesForSend } from '../chat-file-room'
import { speakerSamplingLines } from '../../lib/speaker-sampling-lines'
import { samplerTargetOfModel } from '../../lib/lan-openai-slot'
import { OpenAIProvider } from '../../api/providers/openai-provider'
import type { ProviderConfig } from '../../api/providers/types'
import type { FileAttachment } from '../../types/chat'

const engineSlot: ProviderConfig = {
  id: 'openai', name: 'LU Engine', enabled: true, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: true,
}
const paidSlot: ProviderConfig = {
  id: 'openai', name: 'OpenRouter', enabled: true, baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', isLocal: false, managed: false,
}

let kobold = ''
let llama = ''

function setUp(slot: ProviderConfig) {
  const st = useProviderStore.getState()
  useProviderStore.setState({
    providers: { ...st.providers, openai: slot, ollama: { ...st.providers.ollama, enabled: false } },
    openaiEntries: [],
  })
  // A custom entry on the LAN: the preset did not say local, the address does.
  kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
  llama = useProviderStore.getState().addOpenAIEntry({ name: 'llama.cpp', baseUrl: LLAMA, isLocal: true })
  clearProviderCache()
  seen.length = 0
}

beforeEach(() => {
  useSettingsStore.getState().updateSettings({ contextDecay: true, contextWindowByModel: {}, attachmentTokenLimit: 0 })
  setUp(engineSlot)
})
afterEach(() => clearProviderCache())

describe('the window of a model on an additional entry', () => {
  it('is the entry server\'s own, not the LU Engine\'s -c and not the local LM Studio\'s', async () => {
    const ctx = await resolveModelContext(`openai:${kobold}::qwen3-8b`, 'chat', currentContextKnobs())
    expect(ctx.contextWindow).toBe(32768)
    expect(ctx.provider).toBe('custom')
    expect(seen.some((s) => s.url === 'http://192.168.1.20:5001/api/extra/true_max_context_length')).toBe(true)

    const lc = await resolveModelContext(`openai:${llama}::qwen3-8b`, 'chat', currentContextKnobs())
    expect(lc.contextWindow).toBe(65536)
  })

  // Negative control: the slot's own model keeps the engine's window.
  it('leaves the slot\'s model on the engine', async () => {
    const ctx = await resolveModelContext('openai::qwen3-8b', 'chat', currentContextKnobs())
    expect(ctx).toMatchObject({ provider: 'builtin', contextWindow: 8192 })
  })

  it('is not cut to a paid send cap while the slot is a paid endpoint', async () => {
    setUp(paidSlot)
    expect(sendsToALanBackend('openai', `openai:${kobold}::qwen3-8b`)).toBe(true)
    expect(sendsToALanBackend('openai', 'openai::gpt-4o')).toBe(false)
    const ctx = await resolveModelContext(`openai:${kobold}::qwen3-8b`, 'chat', currentContextKnobs())
    expect(ctx.contextWindow).toBe(32768)
    expect(ctx.sendWindow).toBe(32768)
  })

  it('is what the chat budget of a group round reads (#166)', async () => {
    expect(await getChatWindowTokens(`openai:${kobold}::qwen3-8b`)).toBe(32768)
  })
})

describe('an attached file in a group with a KoboldCpp member (#171)', () => {
  it('gets the room of the KoboldCpp window, not of the engine', async () => {
    // About 12000 tokens of text: more than the engine's 8192 holds, well
    // inside KoboldCpp's 32768.
    const text = 'word '.repeat(12000)
    const file: FileAttachment = {
      name: 'notes.txt', size: text.length, kind: 'text', sha256: '0'.repeat(64),
      summary: `The whole text of the file:\n${text}`, textChars: text.length, includedChars: text.length,
    } as FileAttachment
    const out = await fitFilesForSend({ files: [file], models: [`openai:${kobold}::qwen3-8b`], use: 'chat', otherText: 'hi' })
    expect(out?.[0].summary).toBe(file.summary)
  })
})

describe('the extra samplers of an entry on the LAN (#175)', () => {
  it('reach the server as for a local one', async () => {
    const cfg = useProviderStore.getState().openaiEntries.find((e) => e.entryId === kobold)!
    const provider = new OpenAIProvider({ ...cfg, apiKey: '' })
    for await (const _ of provider.chatStream('qwen3-8b', [{ role: 'user', content: 'hi' }], { minP: 0.05, dryMultiplier: 0.8 })) { /* drain */ }
    const sent = seen.find((s) => s.url.endsWith('/chat/completions'))!.body!
    expect(sent.min_p).toBe(0.05)
    expect(sent.dry_multiplier).toBe(0.8)
    expect(getProviderForModel(`openai:${kobold}::qwen3-8b`).provider.entryId).toBe(kobold)
  })

  it('are shown as sent in the Sampling popup for that speaker, and not for the paid slot', () => {
    setUp(paidSlot)
    const lines = speakerSamplingLines({
      settings: { temperature: 0.7, topP: 0.9, maxTokens: 0, topK: 40, personasEnabled: false },
      conv: { groupModels: [`openai:${kobold}::qwen3-8b`, 'openai::gpt-4o'], sampling: { minP: 0.05 } },
      activeModel: null,
      personas: [],
      activePersonaId: undefined,
      providers: useProviderStore.getState().providers,
      targetOf: samplerTargetOfModel,
    })
    const minP = (i: number) => lines[i].values.find((v) => v.label === 'Min P')
    expect(minP(0)?.sent).toBe(true)
    expect(minP(1)?.sent).toBe(false)
  })
})
