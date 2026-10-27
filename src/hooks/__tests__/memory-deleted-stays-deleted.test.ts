/**
 * A27 (3.0.8): a memory the user deleted does not come back on the next turn.
 *
 * The extractor reads the latest exchange. When that exchange still talks
 * about the deleted fact, it used to find no existing memory for it and wrote
 * it again, so "delete" lasted until the next answer. This runs the real
 * `extractMemoriesFromPair` against the REAL memory store, with only the model
 * and the embeddings mocked: the model returns the deleted fact again.
 *
 * NEGATIVE CONTROL (by hand): drop the `isForgotten(...) continue` in
 * useMemory.ts AND the `opts?.auto` check in memoryStore.addMemory, and
 * "the deleted fact is not written back" goes red. Either one alone keeps it
 * green, on purpose: the loop guard also keeps the merge band from carrying
 * the fact into another memory.
 *
 * Run: npx vitest run src/hooks/__tests__/memory-deleted-stays-deleted.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const chatStream = vi.fn()

vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ activeModel: 'qwen3:8b', models: [{ name: 'qwen3:8b', type: 'text' }] }) },
}))
vi.mock('../../stores/providerStore', () => ({
  useProviderStore: { getState: () => ({ providers: { openai: { enabled: true, isLocal: true }, anthropic: { enabled: false } } }) },
}))
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { memoryCloudOptIn: false, contextWindowOverride: 0 } }) },
}))
vi.mock('../../api/providers', () => ({
  getProviderForModel: (name: string) => ({ provider: { chatStream }, modelId: name }),
  getProviderIdFromModel: () => 'ollama',
}))
// No embeddings: every write takes the plain-add path, the one a deleted fact
// would come back through.
vi.mock('../../api/rag', () => ({
  generateEmbeddings: vi.fn(async () => [[]]),
  cosineSimilarity: vi.fn(() => 0),
}))

const { extractMemoriesFromPair } = await import('../useMemory')
const { useMemoryStore, __setMemoryEmbedFn } = await import('../../stores/memoryStore')

const LONG_REPLY = 'x'.repeat(200)
const fact = { type: 'project', title: 'Garden controller', description: 'Garden', content: 'The user builds a garden irrigation controller', tags: [] }

function answer(memories: unknown[]) {
  chatStream.mockImplementation(() => (async function* () {
    yield { content: JSON.stringify({ shouldSave: true, memories }), done: true }
  })())
}

/** The extractor runs every third turn; three turns hold exactly one run. */
async function nextTurns() {
  for (let i = 0; i < 3; i++) await extractMemoriesFromPair('how is my garden project going?', LONG_REPLY, 'conv-1', {})
}

beforeEach(() => {
  chatStream.mockReset()
  __setMemoryEmbedFn(async (texts: string[]) => texts.map(() => []))
  useMemoryStore.setState({ entries: [], forgotten: [], activeMemoryOwner: null })
  useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: true, autoExtractInAllModes: true })
})

describe('deleted memory and the next turn', () => {
  it('the extractor writes the fact once (control)', async () => {
    answer([fact])
    await nextTurns()
    expect(useMemoryStore.getState().entries.map(e => e.title)).toEqual(['Garden controller'])
  })

  it('the deleted fact is not written back', async () => {
    answer([fact])
    await nextTurns()
    const [entry] = useMemoryStore.getState().entries
    useMemoryStore.getState().removeMemory(entry.id)

    answer([fact, { ...fact, title: 'Editor', content: 'The user writes code in Helix' }])
    await nextTurns()
    expect(chatStream).toHaveBeenCalledTimes(2)
    expect(useMemoryStore.getState().entries.map(e => e.title)).toEqual(['Editor'])
    expect(useMemoryStore.getState().getMemoriesForPrompt('', 32768)).not.toContain('irrigation')
  })

  it('after Delete all, nothing deleted comes back', async () => {
    answer([fact, { ...fact, title: 'Editor', content: 'The user writes code in Helix' }])
    await nextTurns()
    expect(useMemoryStore.getState().entries).toHaveLength(2)
    useMemoryStore.getState().clearAll()
    await nextTurns()
    expect(useMemoryStore.getState().entries).toEqual([])
  })
})
