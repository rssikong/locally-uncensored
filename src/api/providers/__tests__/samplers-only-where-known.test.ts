/**
 * GH #175: the extra samplers (min_p, repetition, presence and frequency
 * penalty, DRY) reach a backend only under a field name it reads.
 *
 *  - Ollama reads min_p, repeat_penalty, presence_penalty and
 *    frequency_penalty in `options`. It has no DRY sampler.
 *  - The bundled engine is llama-server: min_p, repeat_penalty,
 *    presence_penalty, frequency_penalty and dry_multiplier at the top level.
 *  - An own OpenAI compatible server on this machine or the LAN (LM Studio,
 *    KoboldCpp, vLLM, llama-server) gets the same, plus `repetition_penalty`,
 *    the name vLLM and KoboldCpp read for the repetition penalty.
 *  - A remote OpenAI compatible endpoint gets only the two penalties of the
 *    OpenAI spec, which a strict server accepts.
 *  - The hosted endpoint and Anthropic get none of them.
 *
 * Run: npx vitest run src/api/providers/__tests__/samplers-only-where-known.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ProviderConfig, ChatStreamChunk, ChatOptions } from '../types'
import type { FetchArgs } from '../../__tests__/provider-test-support'

const streamBody = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'

type CapturedInit = { body?: string }
type Body = Record<string, unknown>

let sent: { url: string; body: Body }[]

function answer(url: string, init: CapturedInit) {
  if (typeof init.body !== 'string') throw new Error('request had no JSON body')
  const body = JSON.parse(init.body) as Body
  sent.push({ url, body })
  if (body.stream) return new Response(streamBody, { status: 200 })
  return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 })
}

async function makeOpenAI(config: ProviderConfig) {
  vi.resetModules()
  sent = []
  vi.doMock('../../backend', () => ({
    localFetch: vi.fn(async (url: string, init: CapturedInit) => answer(url, init)),
    localFetchStream: vi.fn(async (url: string, init: CapturedInit) => answer(url, init)),
    backendCall: vi.fn(),
    isPrivateOrLanHost: (host: string) => host === 'localhost' || host === '127.0.0.1',
    isDirectFetchAllowed: () => true,
    hostnameOf: (url: string) => new URL(url).hostname,
    ensureProxyAllowsHost: vi.fn(),
    isTauri: () => false,
  }))
  vi.doMock('../../builtin-ensure', () => ({
    ensureBuiltinEngineAlive: vi.fn(),
    explainDeadEngine: (e: unknown) => e,
    explainEngineTransportMessage: (m: string) => m,
    isManagedBuiltinSlot: () => false,
  }))
  const mod = await import('../openai-provider')
  return new mod.OpenAIProvider(config)
}

async function drain(gen: AsyncGenerator<ChatStreamChunk>) {
  for await (const _ of gen) { /* the fetch only fires on the first next() */ }
}

const chatBody = () => {
  const hit = sent.find((s) => s.url.endsWith('/chat/completions'))
  if (!hit) throw new Error('no chat request was sent')
  return hit.body
}

const SAMPLERS: ChatOptions = {
  minP: 0.05, repeatPenalty: 1.1, presencePenalty: 0.3, frequencyPenalty: 0.2, dryMultiplier: 0.8,
}

