/**
 * GH #166: a server behind the Ollama API that names no context length.
 *
 * KoboldCpp started with 262144 and reached through its Ollama emulation
 * answers `/api/show` with an empty `model_info`. LU read that as 4096: the
 * picker offered "Auto · 4K" and "4K · max" only, and the history of a long
 * chat was trimmed to a fraction of 4096 while num_ctx 262144 (from Settings)
 * went out with every request.
 *
 * The answers below are built after the report and after KoboldCpp's own API
 * (`/api/extra/true_max_context_length` answers `{ "value": N }`). No server
 * runs here.
 *
 * Run: npx vitest run src/api/__tests__/ein-server-ohne-kontextlaenge.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { forgetSentWindows, getModelContext, getModelContextInfo, ollamaNumCtx } from '../ollama'
import { getChatWindowTokens } from '../../lib/context-compaction'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_CONTEXT_CAP } from '../../lib/context-window'

type Routes = Record<string, unknown>

/** A fake server: path to JSON body. A path that is not listed answers 404. */
function serve(routes: Routes) {
  const calls: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    calls.push(path)
    if (path in routes) {
      return new Response(JSON.stringify(routes[path]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('404 page not found', { status: 404 })
  }))
  return calls
}

/** KoboldCpp's /api/show, as the report describes it: no length anywhere. */
const KOBOLD_SHOW = { model_info: {}, details: { format: 'gguf' }, modelfile: '', parameters: '', template: '' }

beforeEach(() => {
  forgetSentWindows()
  useSettingsStore.getState().updateSettings({ contextWindowOverride: 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the length of a model whose /api/show says nothing', () => {
  it('is read from KoboldCpp on the same port', async () => {
    serve({
      '/api/show': KOBOLD_SHOW,
      '/api/extra/true_max_context_length': { value: 262144 },
    })
    // The old code answered 4096 here.
    expect(await getModelContext('koboldcpp/gemma4')).toBe(262144)
  })

  it('falls back to the KoboldAI config endpoint', async () => {
    serve({
      '/api/show': KOBOLD_SHOW,
      '/api/v1/config/max_context_length': { value: 131072 },
    })
    expect(await getModelContextInfo('koboldcpp/gemma4')).toMatchObject({ max: 131072, known: true })
  })

  it('falls back to the window /api/ps reports the model loaded with', async () => {
    serve({
      '/api/show': KOBOLD_SHOW,
      '/api/ps': { models: [{ name: 'koboldcpp/gemma4', size: 1, size_vram: 1, context_length: 65536 }] },
    })
    expect(await getModelContextInfo('koboldcpp/gemma4')).toMatchObject({ max: 65536, known: true })
  })

  it('says it does not know when nobody names a length', async () => {
    serve({ '/api/show': KOBOLD_SHOW, '/api/ps': { models: [] } })
    expect(await getModelContextInfo('koboldcpp/gemma4')).toMatchObject({ max: 4096, known: false })
  })

  it('still reads Ollama itself first, and asks nothing else', async () => {
    const calls = serve({
      '/api/show': { model_info: { 'qwen2.context_length': 32768 }, parameters: '' },
      '/api/extra/true_max_context_length': { value: 999999 },
    })
    expect(await getModelContextInfo('qwen2.5:7b')).toMatchObject({ max: 32768, known: true })
    expect(calls).toEqual(['/api/show'])
  })
})

describe('the history budget is the window that is sent', () => {
  it('uses "Context window (Ollama)" when the server names no length', async () => {
    serve({ '/api/show': KOBOLD_SHOW, '/api/ps': { models: [] } })
    useSettingsStore.getState().updateSettings({ contextWindowOverride: 262144 })
    const sent = await ollamaNumCtx('koboldcpp/gemma4', 'chat')
    expect(sent).toBe(262144)
    // The old budget read the model's maximum, the stand in 4096.
    expect(await getChatWindowTokens('koboldcpp/gemma4')).toBe(sent)
  })

  it('is the chat num_ctx, not the trained maximum, without a setting', async () => {
    serve({ '/api/show': { model_info: { 'llama.context_length': 131072 } } })
    const sent = await ollamaNumCtx('llama3.1:8b', 'chat')
    expect(sent).toBe(DEFAULT_CONTEXT_CAP)
    // The old budget was 0.8 of 131072 against a request of 16384: Ollama
    // cut the front of the history itself.
    expect(await getChatWindowTokens('llama3.1:8b')).toBe(sent)
  })
})
