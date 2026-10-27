/**
 * @vitest-environment jsdom
 *
 * Round 9, N3 of the check on Android with 8 GB (A-01): a question asked
 * while a document is being read waited, and was then answered without that
 * document. The hook looked at the documents of the chat (is Document Chat
 * on, which passages are there) BEFORE it waited for the reading.
 *
 * Here: what the hook looks at after the wait. The reading itself and the
 * search are tested in api/__tests__/mobile-frage-waehrend-lesen-nutzt-neue-datei.test.ts.
 *
 * Run: npx vitest run src/hooks/__tests__/useChat-frage-waehrend-lesen-nutzt-neue-datei.test.ts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

vi.mock('../../api/cloud/supabase', () => ({ getAccessToken: async () => 'session-token-abc' }))
vi.mock('../../lib/ttsBridge', () => ({ autoSpeak: () => {} }))
vi.mock('../../api/vram-handoff', () => ({ requestGenerationCancel: () => {} }))
vi.mock('../useMemory', () => ({
  useMemory: () => ({ extractAndSave: async () => {} }),
  extractMemoriesFromPair: async () => {},
}))
const search = vi.hoisted(() => ({ calls: [] as { query: string; chunkIds: string[] }[] }))
vi.mock('../../api/rag', async (orig) => ({
  ...(await orig<typeof import('../../api/rag')>()),
  // The search itself is tested in api/__tests__. Here: what the hook gives it.
  retrieveContext: async (query: string, source: unknown) => {
    const chunks = (typeof source === 'function' ? await (source as () => unknown)() : source) as { id: string; documentId: string; content: string; index: number }[]
    search.calls.push({ query, chunkIds: chunks.map((c) => c.id) })
    return { context: { chunks, query, documentIds: [...new Set(chunks.map((c) => c.documentId))] }, scoredChunks: chunks.map((chunk) => ({ chunk, score: 1 })) }
  },
}))
vi.mock('../../lib/ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))
vi.mock('../../lib/run-lane-of-model', () => ({
  laneOf: () => 'cloud',
  currentLaneFacts: () => ({ openaiSlotIsLocal: true, ollamaBaseIsLocal: true }),
}))

import { useChat, useChatSendPending } from '../useChat'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { __resetModelSlotForTests, beginDocumentJob } from '../../lib/model-slot'

const MODEL = 'openai::some-chat-model'

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}


beforeEach(() => {
  __resetModelSlotForTests()
  __resetRunLanesForTests()
  useChatSendPending.setState({ pending: {} })
  search.calls = []
  useRAGStore.setState({ documents: {}, chunks: [], ragEnabled: {}, pausedIndex: {}, lastRetrievedChunks: [], retrievalError: null })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'local', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, openai: { ...s.providers.openai, enabled: true } } }))
})
afterEach(() => vi.restoreAllMocks())

function openChat(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

const oldDoc = { id: 'old', name: 'greenhouse-notes.txt', type: 'txt' as const, size: 10, addedAt: 1, chunkCount: 1 }
const newDoc = { id: 'new', name: 'logbook-08.txt', type: 'txt' as const, size: 10, addedAt: 2, chunkCount: 1 }
const oldChunk = { id: 'k-old', documentId: 'old', content: 'Tomatoes are watered on Mondays.', index: 0, embedding: [1, 0] }
const newChunk = { id: 'k-new', documentId: 'new', content: 'The cargo code of Zephyr-08 is QX-4417.', index: 0, embedding: [0, 1] }

/** What the reading does when it is done: the document enters the chat, then the slot is free. */
function finishReading(convId: string, end: () => void): void {
  useRAGStore.getState().addDocument(convId, newDoc)
  useRAGStore.getState().addChunks([newChunk])
  useRAGStore.getState().setRagEnabled(convId, true)
  end()
}

function answering(): { bodies: string[] } {
  const seen = { bodies: [] as string[] }
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    seen.bodies.push(String((init as RequestInit | undefined)?.body ?? ''))
    return sse('QX-4417.')
  })
  return seen
}

describe('a question asked while a document is being read', () => {
  it('a chat that already has documents: the answer is given the passages of the new file and names it as a source', async () => {
    const seen = answering()
    const convId = openChat()
    useRAGStore.setState({ documents: { [convId]: [oldDoc] }, chunks: [oldChunk], ragEnabled: { [convId]: true } })
    const endReading = beginDocumentJob()
    const { result } = renderHook(() => useChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendMessage('What is the cargo code of Zephyr-08?')
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(search.calls).toHaveLength(0)
    expect(seen.bodies).toHaveLength(0)

    await act(async () => { finishReading(convId, endReading); await done })
    expect(search.calls).toHaveLength(1)
    expect(search.calls[0].chunkIds).toEqual(['k-old', 'k-new'])
    expect(seen.bodies).toHaveLength(1)
    expect(seen.bodies[0]).toContain('QX-4417')
    const answer = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.at(-1)!
    expect(answer.sources?.map((s) => s.documentName)).toEqual(['greenhouse-notes.txt', 'logbook-08.txt'])
  })

  it('the first document of the chat, which switches Document Chat on: the answer still gets it', async () => {
    const seen = answering()
    const convId = openChat()
    const endReading = beginDocumentJob()
    const { result } = renderHook(() => useChat())
    let done: Promise<void> = Promise.resolve()
    await act(async () => {
      done = result.current.sendMessage('What is the cargo code of Zephyr-08?')
      await new Promise((r) => setTimeout(r, 20))
    })
    await act(async () => { finishReading(convId, endReading); await done })
    expect(search.calls.map((c) => c.chunkIds)).toEqual([['k-new']])
    expect(seen.bodies[0]).toContain('QX-4417')
    const answer = useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.at(-1)!
    expect(answer.sources?.map((s) => s.documentName)).toEqual(['logbook-08.txt'])
  })
})
