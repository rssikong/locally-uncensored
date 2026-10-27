/**
 * A7: the auto-memory extraction is a PAID call on lu-cloud, so it only fires
 * with the explicit opt-in, and then on the cheapest catalogue model instead of
 * the active one.
 *
 * These run the real `extractMemoriesFromPair` with mocked stores/providers, so
 * the assertion is "did a request leave the app", not "does the source contain
 * a guard". The gate sits inside the extraction function, one level below every
 * caller (useChat, useCodex, the remote listener), which is what makes it
 * inheritable — a new call site cannot forget it.
 *
 * NEGATIVE CONTROL (verified by hand, documented so the next reader can redo
 * it): drop the `if (!call) return` in useMemory.ts's extractMemoriesFromPair,
 * or make silentCallAllowed return true unconditionally, and
 * "fires no request on lu-cloud without the opt-in" goes red.
 *
 * Run: npx vitest run src/hooks/__tests__/memory-silent-call-gate.test.ts
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { MemoryFile } from '../../types/agent-mode'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { generateEmbeddings, cosineSimilarity } from '../../api/rag'
import { loadVectors } from '../../lib/memoryEmbedDB'

// ── Mocked module graph ────────────────────────────────────────
// Everything the extraction touches, kept dumb so the only interesting
// question is whether chatStream was reached and with which model.

const chatStream = vi.fn()
// Second argument: the extractor marks its writes as automatic (A27).
const addMemory = vi.fn((_memory: unknown, _opts?: { auto?: boolean }) => 'mem-1')
const applyWriteDecision = vi.fn()

let activeModel = 'qwen3:8b'
let models: Array<{ name: string; type: string }> = []
let memoryCloudOptIn = false
let memorySettings = { autoExtractEnabled: true, autoExtractInAllModes: false }
let memoryEntries: MemoryFile[] = []

vi.mock('../../stores/modelStore', () => ({
  useModelStore: { getState: () => ({ activeModel, models }) },
}))

vi.mock('../../stores/memoryStore', () => ({
  useMemoryStore: {
    getState: () => ({
      settings: memorySettings,
      entries: memoryEntries,
      addMemory,
      removeMemory: vi.fn(),
      applyWriteDecision,
    }),
  },
}))

vi.mock('../../stores/providerStore', () => ({
  useProviderStore: {
    getState: () => ({
      providers: {
        openai: { enabled: true, isLocal: true },
        anthropic: { enabled: false },
      },
    }),
  },
}))

vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({ settings: { memoryCloudOptIn, contextWindowOverride: 0 } }),
  },
}))

vi.mock('../../api/providers', () => ({
  getProviderForModel: (name: string) => ({
    provider: { chatStream },
    modelId: name.includes('::') ? name.split('::')[1] : name,
  }),
  getProviderIdFromModel: (name: string) =>
    name.includes('::') ? name.split('::')[0] : 'ollama',
}))

vi.mock('../../api/rag', () => ({
  generateEmbeddings: vi.fn(async () => [[]]),
  cosineSimilarity: vi.fn(() => 0),
}))

vi.mock('../../lib/memoryEmbedDB', () => ({
  loadVectors: vi.fn(async () => new Map()),
}))

const { extractMemoriesFromPair } = await import('../useMemory')

// The extraction is rate-limited to every 3rd turn (module counter). Three
// consecutive calls therefore contain EXACTLY one attempt, whatever the
// counter's starting value — so each scenario drives three turns.
const RATE_LIMIT = 3
const LONG_REPLY = 'x'.repeat(200)

async function threeTurns() {
  for (let i = 0; i < RATE_LIMIT; i++) {
    await extractMemoriesFromPair('what do I do for work?', LONG_REPLY, 'conv-1', {})
  }
}

/** One empty stream, so the extraction completes without parsing anything. */
function emptyStream() {
  return (async function* () {
    yield { content: '', done: true }
  })()
}

beforeEach(() => {
  chatStream.mockReset()
  chatStream.mockImplementation(() => emptyStream())
  addMemory.mockClear()
  applyWriteDecision.mockClear()
  vi.mocked(generateEmbeddings).mockResolvedValue([[]])
  vi.mocked(cosineSimilarity).mockReturnValue(0)
  vi.mocked(loadVectors).mockResolvedValue(new Map())
  useCloudAuthStore.getState().setSignedOut()
  memoryEntries = []
  memorySettings = { autoExtractEnabled: true, autoExtractInAllModes: false }
  models = [
    { name: 'lu-cloud::Qwen/Qwen3-Coder-480B-A35B-Instruct', type: 'text' },
    { name: 'lu-cloud::meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo', type: 'text' },
    { name: 'qwen3:8b', type: 'text' },
  ]
})

