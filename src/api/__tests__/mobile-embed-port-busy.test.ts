/**
 * iOS check of package 17, N-1: the document reader could not open its local
 * port ("address already in use", the desktop app on the same Mac held 8128),
 * and the Documents page said "This device does not have enough free memory to
 * read documents right now ... Close other apps". The real reason was lost in
 * loadEmbedderOnSingleSlot, and every try unloaded the chat model and loaded
 * it again, for a port that no unloading can free.
 *
 * Held here: the port sentence for a taken port, the memory sentence only for
 * memory, the chat model left loaded when the port is the reason, and loaded
 * again when it had to go first.
 *
 * Run: npx vitest run src/api/__tests__/mobile-embed-port-busy.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const PORT_WORDS = 'The LU Engine could not open the local port 8128: address already in use (os error 48)'

const engine = vi.hoisted(() => ({
  running: false,
  chat: null as null | { path: string; ctx: number },
  /** What a start of the embedder fails with, or null when it comes up. */
  startFails: null as null | string,
  /** Comes up only after the chat model went (memory). */
  onlyAlone: false,
  log: [] as string[],
}))

vi.mock('../engine', () => ({
  isManagedBuiltinActive: () => true,
  embedBaseUrl: () => 'http://127.0.0.1:8128/v1',
  bundledEmbedStatus: async () => ({ running: engine.running, healthy: engine.running }),
  // The real one swallows the error and hands its words back (api/engine.ts).
  ensureBundledEmbedAlive: async () => {
    if (engine.running) return null
    engine.log.push('embed:try')
    if (engine.startFails) return engine.startFails
    if (engine.onlyAlone && engine.chat) return null
    engine.running = true
    return null
  },
  bundledEngineStatus: async () => ({ running: !!engine.chat, healthy: !!engine.chat, port: 8127, model_path: engine.chat?.path ?? null, ctx: engine.chat?.ctx ?? null }),
  stopBundledEngine: async () => { engine.chat = null; engine.log.push('chat:stop') },
  startBundledEngine: async (path: string, tuning?: { ctx?: number }) => {
    engine.chat = { path, ctx: tuning?.ctx ?? 0 }
    engine.log.push(`chat:start:${path}`)
    return { port: 8127 }
  },
  listBundledModels: async () => [{ name: 'nomic-embed-text-v1.5.Q4.gguf', path: '/m/e.gguf' }],
  isEmbeddingGgufName: (n: string) => /embed/.test(n),
  stopBundledEmbed: async () => { engine.running = false },
}))

const localFetch = vi.hoisted(() => vi.fn())
vi.mock('../backend', () => ({
  localFetch,
  ollamaUrl: (p: string) => `http://localhost:11434/api${p}`,
  isMacOS: () => false,
  isLinux: () => false,
}))

import { generateEmbeddings, __resetSlotTurnForTests } from '../rag'
import {
  EMBEDDER_NO_ROOM_ALONE_MESSAGE, EMBEDDER_PORT_BUSY_MESSAGE, __resetModelSlotForTests, getSlotTurn,
  isEmbedPortBusy, isSingleSlotConflict, setEmbedderFitCheck,
} from '../../lib/model-slot'
import { reasonForUser } from '../../mobile/screens/agent/parts/documents-logic'

const read = () => generateEmbeddings(['a passage'], 'nomic-embed-text', { purpose: 'document-chat' }).catch((e: unknown) => e)

beforeEach(() => {
  engine.running = false
  engine.chat = { path: '/m/qwen.gguf', ctx: 4096 }
  engine.startFails = null
  engine.onlyAlone = false
  engine.log = []
  localFetch.mockReset()
  localFetch.mockImplementation(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { status: 200 }))
  __resetModelSlotForTests()
  __resetSlotTurnForTests()
  standOn('iphone')
})

describe('N-1: a taken port is named as a taken port', () => {
  it('the words of the shell are recognised, memory words are not', () => {
    expect(isEmbedPortBusy(PORT_WORDS)).toBe(true)
    expect(isEmbedPortBusy('The LU Engine could not open a local port. Every port it may use between 8128 and 8168 is taken')).toBe(true)
    expect(isEmbedPortBusy('Address already in use (os error 98)')).toBe(true)
    expect(isEmbedPortBusy('Not enough free memory to load this model')).toBe(false)
    expect(isEmbedPortBusy(null)).toBe(false)
    expect(isEmbedPortBusy(undefined)).toBe(false)
  })

  it('fit unknown, port taken: the port sentence, and the chat model is never unloaded', async () => {
    engine.startFails = PORT_WORDS
    const err = await read()
    expect(isSingleSlotConflict(err)).toBe(true)
    expect((err as Error).message).toBe(EMBEDDER_PORT_BUSY_MESSAGE)
    expect((err as Error).message).not.toMatch(/memory|Close other apps/i)
    expect(engine.log).toEqual(['embed:try'])
    expect(engine.chat?.path).toBe('/m/qwen.gguf')
    expect(getSlotTurn()).toBe('idle')
  })

  it('no room beside the chat model, then the port is taken: the port sentence, and the chat model is loaded again', async () => {
    let asked = 0
    // No room while the chat model is there, room once it went.
    setEmbedderFitCheck(() => (asked++ === 0 ? 'no-room' : 'fits'))
    engine.startFails = PORT_WORDS
    const err = await read()
    expect((err as Error).message).toBe(EMBEDDER_PORT_BUSY_MESSAGE)
    expect(engine.log).toEqual(['chat:stop', 'embed:try', 'chat:start:/m/qwen.gguf'])
    expect(engine.chat?.path).toBe('/m/qwen.gguf')
    expect(getSlotTurn()).toBe('idle')
  })

  it('memory stays memory: no port words, no start even alone, the memory sentence and the chat model back', async () => {
    engine.onlyAlone = true
    engine.startFails = 'Not enough free memory to load this model'
    const err = await read()
    expect((err as Error).message).toBe(EMBEDDER_NO_ROOM_ALONE_MESSAGE)
    expect(engine.log).toEqual(['embed:try', 'chat:stop', 'embed:try', 'chat:start:/m/qwen.gguf'])
    expect(engine.chat?.path).toBe('/m/qwen.gguf')
  })

  it('the reader that only fits alone still loads after the chat model went', async () => {
    engine.onlyAlone = true
    const out = await generateEmbeddings(['a passage'], 'nomic-embed-text', { purpose: 'document-chat' })
    expect(out).toEqual([[1, 0]])
    expect(engine.log.slice(0, 3)).toEqual(['embed:try', 'chat:stop', 'embed:try'])
  })

  it('the Documents row keeps the port sentence as it is', () => {
    expect(reasonForUser(EMBEDDER_PORT_BUSY_MESSAGE, 'single_slot_conflict')).toBe(EMBEDDER_PORT_BUSY_MESSAGE)
    expect(EMBEDDER_PORT_BUSY_MESSAGE).not.toMatch(/\u2014|\u2013/)
  })
})
