/**
 * Discord 22.10.2026: the tokens under an answer come from the backend's own
 * numbers, and they reach the done chunk on every transport. This pins the
 * shapes the line under the answer reads (lib/request-usage.ts):
 *   - OpenAI compatible (LU Engine, LU Cloud, LM Studio): the include_usage
 *     chunk arrives AFTER finish_reason with an empty choices[], and also on
 *     a stream that ends without [DONE].
 *   - LU Cloud's billing header travels with the done chunk and with a
 *     non streaming tool turn.
 *   - Ollama: prompt_eval_count/eval_count on the final NDJSON line.
 *   - A backend that reports nothing yields no numbers, not zeros.
 *
 * Run: npx vitest run src/api/providers/__tests__/request-usage-reaches-the-done-chunk.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ChatStreamChunk } from '../types'

vi.mock('../../backend', () => ({
  isTauri: () => false,
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: vi.fn(),
  ollamaUrl: (path: string) => `/api${path}`,
  backendCall: vi.fn(),
  isPrivateOrLanHost: () => false,
  isDirectFetchAllowed: () => true,
  hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(),
}))

import { OpenAIProvider } from '../openai-provider'
import { OllamaProvider } from '../ollama-provider'
import { localFetchStream } from '../../backend'

afterEach(() => vi.unstubAllGlobals())

const sse = (events: unknown[], done = true): string =>
  events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + (done ? 'data: [DONE]\n\n' : '')

const cloud = () => new OpenAIProvider({
  id: 'openai', name: 'LU Cloud', enabled: true, isLocal: false, apiKey: 'x', baseUrl: 'https://lu-labs.test/api/inference/v1',
})

async function doneOf(provider: OpenAIProvider, body: string, headers: Record<string, string> = {}): Promise<ChatStreamChunk> {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { headers: { 'Content-Type': 'text/event-stream', ...headers } })))
  let done: ChatStreamChunk | undefined
  for await (const c of provider.chatStream('some-model', [{ role: 'user', content: 'hi' }])) if (c.done) done = c
  if (!done) throw new Error('no done chunk')
  return done
}

describe('OpenAI compatible stream', () => {
  it('reads the usage chunk that comes after finish_reason, and the billing header', async () => {
    const done = await doneOf(cloud(), sse([
      { choices: [{ index: 0, delta: { content: 'Hello' } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 1234, completion_tokens: 56, total_tokens: 1290 } },
    ]), { 'x-lu-chat-billing': 'flash', 'x-lu-flash-remaining': '40000' })
    expect(done).toMatchObject({ promptEvalCount: 1234, evalCount: 56, billing: 'flash', finishReason: 'stop' })
  })

  it('keeps the numbers on a stream that ends without [DONE]', async () => {
    const done = await doneOf(cloud(), sse([
      { choices: [{ index: 0, delta: { content: 'Hi' } }] },
      { choices: [], usage: { prompt_tokens: 20, completion_tokens: 3 } },
    ], false))
    expect(done.promptEvalCount).toBe(20)
    expect(done.evalCount).toBe(3)
  })

  it('a server without usage and without the header reports nothing', async () => {
    const done = await doneOf(cloud(), sse([
      { choices: [{ index: 0, delta: { content: 'Hi' }, finish_reason: 'stop' }] },
    ]))
    expect(done.promptEvalCount).toBeUndefined()
    expect(done.evalCount).toBeUndefined()
    expect(done.billing).toBeUndefined()
  })

  it('an unknown billing word is not passed on', async () => {
    const done = await doneOf(cloud(), sse([
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 1 } },
    ]), { 'x-lu-chat-billing': 'maybe' })
    expect(done.billing).toBeUndefined()
  })

  it('a non streaming tool turn carries usage and billing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: 'done' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 900, completion_tokens: 40 },
    }), { headers: { 'Content-Type': 'application/json', 'x-lu-chat-billing': 'credits', 'x-lu-flash-remaining': '0' } })))
    const turn = await cloud().chatWithTools('some-model', [{ role: 'user', content: 'hi' }], [])
    expect(turn).toMatchObject({ promptEvalCount: 900, evalCount: 40, billing: 'credits' })
  })
})

describe('Ollama stream', () => {
  const ollama = () => new OllamaProvider({
    id: 'ollama', name: 'Ollama', enabled: true, baseUrl: 'http://localhost:11434', apiKey: '', isLocal: true,
  })
  const run = async (lines: string[]): Promise<ChatStreamChunk> => {
    ;(localFetchStream as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(lines.join('\n') + '\n', { status: 200 }))
    let done: ChatStreamChunk | undefined
    for await (const c of ollama().chatStream('qwen2.5:0.5b', [{ role: 'user', content: 'hi' }])) if (c.done) done = c
    if (!done) throw new Error('no done chunk')
    return done
  }

  it('reads prompt_eval_count and eval_count off the final line', async () => {
    const done = await run([
      '{"message":{"content":"Hel"},"done":false}',
      '{"message":{"content":"lo"},"done":false}',
      '{"message":{"content":""},"done":true,"done_reason":"stop","prompt_eval_count":31,"eval_count":9}',
    ])
    expect(done.promptEvalCount).toBe(31)
    expect(done.evalCount).toBe(9)
    expect(done.billing).toBeUndefined()
  })

  it('a final line without counts reports none', async () => {
    const done = await run(['{"message":{"content":"x"},"done":true,"done_reason":"stop"}'])
    expect(done.promptEvalCount).toBeUndefined()
    expect(done.evalCount).toBeUndefined()
  })
})
