/**
 * Point 4 of the mobile groundwork, the embedding half: a phone holds ONE
 * model. The embedder is loaded for Document Chat only, never unasked, and a
 * load that does not fit ends in one clear sentence.
 *
 * The audit (sections 2.2 and 4) found three unasked loads on a phone: every
 * model refresh, every send once there were memories, the end of the install.
 * And a fallback to Ollama on localhost:11434 for whatever did not find the
 * bundled server.
 *
 * Also here: indexing in batches with progress, cancel and limits on a phone,
 * BM25 without the quadratic walk, and checkConnection, which answered "yes"
 * on every machine without Ollama.
 *
 * Run: npx vitest run src/api/__tests__/mobile-one-model-slot.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

import {
  DEFAULT_MOBILE_RAG_LIMITS, bm25Prepare, bm25Score, bm25ScorePrepared, generateEmbeddings,
  __resetSlotTurnForTests, indexDocument, retrieveContext, setMobileRagLimits,
} from '../rag'
import {
  EMBEDDER_NO_ROOM_ALONE_MESSAGE, NO_EMBED_MODEL_MOBILE_MESSAGE, SINGLE_SLOT_CONFLICT_MESSAGE, __resetModelSlotForTests,
  getSlotTurn, subscribeSlotTurn, whenSlotIdle, type SlotTurn,
  isEmbedderNotAllowed, isSingleSlotConflict, setEmbedderFitCheck, setMobileEmbedderKeepLoaded,
} from '../../lib/model-slot'
import type { TextChunk } from '../../types/rag'

const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

/** Answers every /embeddings request with one vector per input. */
function embedServer(): { bodies: () => { input: string[] }[]; urls: () => string[] } {
  localFetch.mockImplementation(async (_url: string, init: { body: string }) => {
    const input = (JSON.parse(init.body) as { input: string[] }).input
    return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), { status: 200 })
  })
  return {
    bodies: () => localFetch.mock.calls.map((c) => JSON.parse((c[1] as { body: string }).body) as { input: string[] }),
    urls: () => localFetch.mock.calls.map((c) => String(c[0])),
  }
}

/** A text file of `n` passages the chunker keeps apart. */
function fileOf(n: number, name = 'notes.txt'): File {
  const sentence = (i: number) => `Passage number ${i} talks about topic ${i} at some length so that it is kept. `.repeat(6)
  return new File([Array.from({ length: n }, (_, i) => sentence(i)).join('\n\n')], name, { type: 'text/plain' })
}

beforeEach(() => {
  engine.managed = true
  engine.running = true
  engine.startsOnDemand = true
  engine.installed = true
  engine.ensure.mockClear()
  engine.stop.mockClear()
  engine.chat = null
  engine.startsBesideChat = true
  engine.log = []
  localFetch.mockReset()
  __resetModelSlotForTests()
  __resetSlotTurnForTests()
  setMobileRagLimits(null)
})
afterEach(() => { vi.unstubAllGlobals() })

