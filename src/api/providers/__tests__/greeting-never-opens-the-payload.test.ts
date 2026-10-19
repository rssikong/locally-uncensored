/**
 * A character card chat opens on the character's greeting, an assistant
 * message with no user turn before it (3.0.7). Gemma and Mistral style
 * templates raise on that ("Conversation roles must alternate"), and so does
 * Anthropic's API. normalize-system's userTurnFirst puts a short user line in
 * front on the way out; this file checks, for every way the history reaches a
 * backend, that the first non-system message of the body is never an
 * assistant one, and that the greeting itself still goes out unchanged.
 *
 * Run: npx vitest run src/api/providers/__tests__/greeting-never-opens-the-payload.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { applyTemplateContract, userTurnFirst } from '../normalize-system'
import type { ChatMessage, ProviderConfig, ToolDefinition } from '../types'

type CapturedInit = { body?: string }
type Wire = { messages: { role: string; content?: unknown }[] }

const GREETING = '*Mira lowers the lantern.* You are awake, User.'
const RP_CHAT: ChatMessage[] = [
  { role: 'system', content: "Write Mira's next reply in a fictional chat between Mira and User." },
  { role: 'assistant', content: GREETING },
  { role: 'user', content: 'Where am I?' },
]
const TOOL: ToolDefinition[] = [
  { type: 'function', function: { name: 'web_search', description: '', parameters: { type: 'object', properties: {}, required: [] } } },
]

function firstTurn(messages: { role: string; content?: unknown }[]) {
  return messages.find((m) => m.role !== 'system')
}

/** The body opens on a user turn, and the greeting is still in it. */
function expectLegal(wire: Wire) {
  expect(firstTurn(wire.messages)?.role).toBe('user')
  const assistant = wire.messages.find((m) => m.role === 'assistant')
  expect(JSON.stringify(assistant?.content)).toContain('Mira lowers the lantern')
  expect(wire.messages.at(-1)?.role).toBe('user')
}

describe('userTurnFirst', () => {
  it('NEGATIVE CONTROL: the raw history opens on the assistant greeting', () => {
    expect(firstTurn(RP_CHAT)?.role).toBe('assistant')
  })

  it('puts a user line in front of an opening assistant turn, behind the system message', () => {
    const out = userTurnFirst(RP_CHAT)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(out[2]).toBe(RP_CHAT[1])
    expect(userTurnFirst([{ role: 'assistant', content: 'hi' }]).map((m) => m.role)).toEqual(['user', 'assistant'])
  })

  it('returns the same array when a user turn already leads, or there is no turn', () => {
    const fine = [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }]
    expect(userTurnFirst(fine)).toBe(fine)
    const onlySystem = [{ role: 'system', content: 's' }]
    expect(userTurnFirst(onlySystem)).toBe(onlySystem)
  })

  it('holds on both contracts, also where alternation is off', () => {
    for (const contract of [
      { toolRole: 'text', alternate: true },
      { toolRole: 'native', alternate: false },
    ] as const) {
      const out = applyTemplateContract(RP_CHAT, contract)
      expect(firstTurn(out)?.role).toBe('user')
      expect(out.filter((m) => m.role === 'user' && m.content !== 'Where am I?')).toHaveLength(1)
    }
  })
})

// ── Every provider path ───────────────────────────────────────

const backendMock = (capture: (url: string, init: CapturedInit) => Response, lan: boolean) => ({
  isTauri: () => false,
  localFetch: vi.fn(async (url: string, init: CapturedInit) => capture(url, init)),
  localFetchStream: vi.fn(async (url: string, init: CapturedInit) => capture(url, init)),
  ollamaUrl: (path: string) => `http://localhost:11434/api${path}`,
  backendCall: vi.fn(),
  isPrivateOrLanHost: () => lan,
  isDirectFetchAllowed: () => false,
  hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(),
})

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } })

function captureOpenAI(lan: boolean, managed = false): Wire[] {
  const bodies: Wire[] = []
  vi.doMock('../../backend', () =>
    backendMock((url, init) => {
      if (url.includes('/chat/completions') && typeof init.body === 'string') {
        bodies.push(JSON.parse(init.body) as Wire)
        return okJson({ choices: [{ message: { content: 'ok' } }] })
      }
      return new Response('{}', { status: 404 })
    }, lan),
  )
  vi.doMock('../../builtin-ensure', () => ({
    ensureBuiltinEngineAlive: vi.fn(),
    explainDeadEngine: (e: unknown) => e,
    explainEngineTransportMessage: (e: unknown) => e,
    isManagedBuiltinSlot: () => managed,
  }))
  return bodies
}

