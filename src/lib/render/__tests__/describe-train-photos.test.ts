/**
 * 3.0.8 D28 "Describe photos": nur ein lokales Chat-Modell, das Bilder sieht,
 * und die Antwort wird zu einer kurzen Zeile ohne Gesicht.
 *
 * Run: npx vitest run src/lib/render/__tests__/describe-train-photos.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  lane: 'local' as 'local' | 'cloud',
  sees: true,
  answer: 'red jacket, short hair, at the beach',
  calls: [] as { model: string; messages: { role: string; images?: unknown[] }[] }[],
}))

vi.mock('../../run-lane-of-model', () => ({ laneOf: () => h.lane, currentLaneFacts: () => ({}) }))
vi.mock('../../../api/computer-executor', () => ({ modelSeesImages: async () => h.sees }))
vi.mock('../../run-slot', () => ({
  runInLane: async (_o: unknown, body: () => Promise<void>) => { await body(); return 'ran' },
}))
vi.mock('../../../api/providers', () => ({
  getProviderIdFromModel: () => 'ollama',
  getProviderForModel: (model: string) => ({
    modelId: model,
    provider: {
      async *chatStream(m: string, messages: { role: string; images?: unknown[] }[]) {
        h.calls.push({ model: m, messages })
        yield { content: h.answer, done: true }
      },
    },
  }),
}))

import { useModelStore } from '../../../stores/modelStore'
import { cleanDescription, describeAvailability, describeTrainPhoto, DESCRIBE_SYSTEM } from '../describe-train-photos'

beforeEach(() => {
  h.lane = 'local'
  h.sees = true
  h.answer = 'red jacket, short hair, at the beach'
  h.calls = []
  useModelStore.setState({ activeModel: 'gemma4:e4b' })
})

describe('Describe photos', () => {
  it('ohne Chat-Modell, mit Cloud-Modell oder ohne Bildsicht: nicht verfuegbar, mit Grund', async () => {
    useModelStore.setState({ activeModel: null })
    expect((await describeAvailability()).available).toBe(false)
    useModelStore.setState({ activeModel: 'gemma4:e4b' })
    h.lane = 'cloud'
    const cloud = await describeAvailability()
    expect(cloud.available).toBe(false)
    expect(cloud.hint).toContain('local chat model')
    h.lane = 'local'
    h.sees = false
    expect((await describeAvailability()).hint).toContain('cannot see images')
    h.sees = true
    expect((await describeAvailability()).available).toBe(true)
  })

  it('schickt das Foto als Bild an das lokale Modell und gibt eine Zeile zurueck', async () => {
    const out = await describeTrainPhoto(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }))
    expect(out).toBe('red jacket, short hair, at the beach')
    expect(h.calls).toHaveLength(1)
    const user = h.calls[0].messages.find((m) => m.role === 'user')
    expect(user?.images).toHaveLength(1)
  })

  it('ein Cloud-Modell bekommt das Foto nie', async () => {
    h.lane = 'cloud'
    expect(await describeTrainPhoto(new Blob([new Uint8Array([1])], { type: 'image/png' }))).toBeNull()
    expect(h.calls).toHaveLength(0)
  })

  it('die Anweisung schliesst Gesicht und Identitaet aus', () => {
    expect(DESCRIBE_SYSTEM).toMatch(/Never describe the face/)
    expect(DESCRIBE_SYSTEM).toMatch(/clothing, hairstyle/)
  })

  it('raeumt die Antwort auf und verwirft Unbrauchbares', () => {
    expect(cleanDescription('<think>hmm</think>Caption: "blue dress, park."\nmore')).toBe('blue dress, park')
    expect(cleanDescription('<think>still thinking')).toBeNull()
    expect(cleanDescription("I'm sorry, I can't help")).toBeNull()
    expect(cleanDescription('   ')).toBeNull()
  })
})
