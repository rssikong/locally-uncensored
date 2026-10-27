/**
 * Round 5, findings N1 and N2 of the acceptance on the small iPhone: a
 * question sent while a document was being read.
 *
 * N1  The phone had room for both models, so nobody borrowed the slot and the
 *     question went through at once. Its search gave the embedder back when
 *     it was done, which stopped the server under the batch of the reading:
 *     "Embedding failed (HTTP 500): proxy_localhost: error sending request".
 * N2  After a cold start no chat model was loaded. The question loaded it,
 *     the next batch of the reading found no room and unloaded it again in
 *     the middle of the answer: "The connection dropped".
 *
 * The contract now: a reading is a job from its first passage to its last.
 * A send and a search wait for it, the embedder is given back by the last
 * one who uses it, and a reading starts only between two local answers.
 *
 * Run: npx vitest run src/api/__tests__/mobile-document-job.test.ts
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
import {
  __resetModelSlotForTests, beginChatModelLoad, beginDocumentJob, getDocumentJobState, setEmbedderFitCheck, slotIsFree, whenSlotIdle,
} from '../../lib/model-slot'
import { waitForSlotOrStop } from '../../lib/slot-wait'
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

describe('N1: a question during a reading on a phone with room for both models', () => {
  it('the search of the question waits, the embedder is not stopped under the reading, the document is read', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    setEmbedderFitCheck(() => 'fits')
    const server = embedServer()
    server.hold()
    const reading = indexDocument(fileOf(40))
    await vi.waitFor(() => expect(server.requests).toHaveLength(1))
    expect(getDocumentJobState()).toBe('reading')
    expect(slotIsFree()).toBe(false)

    // The question: the chat hook waits for the slot, then searches.
    let searched = false
    const search = retrieveContext('When are you open?', [oldChunk]).then((r) => { searched = true; return r })
    await tick()
    expect(searched).toBe(false)
    expect(engine.log).not.toContain('embed:stop')

    server.open()
    const { chunks } = await reading
    expect(chunks).toHaveLength(40)
    await search
    expect(searched).toBe(true)
    // The question was embedded after the last passage of the document, not between two batches.
    expect(server.requests.at(-1)).toEqual(['When are you open?'])
    expect(getDocumentJobState()).toBe('none')
    expect(engine.chat?.path).toBe('/m/smol.gguf')
    expect(engine.log).not.toContain('chat:stop')
  })

  it('a send waits for the whole reading even though nobody borrows the slot', async () => {
    standOn('iphone')
    setEmbedderFitCheck(() => 'fits')
    const server = embedServer()
    server.hold()
    const reading = indexDocument(fileOf(3))
    await vi.waitFor(() => expect(server.requests).toHaveLength(1))
    let sendMayGo = false
    const waiting = whenSlotIdle().then(() => { sendMayGo = true })
    await tick()
    expect(sendMayGo).toBe(false)
    server.open()
    await reading
    await waiting
    expect(sendMayGo).toBe(true)
  })

  it('a reading that fails ends the job, so the question is answered and not held forever', async () => {
    standOn('iphone')
    setEmbedderFitCheck(() => 'fits')
    localFetch.mockImplementation(async () => new Response(JSON.stringify({ error: 'boom' }), { status: 500 }))
    await expect(indexDocument(fileOf(3))).rejects.toThrow(/Embedding failed \(HTTP 500\)/)
    expect(getDocumentJobState()).toBe('none')
    expect(slotIsFree()).toBe(true)
  })

  it('a desktop has no job: the reading holds nobody back', async () => {
    standOn('windows')
    engine.running = true
    const server = embedServer()
    server.hold()
    const reading = indexDocument(fileOf(3))
    await vi.waitFor(() => expect(server.requests).toHaveLength(1))
    expect(getDocumentJobState()).toBe('none')
    expect(slotIsFree()).toBe(true)
    server.open()
    await reading
  })
})

describe('N2: a reading never unloads the chat model under an answer', () => {
  const smallPhone = () => setEmbedderFitCheck(() => (engine.chat ? 'no-room' : 'fits'))

  it('started while the model on the phone answers: it waits, then the two take turns', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    const server = embedServer()
    useGenerationStore.getState().setGenerating('chat-1', true)
    const reading = indexDocument(fileOf(3))
    await tick()
    expect(getDocumentJobState()).toBe('waiting-for-answer')
    expect(engine.log).toEqual([])
    expect(server.requests).toHaveLength(0)
    // A send is not held back by a reading that has not started.
    expect(slotIsFree()).toBe(true)

    useGenerationStore.getState().setGenerating('chat-1', false)
    await reading
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/smol.gguf:2048'])
    expect(getDocumentJobState()).toBe('none')
  })

  it('an answer from LU Cloud does not use the slot, the reading starts at once', async () => {
    standOn('iphone')
    smallPhone()
    embedServer()
    useGenerationStore.getState().bookRun('chat-1', 'cloud')
    useGenerationStore.getState().setGenerating('chat-1', true)
    const { chunks } = await indexDocument(fileOf(3))
    expect(chunks).toHaveLength(3)
  })

  it('Cancel ends the wait for the answer', async () => {
    standOn('iphone')
    embedServer()
    useGenerationStore.getState().setGenerating('chat-1', true)
    const stop = new AbortController()
    const reading = indexDocument(fileOf(3), 'nomic-embed-text', { signal: stop.signal }).catch((e: unknown) => e)
    await tick()
    expect(getDocumentJobState()).toBe('waiting-for-answer')
    stop.abort()
    const err = await reading
    expect((err as Error).name).toBe('AbortError')
    expect(getDocumentJobState()).toBe('none')
    expect(localFetch).not.toHaveBeenCalled()
  })
})

describe('Stop while a question waits for the document', () => {
  it('Stop ends the wait and says so, and leaves no aborter behind', async () => {
    const end = beginDocumentJob()
    const waiting = waitForSlotOrStop('chat-1')
    await tick()
    expect(typeof useGenerationStore.getState().aborters['chat-1']).toBe('function')
    useGenerationStore.getState().abortConversation('chat-1')
    await expect(waiting).resolves.toBe('stopped')
    expect(useGenerationStore.getState().aborters['chat-1']).toBeUndefined()
    end()
  })

  it('without Stop it resolves when the reading is done', async () => {
    const end = beginDocumentJob()
    const waiting = waitForSlotOrStop('chat-1')
    await tick()
    end()
    await expect(waiting).resolves.toBe('free')
    expect(useGenerationStore.getState().aborters['chat-1']).toBeUndefined()
  })

  it('Stop in another chat does not end this wait', async () => {
    const end = beginDocumentJob()
    let outcome: string | null = null
    const waiting = waitForSlotOrStop('chat-1').then((o) => { outcome = o })
    await tick()
    useGenerationStore.getState().abortConversation('chat-2')
    await tick()
    expect(outcome).toBeNull()
    end()
    await waiting
    expect(outcome).toBe('free')
  })

  it('a free slot registers nothing', async () => {
    await expect(waitForSlotOrStop('chat-1')).resolves.toBe('free')
    expect(useGenerationStore.getState().aborters['chat-1']).toBeUndefined()
  })

  it('an aborter that was there before is still there afterwards, and Stop calls both', async () => {
    const earlier = vi.fn()
    useGenerationStore.getState().registerAborter('chat-1', earlier)
    const end = beginDocumentJob()
    const waiting = waitForSlotOrStop('chat-1')
    await tick()
    end()
    await waiting
    expect(useGenerationStore.getState().aborters['chat-1']).toBe(earlier)
  })
})

describe('round 6, B4: a reading never starts under a chat model that is still loading', () => {
  it('it waits for the load, says what it waits for, and then reads', async () => {
    standOn('android')
    setEmbedderFitCheck(() => 'fits')
    const server = embedServer()
    const loadDone = beginChatModelLoad()
    const reading = indexDocument(fileOf(3))
    await tick()
    await tick()
    expect(getDocumentJobState()).toBe('waiting-for-model')
    expect(server.requests).toHaveLength(0)
    expect(engine.log).not.toContain('embed:start')
    // A send is not held by a reading that has not begun.
    expect(slotIsFree()).toBe(true)

    loadDone()
    const { chunks } = await reading
    expect(chunks).toHaveLength(3)
    expect(getDocumentJobState()).toBe('none')
  })

  it('on a phone without room for both it no longer fails for memory because the model was not in yet', async () => {
    standOn('android')
    // The chat model arrives when its load ends. Until then there is nothing to move out of the way.
    setEmbedderFitCheck(() => (engine.chat ? 'no-room' : 'fits'))
    embedServer()
    const loadDone = beginChatModelLoad()
    const reading = indexDocument(fileOf(2))
    await tick()
    expect(engine.log).toEqual([])
    engine.chat = { path: '/m/qwen.gguf', ctx: 4096 }
    loadDone()
    await reading
    // The loaded model made room and came back, in this order.
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/qwen.gguf:4096'])
  })

  it('Cancel ends the wait for the load', async () => {
    standOn('android')
    setEmbedderFitCheck(() => 'fits')
    embedServer()
    const loadDone = beginChatModelLoad()
    const cancel = new AbortController()
    const reading = indexDocument(fileOf(2), 'nomic-embed-text', { signal: cancel.signal })
    await tick()
    cancel.abort()
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' })
    expect(getDocumentJobState()).toBe('none')
    loadDone()
  })
})

describe('round 6, B4: a question in the middle does not make the reading start over', () => {
  it('every passage is sent to the document model exactly once, with or without a question', async () => {
    standOn('android')
    engine.chat = { path: '/m/qwen.gguf', ctx: 4096 }
    setEmbedderFitCheck(() => 'fits')

    const alone = embedServer()
    await indexDocument(fileOf(40))
    const passagesAlone = alone.requests.flat()
    expect(passagesAlone).toHaveLength(40)

    engine.running = false
    engine.log = []
    const server = embedServer()
    server.hold()
    const reading = indexDocument(fileOf(40))
    await vi.waitFor(() => expect(server.requests).toHaveLength(1))
    // The question arrives after the first batch went out: the send waits, its search waits.
    const send = waitForSlotOrStop('chat-1')
    const search = retrieveContext('What does passage 7 talk about?', [oldChunk])
    await tick()
    server.open()
    await reading
    expect(await send).toBe('free')
    await search

    const sent = server.requests.flat()
    const passages = sent.filter((text) => text !== 'What does passage 7 talk about?')
    // The same passages in the same order as without a question: nothing twice, nothing from the start again.
    expect(passages).toEqual(passagesAlone)
    expect(sent.at(-1)).toBe('What does passage 7 talk about?')
    // The document model ran through the whole reading and was given back after it. The search
    // of the question then loads it once more (a second load of 80 MB, not a second reading).
    expect(engine.log).toEqual(['embed:start', 'embed:stop', 'embed:start', 'embed:stop'])
    expect(engine.chat?.path).toBe('/m/qwen.gguf')
  })
})