function captureOllama(): Wire[] {
  const bodies: Wire[] = []
  vi.doMock('../../backend', () =>
    backendMock((url, init) => {
      if (url.endsWith('/chat') && typeof init.body === 'string') bodies.push(JSON.parse(init.body) as Wire)
      return new Response('{"message":{"content":"ok"},"done":true}\n')
    }, true),
  )
  return bodies
}

async function drain(stream: AsyncGenerator<unknown>) {
  try { for await (const chunk of stream) void chunk } catch { /* only the body matters here */ }
}

const cfg = (baseUrl: string, isLocal: boolean): ProviderConfig => ({
  id: 'openai', name: 'test', enabled: true, apiKey: '', baseUrl, isLocal,
})

afterEach(() => {
  vi.doUnmock('../../backend')
  vi.doUnmock('../../builtin-ensure')
  vi.doUnmock('../../cloud/supabase')
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('the body every backend receives for a role play chat', () => {
  it('LU Engine (built-in llama.cpp), stream and tool call, with and without tools', async () => {
    vi.resetModules()
    const bodies = captureOpenAI(true, true)
    const { OpenAIProvider } = await import('../openai-provider')
    const p = new OpenAIProvider(cfg('http://127.0.0.1:8127/v1', true))
    await drain(p.chatStream('gemma-4', RP_CHAT))
    await p.chatWithTools('gemma-4', RP_CHAT, [])
    await p.chatWithTools('gemma-4', RP_CHAT, TOOL)
    expect(bodies).toHaveLength(3)
    bodies.forEach(expectLegal)
  })

  it('an OpenAI compatible server on the LAN (LM Studio and friends)', async () => {
    vi.resetModules()
    const bodies = captureOpenAI(true)
    const { OpenAIProvider } = await import('../openai-provider')
    const p = new OpenAIProvider(cfg('http://localhost:1234/v1', true))
    await drain(p.chatStream('mistral', RP_CHAT))
    await p.chatWithTools('mistral', RP_CHAT, TOOL)
    expect(bodies).toHaveLength(2)
    bodies.forEach(expectLegal)
  })

  it('a cloud OpenAI compatible endpoint, where nothing else is rewritten', async () => {
    vi.resetModules()
    const bodies = captureOpenAI(false)
    const { OpenAIProvider } = await import('../openai-provider')
    const p = new OpenAIProvider(cfg('https://api.example-cloud.com/v1', false))
    await drain(p.chatStream('m', RP_CHAT))
    await p.chatWithTools('m', RP_CHAT, TOOL)
    expect(bodies).toHaveLength(2)
    bodies.forEach(expectLegal)
  })

  it('LU Cloud', async () => {
    vi.resetModules()
    const bodies = captureOpenAI(false)
    vi.doMock('../../cloud/supabase', () => ({ getAccessToken: async () => 'token' }))
    const { LuCloudProvider } = await import('../lu-cloud-provider')
    const p = new LuCloudProvider({ ...cfg('', false), id: 'lu-cloud' as ProviderConfig['id'] })
    await drain(p.chatStream('m', RP_CHAT))
    await p.chatWithTools('m', RP_CHAT, TOOL)
    expect(bodies).toHaveLength(2)
    bodies.forEach(expectLegal)
  })

  it('Ollama, stream, tool call with native tools, and the agent stream', async () => {
    vi.resetModules()
    const bodies = captureOllama()
    const { OllamaProvider } = await import('../ollama-provider')
    const p = new OllamaProvider({
      id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true,
    })
    await drain(p.chatStream('gemma4:12b', RP_CHAT))
    await p.chatWithTools('gemma4:12b', RP_CHAT, TOOL).catch(() => undefined)
    const { streamOllamaChatWithTools } = await import('../../../lib/ollama-stream-tools')
    await streamOllamaChatWithTools('gemma4:12b', RP_CHAT, TOOL, {}, () => {}, () => {}).catch(() => undefined)
    expect(bodies).toHaveLength(3)
    bodies.forEach(expectLegal)
  })

  it('Anthropic style endpoint', async () => {
    vi.resetModules()
    const bodies: Wire[] = []
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      if (typeof init?.body === 'string') bodies.push(JSON.parse(init.body) as Wire)
      return okJson({ content: [{ type: 'text', text: 'ok' }], usage: { input_tokens: 1, output_tokens: 1 } })
    }))
    const { AnthropicProvider } = await import('../anthropic-provider')
    const p = new AnthropicProvider({
      id: 'anthropic', name: 'Anthropic', enabled: true, baseUrl: 'https://api.anthropic.com', apiKey: 'k', isLocal: false,
    })
    await p.chatWithTools('claude-x', RP_CHAT, [])
    await drain(p.chatStream('claude-x', RP_CHAT))
    expect(bodies.length).toBeGreaterThanOrEqual(1)
    bodies.forEach(expectLegal)
  })
})
