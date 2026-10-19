/**
 * Issue 177, Windows run d307-j: Chat Reply Timeout at 30 s against a local
 * OpenAI-compatible server that sent nothing. The proxy ended each wait at
 * 30 s, but the app sent the request three times and showed the error after
 * 98 s. backend.ts now answers the spent window with a 504 carrying
 * `first_reply_timeout`, and that answer is final for the provider's own
 * retry and for the agent's ladder.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { ProviderConfig } from '../types'
import { isTerminalModelError } from '../../../lib/http-status'

const timeoutBody = JSON.stringify({
  error: 'the backend accepted the request but sent nothing for 30 s. A very large model or a very long prompt can take this long; raise Chat Reply Timeout in Settings, General, or restart the backend if it is not working.',
  code: 'first_reply_timeout',
})

afterEach(() => { vi.unstubAllGlobals(); vi.resetModules() })

describe('a first reply timeout from a local server', () => {
  it('is sent once, keeps its sentence and code, and is terminal', async () => {
    vi.resetModules()
    const calls: string[] = []
    const respond = (url: string) => {
      if (!url.includes('/chat/completions')) return new Response('{}', { status: 404 })
      calls.push(url)
      return new Response(timeoutBody, { status: 504, headers: { 'Content-Type': 'application/json' } })
    }
    vi.stubGlobal('fetch', vi.fn(async (u: string) => respond(String(u))))
    vi.doMock('../../backend', () => ({
      isTauri: () => true,
      localFetch: vi.fn(async (url: string) => respond(url)),
      localFetchStream: vi.fn(async (url: string) => respond(url)),
      ollamaUrl: (path: string) => `http://localhost:11434/api${path}`,
      backendCall: vi.fn(),
      isPrivateOrLanHost: () => true,
      isDirectFetchAllowed: () => false,
      hostnameOf: (url: string) => new URL(url).hostname,
      ensureProxyAllowsHost: vi.fn(),
    }))
    const { OpenAIProvider } = await import('../openai-provider')
    const config: ProviderConfig = {
      id: 'openai', name: 'vLLM', enabled: true, apiKey: '', baseUrl: 'http://localhost:8000/v1', isLocal: true,
    }
    const p = new OpenAIProvider(config)
    let err: unknown = null
    try {
      for await (const chunk of p.chatStream('d307j-stub-a', [{ role: 'user', content: 'go' }])) { void chunk }
    } catch (e) { err = e }
    expect(err).not.toBeNull()
    expect(calls).toHaveLength(1)
    expect((err as { code?: string }).code).toBe('first_reply_timeout')
    expect((err as Error).message).toContain('sent nothing for 30 s')
    expect(isTerminalModelError(err)).toBe(true)
  })
})
