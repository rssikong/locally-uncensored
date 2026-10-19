/**
 * Think budget (D12): which request carries a token budget, per backend.
 *
 * Only two backends take a count:
 *  - the bundled engine, llama-server b9949 (commit 049326a0), reads
 *    `thinking_budget_tokens` per request in tools/server/server-common.cpp;
 *  - Anthropic reads `thinking.budget_tokens` (at least 1024).
 * Everything else must not see a budget field at all: LM Studio, a user's own
 * OpenAI-compatible server, api.openai.com, the hosted endpoint and Ollama.
 * And with the setting on auto (0) every request stays byte for byte what it
 * was before the setting existed.
 *
 * Run: npx vitest run src/api/providers/__tests__/think-budget-payload.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ProviderConfig, ChatStreamChunk } from '../types'
import type { OpenAIChatRequest } from '../openai-provider'
import type { FetchArgs } from '../../__tests__/provider-test-support'

const streamBody = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'

type CapturedInit = { body?: string }

let sent: { url: string; body: OpenAIChatRequest }[]

function answer(url: string, init: CapturedInit) {
  if (typeof init.body !== 'string') throw new Error('request had no JSON body')
  const body = JSON.parse(init.body) as OpenAIChatRequest
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

const chatBodies = () => sent.filter((s) => s.url.endsWith('/chat/completions')).map((s) => s.body)

const ENGINE: ProviderConfig = {
  id: 'openai', name: 'LU Engine', apiKey: '', enabled: true,
  baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true,
}
const LM_STUDIO: ProviderConfig = {
  id: 'openai', name: 'LM Studio', apiKey: '', enabled: true,
  baseUrl: 'http://localhost:1234/v1', isLocal: true,
}
const OPENAI: ProviderConfig = {
  id: 'openai', name: 'OpenAI', apiKey: 'sk-test', enabled: true,
  baseUrl: 'https://api.openai.com/v1', isLocal: false,
}
const HOSTED: ProviderConfig = {
  id: 'lu-cloud', name: 'LU Cloud', apiKey: 'tok', enabled: true,
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

describe('LU Engine (bundled llama-server b9949)', () => {
  it('Think ON with a budget sends thinking_budget_tokens', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('tb-on', [{ role: 'user', content: 'hi' }], { thinking: true, thinkingBudget: 2048 }))
    expect(chatBodies()[0].thinking_budget_tokens).toBe(2048)
    // The template switch that turns thinking on still rides along.
    expect(chatBodies()[0].chat_template_kwargs).toEqual({ enable_thinking: true })
  })

  it('the tool turn carries it too', async () => {
    const p = await makeOpenAI(ENGINE)
    await p.chatWithTools('tb-tools', [{ role: 'user', content: 'hi' }], [], { thinking: true, thinkingBudget: 512 })
    expect(chatBodies()[0].thinking_budget_tokens).toBe(512)
  })

  it('auto (0) leaves the field out, exactly as before', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('tb-auto', [{ role: 'user', content: 'hi' }], { thinking: true, thinkingBudget: 0 }))
    expect('thinking_budget_tokens' in chatBodies()[0]).toBe(false)
  })

  it('Think OFF never sends a budget, a budget must not switch thinking on', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('tb-off', [{ role: 'user', content: 'hi' }], { thinking: false, thinkingBudget: 2048 }))
    expect('thinking_budget_tokens' in chatBodies()[0]).toBe(false)
  })

  it('a model without a think switch gets no budget either', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('tb-undef', [{ role: 'user', content: 'hi' }], { thinkingBudget: 2048 }))
    expect('thinking_budget_tokens' in chatBodies()[0]).toBe(false)
  })

  it('a fractional or negative value is cleaned before it reaches the wire', async () => {
    const p = await makeOpenAI(ENGINE)
    await drain(p.chatStream('tb-frac', [{ role: 'user', content: 'hi' }], { thinking: true, thinkingBudget: 300.7 }))
    await drain(p.chatStream('tb-neg', [{ role: 'user', content: 'hi' }], { thinking: true, thinkingBudget: -5 }))
    expect(chatBodies()[0].thinking_budget_tokens).toBe(300)
    expect('thinking_budget_tokens' in chatBodies()[1]).toBe(false)
  })
})

describe('backends without a budget field never see one', () => {
  for (const [name, config] of [
    ['LM Studio', LM_STUDIO],
    ['a user OpenAI-compatible endpoint (api.openai.com)', OPENAI],
    ['the hosted endpoint', HOSTED],
  ] as const) {
    it(name, async () => {
      const p = await makeOpenAI(config)
      await drain(p.chatStream('tb-none', [{ role: 'user', content: 'hi' }], { thinking: true, thinkingBudget: 3333 }))
      const body = chatBodies()[0]
      expect(body).toBeDefined()
      expect('thinking_budget_tokens' in body).toBe(false)
      expect(JSON.stringify(body)).not.toContain('3333')
    })
  }
})

describe('Ollama', () => {
  it('keeps think a plain switch and sends no count', async () => {
    vi.resetModules()
    const bodies: Record<string, unknown>[] = []
    const reply = (_url: string, init?: { body?: unknown }) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as Record<string, unknown>)
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
    await drain(p.chatStream('qwen3:8b', [{ role: 'user', content: 'hi' }], { thinking: true, thinkingBudget: 3333 }))
    const chat = bodies.find((b) => Array.isArray(b.messages))
    expect(chat?.think).toBe(true)
    expect(JSON.stringify(chat)).not.toContain('3333')
    expect(JSON.stringify(chat)).not.toContain('budget')
  })
})