describe('who may load the embedder on a phone', () => {
  it('memory, tool selection and anything unnamed are refused before anything is loaded', async () => {
    standOn('android')
    engine.running = false
    for (const opts of [{ purpose: 'memory' as const }, { purpose: 'tool-selection' as const }, undefined]) {
      const err = await generateEmbeddings(['x'], 'nomic-embed-text', opts).catch((e: unknown) => e)
      expect(isEmbedderNotAllowed(err)).toBe(true)
    }
    expect(engine.ensure).not.toHaveBeenCalled()
    expect(localFetch).not.toHaveBeenCalled()
  })

  it('Document Chat loads it on demand and gets its vectors', async () => {
    standOn('iphone')
    engine.running = false
    const server = embedServer()
    const out = await generateEmbeddings(['a', 'b'], 'nomic-embed-text', { purpose: 'document-chat' })
    expect(out).toHaveLength(2)
    expect(engine.ensure).toHaveBeenCalledTimes(1)
    expect(server.urls()).toEqual(['http://127.0.0.1:8128/v1/embeddings'])
  })

  it('no room and no chat model to move out of the way: the memory sentence, nothing is loaded', async () => {
    standOn('android')
    engine.running = false
    setEmbedderFitCheck(() => 'no-room')
    const err = await generateEmbeddings(['a'], 'nomic-embed-text', { purpose: 'document-chat' }).catch((e: unknown) => e)
    expect(isSingleSlotConflict(err)).toBe(true)
    expect((err as Error).message).toBe(EMBEDDER_NO_ROOM_ALONE_MESSAGE)
    expect(engine.ensure).not.toHaveBeenCalled()
    expect(getSlotTurn()).toBe('idle')
  })

  it('an embedder that is installed but does not come up is the same conflict, not a transport error', async () => {
    standOn('android')
    engine.running = false
    engine.startsOnDemand = false
    const err = await generateEmbeddings(['a'], 'nomic-embed-text', { purpose: 'document-chat' }).catch((e: unknown) => e)
    expect(isSingleSlotConflict(err)).toBe(true)
    expect(localFetch).not.toHaveBeenCalled()
  })

  it('no embedding model at all is an install sentence, and never a question to Ollama', async () => {
    standOn('iphone')
    engine.managed = false // a Cloud chat, the bundled lane is still the only one
    engine.running = false
    engine.installed = false
    const err = await generateEmbeddings(['a'], 'nomic-embed-text', { purpose: 'document-chat' }).catch((e: unknown) => e)
    expect((err as Error).message).toBe(NO_EMBED_MODEL_MOBILE_MESSAGE)
    expect(localFetch).not.toHaveBeenCalled()
  })

  it('the sentences are English, name the next step and carry no dashes', () => {
    for (const text of [SINGLE_SLOT_CONFLICT_MESSAGE, NO_EMBED_MODEL_MOBILE_MESSAGE, EMBEDDER_NO_ROOM_ALONE_MESSAGE]) {
      expect(text).not.toMatch(/[–—]/)
      expect(text).not.toMatch(/Ollama|LM Studio|this computer|click/i)
      expect(text).toMatch(/again/)
    }
  })

  it('after indexing and after a search the slot is given back', async () => {
    standOn('android')
    embedServer()
    await indexDocument(fileOf(3))
    expect(engine.stop).toHaveBeenCalledTimes(1)
    const chunks: TextChunk[] = [{ id: 'c', documentId: 'd', content: 'topic one', embedding: [1, 0, 0], index: 0 }]
    await retrieveContext('topic', chunks)
    expect(engine.stop).toHaveBeenCalledTimes(2)
  })

  it('a shell that knows the device has room may keep it loaded', async () => {
    standOn('android')
    embedServer()
    setMobileEmbedderKeepLoaded(true)
    await indexDocument(fileOf(3))
    expect(engine.stop).not.toHaveBeenCalled()
  })
})

