/**
 * @vitest-environment jsdom
 *
 * Round 12, F1 of the second check on Android with 8 GB: the FIRST file of a
 * chat without documents is not used for the question asked while it is read
 * (3 of 3). The answer waits, then comes without the file and without a
 * source list. The same question once more is right.
 *
 * Cause: the reading puts the document into the chat while it still holds
 * the model slot (round 9), but "Document Chat is on" was written by the
 * documents page AFTER `uploadDocument` had returned. The waiting question
 * is woken when the slot is freed, which is before that, reads "off" and
 * never searches.
 *
 * Here the real `useRAG().uploadDocument` runs against a reading that keeps
 * the order of the real one (api/rag.ts, indexDocument: hand over, free the
 * slot, return), and the real send hooks wait for it. The switch is set
 * afterwards the way the page does it, so the test is red without the fix.
 *
 * Run: npx vitest run src/hooks/__tests__/erste-datei-im-chat-wird-fuer-die-wartende-frage-benutzt.test.ts
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
vi.mock('../../api/embed-availability', () => ({
  builtinEmbedReady: async () => true,
  embeddingBackendReady: async () => true,
  EMBED_PROBE_TIMEOUT_MS: 10,
}))
vi.mock('../../lib/ragDB', () => ({ saveChunks: async () => {}, loadChunks: async () => [], deleteChunks: async () => {} }))

type Chunk = { id: string; documentId: string; content: string; index: number; embedding: number[] }
type Read = { meta: unknown; chunks: Chunk[] }
const reading = vi.hoisted(() => ({
  finish: null as null | (() => void),
  searches: [] as string[][],
}))
vi.mock('../../api/rag', async (orig) => {
  const slot = await import('../../lib/model-slot')
  return {
    ...(await orig<typeof import('../../api/rag')>()),
    // The order of the real reading: the job is open, the result is handed
    // over while it is, the job ends, and only then does the caller go on.
    indexDocument: async (_file: File, _model: string, opts?: { onRead?: (r: Read) => void }) => {
      const endJob = slot.beginDocumentJob()
      try {
        await new Promise<void>((resolve) => { reading.finish = resolve })
        const result: Read = {
          meta: { id: 'new', name: 'logbook-12.txt', type: 'txt', size: 10, addedAt: 2, chunkCount: 1 },
          chunks: [{ id: 'k-new', documentId: 'new', content: 'The cargo code of Zephyr-12 is QX-4417.', index: 0, embedding: [0, 1] }],
        }
        opts?.onRead?.(result)
        return result
      } finally {
        endJob()
      }
    },
    retrieveContext: async (query: string, source: unknown) => {
      const chunks = (typeof source === 'function' ? await (source as () => unknown)() : source) as Chunk[]
      reading.searches.push(chunks.map((c) => c.id))
      return { context: { chunks, query, documentIds: [...new Set(chunks.map((c) => c.documentId))] }, scoredChunks: chunks.map((chunk) => ({ chunk, score: 1 })) }
    },
  }
})

import { useChat, useChatSendPending } from '../useChat'
import { useAgentChat } from '../useAgentChat'
import { useRAG } from '../useRAG'
import { useChatStore } from '../../stores/chatStore'
import { useModelStore } from '../../stores/modelStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useProviderStore } from '../../stores/providerStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useRAGStore } from '../../stores/ragStore'
import { useAgentModeStore } from '../../stores/agentModeStore'
import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { useTodoStore } from '../../stores/todoStore'
import { useToolAuditStore } from '../../stores/toolAuditStore'
import { __resetRunLanesForTests } from '../../lib/run-lanes'
import { __resetRunStopsForTests } from '../../lib/run-stop'
import { __resetModelSlotForTests, documentJobRunning } from '../../lib/model-slot'
import { DEFAULT_SETTINGS } from '../../lib/constants'
import { NATIVE_HOST_KEY } from '../../lib/device-kind'

const MODEL = 'lu-cloud::zai-org/GLM-5.3'
const QUESTION = 'What is the cargo code of the ship Zephyr-12?'

const host = (kind: string | null) => {
  const w = window as unknown as Record<string, unknown>
  if (kind) w[NATIVE_HOST_KEY] = kind
  else delete w[NATIVE_HOST_KEY]
}

let bodies: string[] = []

beforeEach(() => {
  host('android')
  bodies = []
  reading.finish = null
  reading.searches = []
  __resetModelSlotForTests()
  __resetRunLanesForTests()
  __resetRunStopsForTests()
  useChatSendPending.setState({ pending: {} })
  useRAGStore.setState({ documents: {}, chunks: [], ragEnabled: {}, pausedIndex: {}, lastRetrievedChunks: [], retrievalError: null, isIndexing: false, indexingProgress: null })
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentTaskStore.setState({ byConv: {} })
  useAgentLoopStore.setState({ loops: {} })
  useAgentModeStore.setState({ agentModeActive: {}, workspaces: {}, workspaceSlugs: {} })
  useTodoStore.setState({ byConversation: {}, updatedAt: {} })
  useToolAuditStore.setState({ entries: {} })
  useModelStore.setState({ models: [], activeModel: MODEL })
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, appMode: 'cloud', cavemanMode: 'off' } })
  useProviderStore.setState((s) => ({ providers: { ...s.providers, 'lu-cloud': { ...s.providers['lu-cloud'], enabled: true } } }))
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    if (!String(input).includes('/chat/completions')) return new Response('{}', { status: 200 })
    bodies.push(String((init as RequestInit | undefined)?.body ?? ''))
    return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: 'QX-4417.' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, {
      status: 200, headers: { 'content-type': 'text/event-stream' },
    })
  })
})
afterEach(() => {
  host(null)
  vi.restoreAllMocks()
})

function newChat(): string {
  const convId = useChatStore.getState().createConversation(MODEL, '')
  useChatStore.getState().setActiveConversation(convId)
  return convId
}

/** The documents page: read the file, and once that is over, switch the search on (DocumentsPage.tsx, read). */
function openPage(convId: string): () => Promise<void> {
  const { result } = renderHook(() => useRAG(convId))
  return () => (async () => {
    const meta = await result.current.uploadDocument(new File(['x'], 'logbook-12.txt', { type: 'text/plain' }), { trackPause: true })
    if (meta && !useRAGStore.getState().ragEnabled[convId]) useRAGStore.getState().setRagEnabled(convId, true)
  })()
}