describe('late extraction writes', () => {
  const extracted = JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: 'Fact', description: 'Fact', content: 'New fact', tags: [] }] })
  it('does not restore data after local memories change during extraction', async () => {
    activeModel = 'qwen3:8b'
    chatStream.mockImplementation(() => (async function* () {
      memoryEntries = []
      yield { content: extracted, done: true }
    })())
    await threeTurns()
    expect(chatStream).toHaveBeenCalledTimes(1)
    expect(addMemory).not.toHaveBeenCalled()
  })
  it('permanently revokes a pending write across sign-out and sign-in to the same account', async () => {
    activeModel = 'qwen3:8b'
    const account = { licenseActive: false, tier: null, access: true, quota: null }
    useCloudAuthStore.getState().setSignedIn({ id: 'owner-a' }, account)
    chatStream.mockImplementation(() => (async function* () {
      useCloudAuthStore.getState().setSignedOut()
      useCloudAuthStore.getState().setSignedIn({ id: 'owner-a' }, account)
      yield { content: extracted, done: true }
    })())
    await threeTurns()
    expect(addMemory).not.toHaveBeenCalled()
  })
  it('does not apply a late merge over a target edited while the resolver streamed', async () => {
    activeModel = 'qwen3:8b'
    memoryEntries = [{ id: 'target', type: 'user', title: 'Original', content: 'Original', description: '', tags: [], source: 'manual', createdAt: 1, updatedAt: 1 }]
    vi.mocked(generateEmbeddings).mockResolvedValue([[1]])
    vi.mocked(cosineSimilarity).mockReturnValue(0.75)
    vi.mocked(loadVectors).mockResolvedValue(new Map([['target', { dim: 1, vector: [1], model: 'fixture', contentHash: 'fixture' }]]))
    chatStream.mockImplementationOnce(() => (async function* () { yield { content: extracted, done: true } })())
    chatStream.mockImplementationOnce(() => (async function* () {
      memoryEntries = memoryEntries.map(entry => ({ ...entry, content: 'User correction' }))
      yield { content: JSON.stringify({ action: 'UPDATE', targetId: 'target', mergedContent: 'Late overwrite' }), done: true }
    })())
    await threeTurns()
    expect(chatStream).toHaveBeenCalledTimes(2)
    expect(addMemory).toHaveBeenCalledTimes(1)
    expect(applyWriteDecision).not.toHaveBeenCalled()
    expect(memoryEntries[0].content).toBe('User correction')
  })
})

describe('project extraction isolation', () => {
  it('preserves project and modality when the first write fails', async () => {
    activeModel = 'qwen3:8b'
    addMemory.mockImplementationOnce(() => { throw new Error('Synthetic write failure') })
    chatStream.mockImplementation(() => (async function* () {
      yield { content: JSON.stringify({ shouldSave: true, memories: [{ type: 'project', title: 'A fact', description: 'Synthetic fact', content: 'Synthetic project fact', tags: [] }] }), done: true }
    })())
    for (let i = 0; i < RATE_LIMIT; i++) await extractMemoriesFromPair('question', LONG_REPLY, 'conv-a', { scope: 'A', sourceKind: 'screen' })
    expect(addMemory).toHaveBeenCalledTimes(2)
    expect(addMemory).toHaveBeenLastCalledWith(expect.objectContaining({ scope: 'A', source: 'conv-a', sourceKind: 'screen' }), { auto: true })
  })
  it('writes extracted facts to the captured project even if the caller changes its options', async () => {
    activeModel = 'qwen3:8b'
    chatStream.mockImplementation(() => (async function* () {
      yield { content: JSON.stringify({ shouldSave: true, memories: [{ type: 'project', title: 'A fact', description: 'Synthetic fact', content: 'Synthetic project fact', tags: [] }] }), done: true }
    })())
    for (let i = 0; i < RATE_LIMIT; i++) {
      const options: { scope: string; sourceKind: MemoryFile['sourceKind'] } = { scope: 'A', sourceKind: 'voice' }
      const pending = extractMemoriesFromPair('question', LONG_REPLY, 'conv-a', options)
      options.scope = 'B'
      options.sourceKind = 'screen'
      await pending
    }
    expect(addMemory).toHaveBeenCalledTimes(1)
    expect(addMemory).toHaveBeenCalledWith(expect.objectContaining({ scope: 'A', source: 'conv-a', sourceKind: 'voice' }), { auto: true })
  })
  it('does not send sensitive or other-project titles to the extraction provider', async () => {
    activeModel = 'qwen3:8b'
    memoryEntries = [
      { id: 'a', title: 'Allowed Alpha', scope: 'A' },
      { id: 'b', title: 'Forbidden Beta', scope: 'B' },
      { id: 's', title: 'Forbidden Sensitive', scope: 'A', sensitive: true },
    ].map(e => ({ ...e, type: 'user', description: '', content: e.title, tags: [], source: 'manual', createdAt: 1, updatedAt: 1 }))
    for (let i = 0; i < RATE_LIMIT; i++) await extractMemoriesFromPair('question', LONG_REPLY, 'conv-a', { scope: 'A' })
    expect(chatStream).toHaveBeenCalledTimes(1)
    const sent = JSON.stringify(chatStream.mock.calls[0][1])
    expect(sent).toContain('Allowed Alpha')
    expect(sent).not.toMatch(/Forbidden Beta|Forbidden Sensitive/)
  })
})