const ENGINE: ProviderConfig = {
  id: 'openai', name: 'LU Engine', apiKey: '', enabled: true,
  baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true,
}
const LM_STUDIO: ProviderConfig = {
  id: 'openai', name: 'LM Studio', apiKey: '', enabled: true,
  baseUrl: 'http://localhost:1234/v1', isLocal: true,
}
const REMOTE: ProviderConfig = {
  id: 'openai', name: 'OpenAI', apiKey: 'sk-test', enabled: true,
  baseUrl: 'https://api.openai.com/v1', isLocal: false,
}
const HOSTED: ProviderConfig = {
  id: 'lu-cloud', name: 'Hosted', apiKey: 'tok', enabled: true,
  baseUrl: 'https://lu-labs.ai/api/inference/v1', isLocal: false,
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (url: FetchArgs[0], init: FetchArgs[1]) =>
      answer(String(url), { body: typeof init?.body === 'string' ? init.body : undefined }),
  )
})
afterEach(() => {
  vi.doUnmock('../../backend')
  vi.doUnmock('../../builtin-ensure')
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('OpenAI compatible slot', () => {
  it('the bundled engine gets the llama-server names, DRY included', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], SAMPLERS))
    const body = chatBody()
    expect(body.min_p).toBe(0.05)
    expect(body.repeat_penalty).toBe(1.1)
    expect(body.presence_penalty).toBe(0.3)
    expect(body.frequency_penalty).toBe(0.2)
    expect(body.dry_multiplier).toBe(0.8)
    // llama-server has no field of that name.
    expect('repetition_penalty' in body).toBe(false)
  })

  it('an own server on this machine also gets repetition_penalty, on the tool path too', async () => {
    const p = await makeOpenAI(LM_STUDIO)
    await p.chatWithTools('m', [{ role: 'user', content: 'hi' }], [], SAMPLERS)
    const body = chatBody()
    expect(body.min_p).toBe(0.05)
    expect(body.repeat_penalty).toBe(1.1)
    expect(body.repetition_penalty).toBe(1.1)
    expect(body.dry_multiplier).toBe(0.8)
  })

  it('a remote endpoint gets only the two penalties of the OpenAI spec', async () => {
    const p = await makeOpenAI(REMOTE)
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], SAMPLERS))
    const body = chatBody()
    expect(body.presence_penalty).toBe(0.3)
    expect(body.frequency_penalty).toBe(0.2)
    for (const key of ['min_p', 'repeat_penalty', 'repetition_penalty', 'dry_multiplier']) {
      expect(key in body, key).toBe(false)
    }
  })

  it('the hosted endpoint gets none of them', async () => {
    const p = await makeOpenAI(HOSTED)
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], SAMPLERS))
    const body = chatBody()
    for (const key of ['min_p', 'repeat_penalty', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'dry_multiplier']) {
      expect(key in body, key).toBe(false)
    }
  })

  it('NEGATIVKONTROLLE: nothing set, nothing sent', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('m', [{ role: 'user', content: 'hi' }], {}))
    const body = chatBody()
    for (const key of ['min_p', 'repeat_penalty', 'presence_penalty', 'frequency_penalty', 'dry_multiplier']) {
      expect(key in body, key).toBe(false)
    }
  })
})

describe('Ollama', () => {
  it('reads the four it knows in options and never sees DRY', async () => {
    vi.resetModules()
    const bodies: Body[] = []
    const reply = (_url: string, init?: { body?: unknown }) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as Body)
      return new Response(
        JSON.stringify({ message: { content: 'ok' }, done: true, done_reason: 'stop' }) + '\n',
        { status: 200 },
      )
    }
    vi.doMock('../../backend', () => ({
      isTauri: () => false,
      localFetch: vi.fn(async (url: string, init?: { body?: unknown }) => reply(url, init)),
      localFetchStream: vi.fn(async (url: string, init?: { body?: unknown }) => reply(url, init)),
      ollamaUrl: (path: string) => `/api${path}`,
    }))
    const { OllamaProvider } = await import('../ollama-provider')
    const p = new OllamaProvider({
      id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true,
    })
    await drain(p.chatStream('gemma3:4b', [{ role: 'user', content: 'hi' }], SAMPLERS))
    await p.chatWithTools('gemma3:4b', [{ role: 'user', content: 'hi' }], [], SAMPLERS)
    const chats = bodies.filter((b) => Array.isArray(b.messages))
    expect(chats).toHaveLength(2)
    for (const chat of chats) {
      expect(chat.options).toMatchObject({ min_p: 0.05, repeat_penalty: 1.1, presence_penalty: 0.3, frequency_penalty: 0.2 })
      expect(JSON.stringify(chat)).not.toContain('dry')
    }
  })
})

describe('Anthropic', () => {
  it('sends none of them', async () => {
    vi.resetModules()
    const bodies: Body[] = []
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url: FetchArgs[0], init: FetchArgs[1]) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as Body)
      return new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }), { status: 200 })
    })
    const { AnthropicProvider } = await import('../anthropic-provider')
    const p = new AnthropicProvider({
      id: 'anthropic', name: 'Anthropic', enabled: true, baseUrl: 'https://api.anthropic.com', apiKey: 'k', isLocal: false,
    })
    await p.chatWithTools('claude-x', [{ role: 'user', content: 'hi' }], [], { ...SAMPLERS, temperature: 0.5 }).catch(() => undefined)
    const body = bodies[0]
    expect(body).toBeDefined()
    expect(body.temperature).toBe(0.5)
    for (const key of ['min_p', 'repeat_penalty', 'repetition_penalty', 'presence_penalty', 'frequency_penalty', 'dry_multiplier']) {
      expect(key in body, key).toBe(false)
    }
  })
})
