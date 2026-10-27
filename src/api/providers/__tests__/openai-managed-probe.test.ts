/**
 * The context probe and the built-in engine.
 *
 * Seen on the first start on four phones (mobile-docs/r2/rust.md 3.2): before
 * the first answer the page asked five addresses of an engine that was not
 * listening yet, two of them paths a llama-server never has. Each one was a
 * refused connection and an error line in the console.
 *
 * The rule now: a managed engine is asked only while it runs, and only what a
 * llama-server knows (`/props`, then the model list). Every other backend
 * keeps the full cascade.
 *
 * Run: npx vitest run src/api/providers/__tests__/openai-managed-probe.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

const localFetch = vi.fn()
const backendCall = vi.fn()

vi.mock('../../backend', async () => {
  const actual = await vi.importActual<typeof import('../../backend')>('../../backend')
  return {
    ...actual,
    isTauri: () => false,
    localFetch: (...a: Parameters<typeof import('../../backend').localFetch>) => localFetch(...a),
    backendCall: (...a: unknown[]) => backendCall(...a),
    ensureProxyAllowsHost: async () => {},
  }
})

import { OpenAIProvider } from '../openai-provider'
import type { ProviderConfig } from '../types'

function engine(port: number, managed = true): ProviderConfig {
  return { id: 'openai', name: 'LU Engine', enabled: true, baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: '', isLocal: true, managed }
}

const paths = () => localFetch.mock.calls.map(([url]) => new URL(String(url)).pathname)
const props = (ctx: number) => new Response(JSON.stringify({ default_generation_settings: { n_ctx: ctx } }), { status: 200 })

afterEach(() => {
  localFetch.mockReset()
  backendCall.mockReset()
})

describe('the context probe of the built-in engine', () => {
  it('asks nothing while the engine is not running, and asks again once it runs', async () => {
    const provider = new OpenAIProvider(engine(18127))
    backendCall.mockResolvedValue({ running: false })
    localFetch.mockRejectedValue(new Error('connection refused'))
    await provider.getContextLength('SmolLM2-360M-Instruct-Q4_K_M')
    expect(paths()).toEqual([])

    // The empty answer was not kept: the same model is asked for real after the start.
    backendCall.mockResolvedValue({ running: true })
    localFetch.mockImplementation(async () => props(4096))
    expect(await provider.getContextLength('SmolLM2-360M-Instruct-Q4_K_M')).toBe(4096)
    expect(paths()).toEqual(['/props'])
  })

  it('never asks the paths of LM Studio, KoboldCpp or a model row', async () => {
    const provider = new OpenAIProvider(engine(18128))
    backendCall.mockResolvedValue({ running: true })
    localFetch.mockImplementation(async () => new Response('{}', { status: 404 }))
    await provider.getContextLength('some-model')
    expect(paths()).toEqual(['/props', '/v1/models'])
  })

  it('a status that cannot be read does not silence the probe', async () => {
    const provider = new OpenAIProvider(engine(18129))
    backendCall.mockRejectedValue(new Error('no such command'))
    localFetch.mockImplementation(async () => props(8192))
    expect(await provider.getContextLength('some-model')).toBe(8192)
  })

  it('a backend the app does not manage keeps the whole cascade', async () => {
    const provider = new OpenAIProvider(engine(18130, false))
    localFetch.mockImplementation(async () => new Response('{}', { status: 404 }))
    await provider.getContextLength('some-model')
    expect(paths()).toEqual(['/api/v0/models/some-model', '/v1/models/some-model', '/props', '/v1/models', '/api/extra/true_max_context_length'])
    expect(backendCall).not.toHaveBeenCalledWith('bundled_engine_status')
  })
})
