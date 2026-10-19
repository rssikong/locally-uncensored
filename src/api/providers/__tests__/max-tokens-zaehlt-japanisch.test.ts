/**
 * GH #167: the max_tokens headroom on an OpenAI compatible server counted
 * the prompt as chars / 4. A Japanese prompt costs about 1.4 characters per
 * token on Gemma (measured in the issue), so the headroom came out about
 * 2.8 times too generous: prompt plus max_tokens ran past the window the
 * server had loaded.
 *
 * The network is mocked; the /props shape is llama.cpp's, as in
 * openai-context-source.test.ts.
 *
 * Run: npx vitest run src/api/providers/__tests__/max-tokens-zaehlt-japanisch.test.ts
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

const localFetch = vi.fn()
const localFetchStream = vi.fn()

vi.mock('../../backend', async () => {
  const actual = await vi.importActual<typeof import('../../backend')>('../../backend')
  return {
    ...actual,
    isTauri: () => false,
    localFetch: (...a: Parameters<typeof import('../../backend').localFetch>) => localFetch(...a),
    localFetchStream: (...a: Parameters<typeof import('../../backend').localFetchStream>) => localFetchStream(...a),
    ensureProxyAllowsHost: async () => {},
  }
})

import { OpenAIProvider, __clearContextCatalogForTests } from '../openai-provider'
import type { ChatStreamChunk } from '../types'
import { useSettingsStore } from '../../../stores/settingsStore'

const WINDOW = 16384
const JA = '今日はとても良い天気ですね。私は公園で本を読みながら、ゆっくりとコーヒーを飲みました。'

beforeEach(() => {
  useSettingsStore.getState().updateSettings({ contextWindowByModel: {} })
  __clearContextCatalogForTests()
  localFetch.mockImplementation(async (url: string) =>
    String(url).endsWith('/props')
      ? new Response(JSON.stringify({ default_generation_settings: { n_ctx: WINDOW } }), { status: 200 })
      : new Response('{"error":"not found"}', { status: 404 }))
  localFetchStream.mockResolvedValue(new Response('data: [DONE]\n\n', { status: 200 }))
})

afterEach(() => {
  localFetch.mockReset()
  localFetchStream.mockReset()
  __clearContextCatalogForTests()
})

async function drain(gen: AsyncGenerator<ChatStreamChunk>) {
  for await (const _c of gen) void _c
}

describe('GH #167: max_tokens on a Japanese prompt', () => {
  it('prompt plus max_tokens stays inside the loaded window', async () => {
    const provider = new OpenAIProvider({
      id: 'openai', name: 'llama.cpp', enabled: true, baseUrl: 'http://127.0.0.1:8167', apiKey: '', isLocal: true,
    })
    // About 13,000 real Gemma tokens (1.4 characters per token).
    const prompt = JA.repeat(Math.ceil((13000 * 1.4) / JA.length))
    const realPrompt = Math.ceil(prompt.length / 1.4)

    await drain(provider.chatStream('gemma', [{ role: 'user', content: prompt }]))

    const body = JSON.parse(String(localFetchStream.mock.calls[0][1].body))
    const cap = body.max_tokens as number
    expect(typeof cap).toBe('number')
    // chars / 4 left about 11,000 tokens of headroom here.
    expect(realPrompt + cap).toBeLessThanOrEqual(WINDOW)
  })
})
