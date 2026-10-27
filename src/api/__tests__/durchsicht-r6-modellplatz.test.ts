/**
 * Durchsicht Runde 6: Beweise fuer Fehler am Modellplatz (src/lib/model-slot.ts, src/api/rag.ts).
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
import { isSearchStopped } from '../../lib/slot-wait'
import {
  __resetModelSlotForTests, getDocumentJobState, setEmbedderFitCheck, slotIsFree, whenSlotIdle,
} from '../../lib/model-slot'
import { useGenerationStore } from '../../stores/generationStore'
import type { TextChunk } from '../../types/rag'

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


// Durchsicht Runde 6, Schwerpunkt 4 (Modellplatz). Der erste Test war der
// Beweis des Fehlers (damals mit it.fails markiert). Seit Runde 7 ist der
// Fehler behoben und der Test ein gewoehnlicher. Die Tests darunter halten
// die Behebung fest und beweisen den Wettlauf, der in Runde 6 Vermutung blieb.
//
// Run: npx vitest run src/api/__tests__/durchsicht-r6-modellplatz.test.ts

const smallPhone = () => setEmbedderFitCheck(() => (engine.chat ? 'no-room' : 'fits'))

describe('Durchsicht R6, Befund 1: die Suche eines zweiten Chats entlaedt das Chatmodell unter einer laufenden Antwort', () => {
  it('eine Dokumentsuche wartet, solange das Modell auf dem Geraet in einem anderen Chat antwortet', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    embedServer()
    // Chat 1 schreibt gerade eine lokale Antwort.
    useGenerationStore.getState().setGenerating('chat-1', true)
    // Chat 2 hat Dokumente an und sendet: useChat ruft retrieveContext.
    const search = retrieveContext('When are you open?', [oldChunk])
    await tick()
    await tick()
    // Gewuenscht: das Chatmodell bleibt geladen, bis die Antwort fertig ist.
    expect(engine.log).not.toContain('chat:stop')
    useGenerationStore.getState().setGenerating('chat-1', false)
    await search
  })
})

const sentence = (i: number) => `Sentence number ${i} is long enough to be kept as a passage of its own.`
const fileOf = (n: number, name = 'notes.txt') =>
  new File([Array.from({ length: n }, (_, i) => sentence(i)).join('\n\n')], name, { type: 'text/plain' })

describe('Runde 7, Befund 1: die Suche wartet auf den Modellplatz', () => {
  const answering = (id: string, lane: 'local' | 'cloud' = 'local') => {
    useGenerationStore.getState().bookRun(id, lane, {})
    useGenerationStore.getState().setGenerating(id, true)
  }

  it('zwei Chats: die Suche laeuft, sobald die Antwort des anderen fertig ist, und das Chatmodell ist danach wieder da', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    const server = embedServer()
    answering('chat-1')
    let done = false
    const search = retrieveContext('When are you open?', [oldChunk], undefined, undefined, { conversationId: 'chat-2' }).then((r) => { done = true; return r })
    await tick()
    expect(done).toBe(false)
    expect(server.requests).toHaveLength(0)
    expect(engine.log).toEqual([])
    // Solange sie nur wartet, haelt die Suche den Platz nicht.
    expect(slotIsFree()).toBe(true)
    useGenerationStore.getState().setGenerating('chat-1', false)
    const result = await search
    expect(result.context.chunks).toHaveLength(1)
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/smol.gguf:2048'])
    expect(slotIsFree()).toBe(true)
  })

  it('eine Antwort aus der Cloud und die eigene Antwort halten die Suche nicht auf', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    embedServer()
    answering('chat-cloud', 'cloud')
    // Der eigene Lauf (ein Schleifendurchgang des Agenten) zaehlt nicht als fremde Antwort.
    answering('chat-2')
    const result = await retrieveContext('When are you open?', [oldChunk], undefined, undefined, { conversationId: 'chat-2' })
    expect(result.context.chunks).toHaveLength(1)
  })

  it('Stop wirkt: die wartende Suche endet, das Chatmodell bleibt geladen, der Stop-Griff ist wieder weg', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    const server = embedServer()
    answering('chat-1')
    const search = retrieveContext('When are you open?', [oldChunk], undefined, undefined, { conversationId: 'chat-2' })
    const outcome = search.then(() => 'answered', (err: unknown) => err)
    await tick()
    // Der Stop-Knopf des wartenden Chats ruft den Griff, den die Suche fuer die Wartezeit eingetragen hat.
    const stop = useGenerationStore.getState().aborters['chat-2']
    expect(typeof stop).toBe('function')
    stop()
    const err = await outcome
    expect(isSearchStopped(err)).toBe(true)
    expect(engine.log).toEqual([])
    expect(server.requests).toHaveLength(0)
    expect(useGenerationStore.getState().aborters['chat-2']).toBeUndefined()
    expect(slotIsFree()).toBe(true)
    // Die Antwort in Chat 1 wurde nie beruehrt.
    expect(engine.chat).toEqual({ path: '/m/smol.gguf', ctx: 2048 })
  })

  it('Stop ueber ein Signal des Aufrufers (Agentenmodus) wirkt genauso, und ein Griff, der schon da war, bleibt', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    embedServer()
    answering('chat-1')
    const own = () => undefined
    useGenerationStore.getState().registerAborter('chat-2', own)
    const abort = new AbortController()
    const outcome = retrieveContext('q', [oldChunk], undefined, undefined, { conversationId: 'chat-2', signal: abort.signal })
      .then(() => 'answered', (err: unknown) => err)
    await tick()
    expect(useGenerationStore.getState().aborters['chat-2']).toBe(own)
    abort.abort()
    expect(isSearchStopped(await outcome)).toBe(true)
    expect(engine.log).toEqual([])
  })

  it('eine Antwort, die waehrend der Suche beginnen will, wartet, bis das Chatmodell zurueck ist', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    const server = embedServer()
    server.hold()
    const search = retrieveContext('When are you open?', [oldChunk], undefined, undefined, { conversationId: 'chat-2' })
    // Schon im selben Schritt belegt, noch bevor das Chatmodell entladen ist.
    expect(slotIsFree()).toBe(false)
    // Die Suche ist kein Lesen: der Bildschirm sagt dafuer nichts.
    expect(getDocumentJobState()).toBe('none')
    let sendMayGo = false
    const send = whenSlotIdle().then(() => { sendMayGo = true })
    await tick()
    await tick()
    expect(engine.chat).toBeNull()
    expect(sendMayGo).toBe(false)
    server.open()
    await search
    await send
    expect(sendMayGo).toBe(true)
    expect(engine.chat).toEqual({ path: '/m/smol.gguf', ctx: 2048 })
  })

  it('eine Suche wartet weiter auf ein laufendes Lesen', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    const server = embedServer()
    server.hold()
    const reading = indexDocument(fileOf(2))
    await tick()
    let searched = false
    const search = retrieveContext('q', [oldChunk]).then(() => { searched = true })
    await tick()
    expect(searched).toBe(false)
    server.open()
    await reading
    await search
    expect(searched).toBe(true)
    expect(engine.chat).toEqual({ path: '/m/smol.gguf', ctx: 2048 })
  })

  it('Desktop: die Suche wartet auf nichts', async () => {
    standOn('mac')
    engine.running = true
    embedServer()
    answering('chat-1')
    const result = await retrieveContext('When are you open?', [oldChunk], undefined, undefined, { conversationId: 'chat-2' })
    expect(result.context.chunks).toHaveLength(1)
    expect(useGenerationStore.getState().aborters['chat-2']).toBeUndefined()
  })
})

describe('Runde 7, Befund 1: der vermutete Wettlauf zweier gleichzeitiger Lesevorgaenge', () => {
  // Bewiesen in Runde 7: vor der Behebung stand hier ['chat:stop', 'chat:stop'].
  // Beide Lesevorgaenge fanden "noch niemand hat den Platz geliehen" und
  // entluden beide das Chatmodell (src/api/rag.ts, borrowSlot).
  it('zwei Dateien zugleich auf einem kleinen Handy: beide werden gelesen, das Chatmodell geht einmal und kommt einmal zurueck', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    embedServer()
    const both = await Promise.allSettled([indexDocument(fileOf(3, 'a.txt')), indexDocument(fileOf(3, 'b.txt'))])
    expect(both.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(engine.log.filter((l) => l === 'chat:stop')).toHaveLength(1)
    expect(engine.log.filter((l) => l.startsWith('chat:start'))).toHaveLength(1)
    expect(engine.chat).toEqual({ path: '/m/smol.gguf', ctx: 2048 })
  })
})

describe('Runde 7, Befund 1: der Wettlauf mit einer Engine, die wirklich schon gestoppt ist', () => {
  it('der zweite Lesevorgang gibt den Platz des ersten nicht zurueck, waehrend der noch liest', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    const server = embedServer()
    server.hold()
    const first = indexDocument(fileOf(3, 'a.txt'))
    const second = indexDocument(fileOf(3, 'b.txt'))
    await tick()
    await tick()
    // Beide lesen, das Chatmodell ist genau einmal gegangen und noch nicht zurueck.
    expect(engine.log).toEqual(['chat:stop', 'embed:start'])
    server.open()
    const both = await Promise.allSettled([first, second])
    expect(both.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/smol.gguf:2048'])
  })

  it('scheitert einer der beiden, liest der andere zu Ende, und erst dann kommt das Chatmodell zurueck', async () => {
    standOn('iphone')
    engine.chat = { path: '/m/smol.gguf', ctx: 2048 }
    smallPhone()
    let calls = 0
    localFetch.mockImplementation(async (_url: string, init: { body: string }) => {
      const input = (JSON.parse(init.body) as { input: string[] }).input
      calls += 1
      if (calls === 1) return new Response('boom', { status: 500 })
      await tick()
      if (!engine.running) throw new Error('proxy_localhost: error sending request')
      return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 0, 0] })) }), { status: 200 })
    })
    const both = await Promise.allSettled([indexDocument(fileOf(3, 'a.txt')), indexDocument(fileOf(3, 'b.txt'))])
    expect(both.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected'])
    expect(engine.log).toEqual(['chat:stop', 'embed:start', 'embed:stop', 'chat:start:/m/smol.gguf:2048'])
  })
})
