/**
 * GH #165: the group menu only listed models from the current model list, so
 * a member whose model had left the list was invisible: still counted ("3
 * models" next to two highlighted rows), still taking turns, and impossible
 * to untick without bringing the model back first.
 *
 * Also GH #165: a server that answers Ollama's /api/tags with the same model
 * twice (KoboldCpp in Ollama mode) put two identical rows into the picker,
 * the Models tab and the group menu; ticking one ticked both and the header
 * counted it twice.
 *
 * Run: npx vitest run src/lib/__tests__/group-chat-unavailable-rows.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { groupChatRows, unavailableGroupMembers } from '../group-chat'
import type { AIModel } from '../../types/models'

const text = (name: string): AIModel =>
  ({ name, model: name, size: 1, type: 'text', provider: 'openai', providerName: 'LM Studio' }) as AIModel

const LISTED = [text('gemma-4-31b-it-2'), text('koboldcpp/baron')]

describe('unavailableGroupMembers', () => {
  it('names the members whose model is not in the loaded list', () => {
    expect(unavailableGroupMembers(['gemma-4-31b-it-2', 'gemma-4-ortenzya', 'koboldcpp/baron'], LISTED, true))
      .toEqual(['gemma-4-ortenzya'])
  })

  it('judges nobody before a list has landed, or when the list came back empty', () => {
    expect(unavailableGroupMembers(['a', 'b'], LISTED, false)).toEqual([])
    expect(unavailableGroupMembers(['a', 'b'], [], true)).toEqual([])
  })
})

describe('groupChatRows', () => {
  it('shows a member whose model left the list, marked unavailable, after the listed ones', () => {
    const rows = groupChatRows(LISTED, ['gemma-4-ortenzya', 'gemma-4-31b-it-2'], true)
    expect(rows).toEqual([
      { name: 'gemma-4-31b-it-2', unavailable: false },
      { name: 'koboldcpp/baron', unavailable: false },
      { name: 'gemma-4-ortenzya', unavailable: true },
    ])
  })

  it('one row per model, even when the list carries the same name twice', () => {
    const rows = groupChatRows([...LISTED, text('koboldcpp/baron')], ['koboldcpp/baron'], true)
    expect(rows.map((r) => r.name)).toEqual(['gemma-4-31b-it-2', 'koboldcpp/baron'])
  })

  it('NEGATIVE CONTROL: before the list has landed no member is called unavailable', () => {
    const rows = groupChatRows([], ['gemma-4-ortenzya'], false)
    expect(rows).toEqual([{ name: 'gemma-4-ortenzya', unavailable: false }])
  })
})

describe('Ollama /api/tags with the same model twice', () => {
  const TAGS = {
    models: [
      { name: 'koboldcpp/baron', model: 'koboldcpp/baron', size: 1, digest: 'a', modified_at: 'x' },
      { name: 'koboldcpp/baron', model: 'koboldcpp/baron', size: 1, digest: 'a', modified_at: 'x' },
      { name: 'other:7b', model: 'other:7b', size: 1, digest: 'b', modified_at: 'x' },
    ],
  }
  afterEach(() => { vi.doUnmock('../../api/backend'); vi.resetModules() })

  async function withTags() {
    vi.resetModules()
    vi.doMock('../../api/backend', () => ({
      localFetch: vi.fn(async () => ({ ok: true, json: async () => TAGS })),
      localFetchStream: vi.fn(),
      ollamaUrl: (p: string) => `http://127.0.0.1:11434/api${p}`,
      isTauri: () => false,
    }))
  }

  it('the list the app reads has one row per name', async () => {
    await withTags()
    const { listModels } = await import('../../api/ollama')
    expect((await listModels()).map((m) => m.name)).toEqual(['koboldcpp/baron', 'other:7b'])
  })

  it('the provider class lists one row per name too', async () => {
    await withTags()
    const { OllamaProvider } = await import('../../api/providers/ollama-provider')
    const provider = new OllamaProvider({ id: 'ollama', name: 'Ollama', baseUrl: 'http://127.0.0.1:11434', apiKey: '', enabled: true, isLocal: true })
    expect((await provider.listModels()).map((m) => m.name)).toEqual(['koboldcpp/baron', 'other:7b'])
  })
})