describe('chat model and document model take turns when both do not fit (B1)', () => {
  /** The fit check of a small phone: no room beside a loaded chat model, room alone. */
  const smallPhone = () => setEmbedderFitCheck(() => (engine.chat ? 'no-room' : 'fits'))
  const watchTurns = (): SlotTurn[] => {
    const seen: SlotTurn[] = []
    // The same listeners hear the document job (round 5): only a changed turn is a turn.
    let last = getSlotTurn()
    subscribeSlotTurn(() => {
      const now = getSlotTurn()
      if (now !== last) seen.push(now)
      last = now
    })
    return seen
  }

  it('indexing: chat model out, document model in, all batches, document model out, chat model back', async () => {
    standOn('iphone')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    setMobileRagLimits({ batchSize: 2 })
    const server = embedServer()
    const turns = watchTurns()
    const { chunks } = await indexDocument(fileOf(5))
    expect(chunks.length).toBeGreaterThan(2)
    expect(server.bodies().length).toBeGreaterThan(1)
    // One swap for the whole document, not one per batch.
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/smol.gguf:2048'])
    expect(turns).toEqual(['unloading-chat', 'reading', 'reloading-chat', 'idle'])
    expect(engine.chat).toEqual({ path: '/m/smol.gguf', ctx: 2048 })
    expect(engine.running).toBe(false)
  })

  it('asking: the question is embedded in the same order and the chat model is back before the answer', async () => {
    standOn('android')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 4096 }
    smallPhone()
    embedServer()
    const chunks: TextChunk[] = [{ id: 'c', documentId: 'd', content: 'topic one', embedding: [1, 0, 0], index: 0 }]
    const { context } = await retrieveContext('topic', chunks)
    expect(context.chunks).toHaveLength(1)
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/smol.gguf:4096'])
    expect(getSlotTurn()).toBe('idle')
  })

  it('the swap ignores "keep the embedder loaded": borrowed memory always goes back', async () => {
    standOn('android')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    setMobileEmbedderKeepLoaded(true)
    embedServer()
    await indexDocument(fileOf(3))
    expect(engine.running).toBe(false)
    expect(engine.chat?.path).toBe('/m/smol.gguf')
  })

  it('the fit check did not know and the system refused: the chat model steps aside and it is tried once more', async () => {
    standOn('android')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    engine.startsBesideChat = false
    embedServer()
    const out = await generateEmbeddings(['a'], 'nomic-embed-text', { purpose: 'document-chat' })
    expect(out).toHaveLength(1)
    expect(engine.log).toEqual(['chat:stop', 'embed:start'])
    await retrieveContext('a', [{ id: 'c', documentId: 'd', content: 'a', embedding: [1, 0, 0], index: 0 }])
    expect(engine.chat?.path).toBe('/m/smol.gguf')
  })

  it('not even alone: the memory sentence, never a file error, and the chat model is loaded again', async () => {
    standOn('iphone')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    setEmbedderFitCheck(() => 'no-room')
    const err = await indexDocument(fileOf(3)).catch((e: unknown) => e)
    expect(isSingleSlotConflict(err)).toBe(true)
    expect((err as Error).message).toBe(EMBEDDER_NO_ROOM_ALONE_MESSAGE)
    expect((err as Error).message).toMatch(/memory/)
    expect((err as Error).message).not.toMatch(/read this file/i)
    expect(engine.log).toEqual(['chat:stop', 'chat:start:/m/smol.gguf:2048'])
    expect(getSlotTurn()).toBe('idle')
  })

  it('a reading that fails in the middle still brings the chat model back', async () => {
    standOn('android')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    localFetch.mockImplementation(async () => new Response('{"error":"boom"}', { status: 500 }))
    await expect(indexDocument(fileOf(3))).rejects.toThrow(/Embedding failed/)
    expect(engine.chat?.path).toBe('/m/smol.gguf')
    expect(engine.running).toBe(false)
    expect(getSlotTurn()).toBe('idle')
  })

  it('a send that starts during the reading waits until the chat model is back', async () => {
    standOn('android')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => { release = r })
    localFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      await gate
      const input = (JSON.parse(init.body) as { input: string[] }).input
      return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), { status: 200 })
    })
    const reading = indexDocument(fileOf(2))
    await vi.waitFor(() => expect(getSlotTurn()).toBe('reading'))
    let sendMayGo = false
    const waiting = whenSlotIdle().then(() => { sendMayGo = true })
    await Promise.resolve()
    expect(sendMayGo).toBe(false)
    release()
    await reading
    await waiting
    expect(sendMayGo).toBe(true)
    expect(engine.chat?.path).toBe('/m/smol.gguf')
  })

  it('room for both: nothing is unloaded and no step is announced', async () => {
    standOn('android')
    engine.running = false
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    setEmbedderFitCheck(() => 'fits')
    embedServer()
    const turns = watchTurns()
    await indexDocument(fileOf(3))
    expect(engine.log).toEqual(['embed:start', 'embed:stop'])
    expect(turns).toEqual([])
  })
})

describe('the desktop embeds as before', () => {
  it('the purpose is ignored, the bundled server is revived and never stopped', async () => {
    standOn('windows')
    const server = embedServer()
    const out = await generateEmbeddings(['a'], 'nomic-embed-text', { purpose: 'memory' })
    expect(out).toEqual([[1, 0, 0]])
    expect(engine.ensure).toHaveBeenCalledTimes(1)
    expect(server.urls()).toEqual(['http://127.0.0.1:8128/v1/embeddings'])
    await indexDocument(fileOf(3))
    expect(engine.stop).not.toHaveBeenCalled()
  })

  it('without a bundled server the Ollama lane is still taken', async () => {
    standOn('linux')
    engine.managed = false
    engine.running = false
    localFetch.mockResolvedValue(new Response(JSON.stringify({ embeddings: [[0, 1]] }), { status: 200 }))
    expect(await generateEmbeddings(['a'])).toEqual([[0, 1]])
    expect(String(localFetch.mock.calls[0][0])).toBe('http://localhost:11434/api/embed')
  })
})