async function untilReadingRuns(): Promise<void> {
  for (let i = 0; i < 50 && !(documentJobRunning() && reading.finish); i++) await new Promise((r) => setTimeout(r, 5))
  expect(documentJobRunning()).toBe(true)
}

const answerOf = (convId: string) =>
  useChatStore.getState().conversations.find((c) => c.id === convId)!.messages.filter((m) => m.role === 'assistant').at(-1)!

describe('the first file of a chat, and a question asked while it is read', () => {
  it('plain chat: the question waits, searches the new file and names it as its source', async () => {
    const convId = newChat()
    const pageReads = openPage(convId)
    let read: Promise<void> = Promise.resolve()
    await act(async () => { read = pageReads(); await untilReadingRuns() })
    // The chat has no document and no switch yet: this is the state the question is sent in.
    expect(useRAGStore.getState().ragEnabled[convId]).toBeUndefined()
    expect(useRAGStore.getState().documents[convId] ?? []).toEqual([])

    const { result } = renderHook(() => useChat())
    let sent: Promise<void> = Promise.resolve()
    await act(async () => {
      sent = result.current.sendMessage(QUESTION)
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(bodies).toHaveLength(0)

    await act(async () => { reading.finish!(); await read; await sent })
    expect(reading.searches).toEqual([['k-new']])
    expect(bodies).toHaveLength(1)
    expect(bodies[0]).toContain('QX-4417')
    expect(answerOf(convId).sources?.map((s) => s.documentName)).toEqual(['logbook-12.txt'])
  })

  it('agent: the run waits, searches the new file and names it as its source', async () => {
    const convId = newChat()
    const pageReads = openPage(convId)
    let read: Promise<void> = Promise.resolve()
    await act(async () => { read = pageReads(); await untilReadingRuns() })

    const { result } = renderHook(() => useAgentChat())
    let sent: Promise<void> = Promise.resolve()
    await act(async () => {
      sent = result.current.sendAgentMessage(QUESTION)
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(bodies).toHaveLength(0)

    await act(async () => { reading.finish!(); await read; await sent })
    expect(reading.searches).toEqual([['k-new']])
    expect(bodies.length).toBeGreaterThan(0)
    expect(bodies[0]).toContain('QX-4417')
    expect(answerOf(convId).sources?.map((s) => s.documentName)).toEqual(['logbook-12.txt'])
  })

  it('the switch is on when the reading hands the document over, not after it returned', async () => {
    const convId = newChat()
    const pageReads = openPage(convId)
    let read: Promise<void> = Promise.resolve()
    await act(async () => { read = pageReads(); await untilReadingRuns() })
    // What a waiter sees in the moment the slot is freed.
    const { whenSlotIdle } = await import('../../lib/model-slot')
    const seenByWaiter = whenSlotIdle().then(() => useRAGStore.getState().ragEnabled[convId])
    await act(async () => { reading.finish!(); await read })
    expect(await seenByWaiter).toBe(true)
  })

  it('a desktop keeps its own switch: a file read there does not turn Document Chat on', async () => {
    host('windows')
    const convId = newChat()
    const { result } = renderHook(() => useRAG(convId))
    let done: Promise<unknown> = Promise.resolve()
    await act(async () => {
      done = result.current.uploadDocument(new File(['x'], 'logbook-12.txt', { type: 'text/plain' }))
      for (let i = 0; i < 50 && !reading.finish; i++) await new Promise((r) => setTimeout(r, 5))
      reading.finish!()
      await done
    })
    expect(useRAGStore.getState().documents[convId]).toHaveLength(1)
    expect(useRAGStore.getState().ragEnabled[convId]).toBeUndefined()
  })
})
