/**
 * Round 9, N3 of the check on Android with 8 GB (A-01): a question asked
 * while a document is being read waited visibly, and then answered WITHOUT
 * that document, 10 of 10. The same question asked again right after was
 * answered from it.
 *
 * Two causes, both closed here:
 *   1. The reading gave the model slot back before its caller had the result
 *      (the content hash and the hand-over came after), so the question that
 *      waited for the slot started first and found the old list.
 *   2. The search took the list of passages before its own wait for the slot.
 *
 * The contract now: the result is handed over inside the reading (onRead),
 * and a search asks for the passages after its wait (a function as source).
 *
 * Run: npx vitest run src/api/__tests__/mobile-frage-waehrend-lesen-nutzt-neue-datei.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const engine = vi.hoisted(() => ({
  managed: true,
  running: true,
  startsOnDemand: true,
  installed: true,
  ensure: vi.fn(),
  stop: vi.fn(async () => undefined),
  // The chat model in the slot, and what happened to it, in order.
  chat: null as null | { path: string; ctx: number },
  /** Does the embedder come up while a chat model is loaded? */
  startsBesideChat: true,
  log: [] as string[],
}))
vi.mock('../engine', () => ({
  isManagedBuiltinActive: () => engine.managed,
  embedBaseUrl: () => 'http://127.0.0.1:8128/v1',
  bundledEmbedStatus: async () => ({ running: engine.running, healthy: engine.running }),
  ensureBundledEmbedAlive: async () => {
    engine.ensure()
    if (engine.chat && !engine.startsBesideChat) return
    if (engine.startsOnDemand && engine.installed && !engine.running) {
      engine.running = true
      engine.log.push('embed:start')
    }
  },
  bundledEngineStatus: async () => ({ running: !!engine.chat, healthy: !!engine.chat, port: 8127, model_path: engine.chat?.path ?? null, ctx: engine.chat?.ctx ?? null }),
  stopBundledEngine: async () => { engine.chat = null; engine.log.push('chat:stop') },
  startBundledEngine: async (path: string, tuning?: { ctx?: number }) => {
    engine.chat = { path, ctx: tuning?.ctx ?? 0 }
    engine.log.push(`chat:start:${path}:${tuning?.ctx ?? 0}`)
    return { port: 8127 }
  },
  listBundledModels: async () => (engine.installed ? [{ name: 'nomic-embed-text-v1.5.Q4.gguf', path: '/m/e.gguf' }] : []),
  isEmbeddingGgufName: (n: string) => /embed/.test(n),
  stopBundledEmbed: () => {
    if (engine.running) engine.log.push('embed:stop')
    engine.running = false
    return engine.stop()
  },
}))

const localFetch = vi.hoisted(() => vi.fn())
vi.mock('../backend', () => ({
  localFetch,
  ollamaUrl: (p: string) => `http://localhost:11434/api${p}`,
  isMacOS: () => false,
  isLinux: () => false,
}))

import { __resetSlotTurnForTests, indexDocument, retrieveContext, setMobileRagLimits } from '../rag'
import { __resetModelSlotForTests, setEmbedderFitCheck, slotIsFree, whenSlotIdle } from '../../lib/model-slot'
import { useGenerationStore } from '../../stores/generationStore'
import type { TextChunk } from '../../types/rag'

/** A text file of `n` passages the chunker keeps apart. */
function fileOf(n: number, name = 'notes.txt'): File {
  const sentence = (i: number) => `Passage number ${i} talks about topic ${i} at some length so that it is kept. `.repeat(6)
  return new File([Array.from({ length: n }, (_, i) => sentence(i)).join('\n\n')], name, { type: 'text/plain' })
}

/**
 * An embedding server like the real one: a request that is on its way when
 * the server is stopped fails as a transport error. `hold()` keeps the
 * requests from answering until `open()`.
 */
function embedServer() {
  let open: () => void = () => undefined
  let gate: Promise<void> = Promise.resolve()
  const requests: string[][] = []
  localFetch.mockImplementation(async (_url: string, init: { body: string }) => {
    const input = (JSON.parse(init.body) as { input: string[] }).input
    requests.push(input)
    await gate
    if (!engine.running) throw new Error('proxy_localhost: error sending request for url (http://127.0.0.1:8128/v1/embeddings)')
    return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), { status: 200 })
  })
  return {
    requests,
    hold: () => { gate = new Promise<void>((r) => { open = r }) },
    open: () => open(),
  }
}