describe('indexing a document', () => {
  it('phone: batches of sixteen, progress after each, in order', async () => {
    standOn('android')
    const server = embedServer()
    const progress: [number, number][] = []
    const { chunks } = await indexDocument(fileOf(40), 'nomic-embed-text', { onProgress: (d, t) => progress.push([d, t]) })
    const sizes = server.bodies().map((b) => b.input.length)
    expect(sizes.every((n) => n <= DEFAULT_MOBILE_RAG_LIMITS.batchSize)).toBe(true)
    expect(sizes.length).toBeGreaterThan(1)
    expect(sizes.reduce((a, b) => a + b, 0)).toBe(chunks.length)
    expect(progress.map(([d]) => d)).toEqual(sizes.map((_, i) => sizes.slice(0, i + 1).reduce((a, b) => a + b, 0)))
    expect(progress.at(-1)).toEqual([chunks.length, chunks.length])
    expect(chunks.every((c) => c.embedding.length === 3)).toBe(true)
  })

  it('phone: a cancel stops between two batches and still gives the slot back', async () => {
    standOn('iphone')
    embedServer()
    const controller = new AbortController()
    const err = await indexDocument(fileOf(40), 'nomic-embed-text', {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }).catch((e: unknown) => e)
    expect((err as Error).name).toBe('AbortError')
    expect(localFetch).toHaveBeenCalledTimes(1)
    expect(engine.stop).toHaveBeenCalledTimes(1)
  })

  it('phone: a file over the size limit is refused before it is read', async () => {
    standOn('android')
    setMobileRagLimits({ maxFileBytes: 100 })
    const err = await indexDocument(fileOf(5, 'big.txt')).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('document_too_large')
    expect((err as Error).message).toMatch(/"big\.txt" is too large for this device/)
    expect((err as Error).message).toMatch(/Split it into smaller files/)
    expect(localFetch).not.toHaveBeenCalled()
  })

  it('phone: a document over the passage limit is refused before it is embedded', async () => {
    standOn('android')
    setMobileRagLimits({ maxChunks: 5 })
    const err = await indexDocument(fileOf(40)).catch((e: unknown) => e)
    expect((err as { code?: string }).code).toBe('document_too_large')
    expect((err as Error).message).toMatch(/too long for this device/)
    expect(localFetch).not.toHaveBeenCalled()
  })

  it('desktop: one request with every passage, no limits', async () => {
    standOn('windows')
    const server = embedServer()
    setMobileRagLimits({ maxFileBytes: 1, maxChunks: 1, batchSize: 1 })
    const { chunks } = await indexDocument(fileOf(40))
    expect(server.bodies()).toHaveLength(1)
    expect(server.bodies()[0].input).toHaveLength(chunks.length)
    expect(chunks.length).toBeGreaterThan(16)
  })
})

describe('BM25, once per query', () => {
  const docs = Array.from({ length: 60 }, (_, i) =>
    `Document ${i} about ${i % 3 === 0 ? 'engines and fuel' : 'gardens and soil'} with number ${i} and more words ${'pad '.repeat(i % 7)}`)

  it('gives exactly the score the per-document function gives', () => {
    for (const query of ['engines fuel', 'Gardens', 'nothing matches this', 'number 12 soil']) {
      const prepared = bm25Prepare(query, docs)
      for (const doc of docs) {
        expect(bm25ScorePrepared(prepared, doc)).toBe(bm25Score(query, doc, docs))
      }
    }
  })

  it('walks the collection once, however many documents are scored', () => {
    let reads = 0
    const counted = new Proxy(docs, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1
        return Reflect.get(target, key, receiver)
      },
    })
    const prepared = bm25Prepare('engines fuel', counted)
    for (const doc of docs) bm25ScorePrepared(prepared, doc)
    expect(reads).toBe(docs.length)
  })

  it('the search prepares once and scores each chunk against that', () => {
    const s = src('api/rag.ts')
    expect(s).toContain('const prepared = bm25Prepare(query, chunks.map(c => c.content))')
    expect(s).toContain('bm25Score: bm25ScorePrepared(prepared, chunk.content),')
    expect(s).not.toContain('bm25Score(query, chunk.content, allDocTexts)')
  })
})