describe('lu-cloud', () => {
  it('fires no request without the opt-in (the shipped default)', async () => {
    activeModel = 'lu-cloud::Qwen/Qwen3-Coder-480B-A35B-Instruct'
    memoryCloudOptIn = false

    await threeTurns()

    expect(chatStream).not.toHaveBeenCalled()
  })

  it('fires on the cheapest catalogue model once the user opts in', async () => {
    activeModel = 'lu-cloud::Qwen/Qwen3-Coder-480B-A35B-Instruct'
    memoryCloudOptIn = true

    await threeTurns()

    expect(chatStream).toHaveBeenCalledTimes(1)
    expect(chatStream.mock.calls[0][0]).toBe('meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo')
    // and never the flagship the visible chat is running on
    expect(chatStream.mock.calls[0][0]).not.toContain('480B')
  })
})

describe('local and BYOK stay ungated', () => {
  it('a local model extracts with the opt-in off', async () => {
    activeModel = 'qwen3:8b'
    memoryCloudOptIn = false

    await threeTurns()

    expect(chatStream).toHaveBeenCalledTimes(1)
    expect(chatStream.mock.calls[0][0]).toBe('qwen3:8b')
  })

  it('a BYOK Anthropic model extracts on the active model, opt-in off', async () => {
    activeModel = 'anthropic::claude-sonnet-4-20250514'
    memoryCloudOptIn = false
    // BYOK keeps its own switch (memory settings), which the audit left alone.
    memorySettings = { autoExtractEnabled: true, autoExtractInAllModes: true }

    await threeTurns()

    expect(chatStream).toHaveBeenCalledTimes(1)
    expect(chatStream.mock.calls[0][0]).toBe('claude-sonnet-4-20250514')
  })
})

describe('the existing guards still hold', () => {
  it('extracts nothing when auto-extract is switched off', async () => {
    activeModel = 'qwen3:8b'
    memoryCloudOptIn = true
    memorySettings = { autoExtractEnabled: false, autoExtractInAllModes: true }

    await threeTurns()

    expect(chatStream).not.toHaveBeenCalled()
  })

  it('skips a reply too short to hold a fact', async () => {
    activeModel = 'qwen3:8b'
    memoryCloudOptIn = true

    for (let i = 0; i < RATE_LIMIT; i++) {
      await extractMemoriesFromPair('hi', 'ok', 'conv-1', {})
    }

    expect(chatStream).not.toHaveBeenCalled()
  })
})

/**
 * R5-26. The extraction ran on a 500 token budget. A model that pads the JSON
 * with prose or a short think block tore off mid-object, and the whole turn was
 * lost without a word, which is the same failure R5-25 fixes from the parsing
 * side. 800 is the web's number (the web app).
 */