const oldChunk: TextChunk = { id: 'c1', documentId: 'old', content: 'Opening hours are nine to five.', embedding: [1, 0, 0], index: 0 }
const tick = () => new Promise((r) => setTimeout(r, 5))

beforeEach(() => {
  engine.managed = true
  engine.running = false
  engine.startsOnDemand = true
  engine.installed = true
  engine.chat = null
  engine.startsBesideChat = true
  engine.log = []
  localFetch.mockReset()
  __resetModelSlotForTests()
  __resetSlotTurnForTests()
  setMobileRagLimits(null)
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
})
afterEach(() => { vi.unstubAllGlobals() })


describe('N3: a question that waited for a reading sees the new document', () => {
  it('the result is handed over while the slot is still held, so the waiting send finds it', async () => {
    standOn('android')
    setEmbedderFitCheck(() => 'fits')
    const server = embedServer()
    server.hold()
    // What the hook does: the document enters the chat in onRead.
    const inChat: string[] = []
    let slotFreeAtHandOver: boolean | null = null
    const reading = indexDocument(fileOf(3, 'logbook-08.txt'), undefined, {
      onRead: ({ meta }) => {
        slotFreeAtHandOver = slotIsFree()
        inChat.push(meta.name)
      },
    })
    await vi.waitFor(() => expect(server.requests).toHaveLength(1))

    // The question: it waits for the slot and then looks at the documents.
    let seenByTheQuestion: string[] | null = null
    const question = whenSlotIdle().then(() => { seenByTheQuestion = [...inChat] })
    await tick()
    expect(seenByTheQuestion).toBeNull()

    server.open()
    await question
    expect(seenByTheQuestion).toEqual(['logbook-08.txt'])
    expect(slotFreeAtHandOver).toBe(false)
    const { meta } = await reading
    expect(meta.name).toBe('logbook-08.txt')
    expect(inChat).toEqual(['logbook-08.txt'])
    expect(slotIsFree()).toBe(true)
  })

  it('a search that waited for the reading searches the passages from after it', async () => {
    standOn('android')
    setEmbedderFitCheck(() => 'fits')
    const server = embedServer()
    server.hold()
    const store: TextChunk[] = [oldChunk]
    const reading = indexDocument(fileOf(3, 'logbook-08.txt'), undefined, {
      onRead: ({ chunks }) => { store.push(...chunks) },
    })
    await vi.waitFor(() => expect(server.requests).toHaveLength(1))

    let asked = 0
    const search = retrieveContext('What does passage number 2 talk about?', () => { asked += 1; return [...store] }, undefined, 10)
    await tick()
    // Not asked before the wait is over.
    expect(asked).toBe(0)

    server.open()
    const { chunks: read } = await reading
    const { context } = await search
    expect(asked).toBe(1)
    const newIds = new Set(read.map((c) => c.id))
    expect(context.chunks.some((c) => newIds.has(c.id))).toBe(true)
    expect(context.documentIds).toContain(read[0].documentId)
  })

  it('a reading whose hand-over throws ends the job and rejects with that error', async () => {
    standOn('android')
    setEmbedderFitCheck(() => 'fits')
    embedServer()
    await expect(indexDocument(fileOf(3), undefined, { onRead: () => { throw new Error('No text could be extracted') } }))
      .rejects.toThrow('No text could be extracted')
    expect(slotIsFree()).toBe(true)
  })

  it('a source that answers with nothing asks the document model nothing', async () => {
    standOn('android')
    setEmbedderFitCheck(() => 'fits')
    const server = embedServer()
    const { context, scoredChunks } = await retrieveContext('anything', () => [])
    expect(context.chunks).toEqual([])
    expect(scoredChunks).toEqual([])
    expect(server.requests).toHaveLength(0)
    expect(slotIsFree()).toBe(true)
  })

  it('a desktop: the hand-over is called once before the return, and a list is searched as before', async () => {
    standOn('windows')
    engine.running = true
    embedServer()
    let handed = 0
    const { chunks } = await indexDocument(fileOf(3), undefined, { onRead: () => { handed += 1 } })
    expect(handed).toBe(1)
    const { context } = await retrieveContext('Passage number 1', chunks)
    expect(context.chunks.length).toBeGreaterThan(0)
  })
})