describe('the budget the extraction asks for', () => {
  it('R5-26: asks for 800 tokens, so a padded answer still arrives whole', async () => {
    activeModel = 'qwen3:8b'
    await threeTurns()
    expect(chatStream).toHaveBeenCalledTimes(1)
    expect(chatStream.mock.calls[0][2]).toMatchObject({ maxTokens: 800 })
  })

  it('R5-26 NEGATIVKONTROLLE: temperature and the context window are untouched', async () => {
    activeModel = 'qwen3:8b'
    await threeTurns()
    expect(chatStream.mock.calls[0][2]).toMatchObject({ temperature: 0.1 })
  })

  it('R5-26: a 700 token answer is still read in full', async () => {
    // Four characters to the token, the rule of thumb this app sizes budgets
    // with: 700 tokens is roughly 2800 characters. Under the old 500 the reply
    // would have been cut before its closing brace and parsed to nothing.
    activeModel = 'qwen3:8b'
    const padding = 'a'.repeat(2600)
    const lang = JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: 'Long fact', description: 'Long fact', content: padding, tags: [] }] })
    expect(lang.length).toBeGreaterThan(4 * 500)
    expect(lang.length).toBeLessThan(4 * 800)
    chatStream.mockImplementation(() => (async function* () { yield { content: lang, done: true } })())
    await threeTurns()
    expect(addMemory).toHaveBeenCalledTimes(1)
    expect(addMemory).toHaveBeenCalledWith(expect.objectContaining({ content: padding }), { auto: true })
  })

  it('R5-25: a think block around the answer is not stored as a memory', async () => {
    activeModel = 'qwen3:8b'
    chatStream.mockImplementation(() => (async function* () {
      yield { content: '<think>Maybe {"shouldSave": true, "memories": [{"type": "user", "title": "Guess", "content": "A stray thought", "tags": []}]} would do.</think>{"shouldSave": false, "memories": []}', done: true }
    })())
    await threeTurns()
    expect(addMemory).not.toHaveBeenCalled()
  })
})

// A voice session hands over everything that was said in ONE call when it
// ends (api/voice-history.ts). The every-third-turn limit would silently drop
// two of three sessions, so a digest is not counted against it. Every other
// gate still applies.
describe('a session digest', () => {
  const digest = { sourceKind: 'voice' as const, digest: true }

  it('is extracted every time, not every third time', async () => {
    activeModel = 'qwen3:8b'
    await extractMemoriesFromPair('my name is David', LONG_REPLY, 'voice-1', digest)
    expect(chatStream).toHaveBeenCalledTimes(1)
    await extractMemoriesFromPair('I live in Berlin', LONG_REPLY, 'voice-2', digest)
    expect(chatStream).toHaveBeenCalledTimes(2)
  })

  it('does not move the counter of the typed turns', async () => {
    activeModel = 'qwen3:8b'
    await extractMemoriesFromPair('one', LONG_REPLY, 'voice-1', digest)
    await extractMemoriesFromPair('two', LONG_REPLY, 'voice-1', digest)
    chatStream.mockClear()
    await threeTurns()
    expect(chatStream).toHaveBeenCalledTimes(1)
  })

  it('still fires no request on lu-cloud without the opt-in', async () => {
    activeModel = 'lu-cloud::Qwen/Qwen3-Coder-480B-A35B-Instruct'
    memoryCloudOptIn = false
    await extractMemoriesFromPair('question', LONG_REPLY, 'voice-1', digest)
    expect(chatStream).not.toHaveBeenCalled()
  })

  it('still skips a session with too little said, and one with extraction switched off', async () => {
    activeModel = 'qwen3:8b'
    await extractMemoriesFromPair('hi', 'Hello.', 'voice-1', digest)
    memorySettings = { autoExtractEnabled: false, autoExtractInAllModes: false }
    await extractMemoriesFromPair('question', LONG_REPLY, 'voice-1', digest)
    expect(chatStream).not.toHaveBeenCalled()
  })

  it('writes what it finds with the voice source', async () => {
    activeModel = 'qwen3:8b'
    chatStream.mockImplementation(() => (async function* () {
      yield { content: JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: 'Name', description: 'Name', content: 'The user is called David.', tags: [] }] }), done: true }
    })())
    await extractMemoriesFromPair('my name is David', LONG_REPLY, 'voice-1', { ...digest, scope: 'A' })
    expect(addMemory).toHaveBeenCalledWith(expect.objectContaining({ source: 'voice-1', sourceKind: 'voice', scope: 'A' }), { auto: true })
  })
})
