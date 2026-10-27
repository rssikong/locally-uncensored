/**
 * Point 7 of the mobile groundwork, the create store.
 *
 * 1. Write load, measured. zustand's persist writes after every set(),
 *    whatever partialize keeps. setProgress runs every 2.5 s and every second
 *    of a render, and each call rewrote the whole persisted slice, gallery
 *    included, although nothing in it had moved. partialize alone did NOT
 *    prevent that (the first test below counts it). The store's storage now
 *    skips a write whose blob is already the stored one.
 *
 * 2. On a phone the backend axis has one end, LU Cloud, and the video tab
 *    takes the clip size of the cloud's default model instead of the square
 *    image size of an 'unknown' local model.
 *
 * Run: npx vitest run src/stores/__tests__/createStore-write-load.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DESKTOPS, HANDHELDS, standOn } from '../../test-support/devices'
import type { DeviceName } from '../../test-support/devices'

const backing = new Map<string, string>()
let writes: string[] = []
const localStorageShim = {
  getItem: (k: string) => backing.get(k) ?? null,
  setItem: (k: string, v: string) => { writes.push(k); backing.set(k, String(v)) },
  removeItem: (k: string) => void backing.delete(k),
  clear: () => backing.clear(),
  key: (i: number) => [...backing.keys()][i] ?? null,
  get length() { return backing.size },
} as Storage

const KEY = 'create-store'

async function freshStore(device: DeviceName) {
  vi.resetModules()
  standOn(device)
  vi.stubGlobal('localStorage', localStorageShim)
  return (await import('../createStore')).useCreateStore
}

beforeEach(() => {
  backing.clear()
  writes = []
})
afterEach(() => { vi.unstubAllGlobals() })

const storeWrites = () => writes.filter((k) => k === KEY).length

describe('the progress bar does not write the gallery to disk', () => {
  for (const device of ['windows', 'iphone'] as const) {
    it(`${device}: 200 progress ticks, 0 writes`, async () => {
      const store = await freshStore(device)
      // A gallery worth writing: 200 items is the cap.
      for (let i = 0; i < 200; i++) {
        store.getState().addToGallery({
          id: `g${i}`, type: 'image', filename: '', subfolder: '', prompt: 'a lighthouse at dusk '.repeat(10),
          negativePrompt: '', model: 'z-image-turbo', modelType: 'unknown', seed: i, steps: 20, cfgScale: 7,
          sampler: 'euler', scheduler: 'normal', width: 1024, height: 1024, batchSize: 1, createdAt: i,
          remoteUrl: `https://storage.example/${i}.png`, jobId: `g${i}`,
        } as never)
      }
      const blob = backing.get(KEY)!
      expect(blob.length).toBeGreaterThan(50_000)

      writes = []
      for (let i = 0; i < 200; i++) {
        store.getState().setProgress(i % 100, `Rendering in the cloud… ${i}s`)
        store.getState().setProgressPhase('sampling')
      }
      store.getState().setIsGenerating(true)
      store.getState().setError('x')
      store.getState().setError(null)
      store.getState().setIsGenerating(false)

      // Before the fix this number was 404, each one the full blob above.
      expect(storeWrites()).toBe(0)
      // And what is stored is byte for byte what it was.
      expect(backing.get(KEY)).toBe(blob)
      // The ticks themselves arrived.
      expect(store.getState().progressText).toBe('Rendering in the cloud… 199s')
    })
  }

  it('a change that partialize keeps is written, once', async () => {
    const store = await freshStore('windows')
    store.getState().setProgress(1)
    writes = []
    store.getState().addToPromptHistory('a lighthouse at dusk')
    expect(storeWrites()).toBe(1)
    expect(JSON.parse(backing.get(KEY)!).state.promptHistory).toEqual(['a lighthouse at dusk'])
    store.getState().setSteps(33)
    expect(storeWrites()).toBe(2)
    expect(JSON.parse(backing.get(KEY)!).state.steps).toBe(33)
  })

  it('a blob somebody removed is written again by the next set, even an unchanged one', async () => {
    const store = await freshStore('windows')
    store.getState().addToPromptHistory('a lighthouse at dusk')
    const blob = backing.get(KEY)!
    backing.delete(KEY)
    writes = []
    store.getState().setProgress(5)
    expect(storeWrites()).toBe(1)
    expect(backing.get(KEY)).toBe(blob)
  })

  it('a blob somebody replaced is written again too', async () => {
    const store = await freshStore('windows')
    store.getState().addToPromptHistory('a lighthouse at dusk')
    const blob = backing.get(KEY)!
    backing.set(KEY, '{"state":{},"version":2}')
    writes = []
    store.getState().setProgress(5)
    expect(storeWrites()).toBe(1)
    expect(backing.get(KEY)).toBe(blob)
  })
})

describe('the backend axis on a phone', () => {
  for (const device of HANDHELDS) {
    it(`${device}: LU Cloud from the first frame, and it stays`, async () => {
      const store = await freshStore(device)
      expect(store.getState().backend).toBe('cloud')
      store.getState().setBackend('local')
      expect(store.getState().backend).toBe('cloud')
      store.getState().setBackend('cloud')
      expect(store.getState().backend).toBe('cloud')
    })

    it(`${device}: a stored blob cannot bring the local track back`, async () => {
      backing.set(KEY, JSON.stringify({ state: { backend: 'local', mode: 'image' }, version: 2 }))
      const store = await freshStore(device)
      expect(store.getState().backend).toBe('cloud')
    })

    it(`${device}: the video tab takes the cloud clip size, the way back the image size`, async () => {
      const store = await freshStore(device)
      expect(store.getState().videoModel).toBe('')
      expect([store.getState().width, store.getState().height]).toEqual([1024, 1024])
      store.getState().setIntent('video')
      expect([store.getState().width, store.getState().height]).toEqual([1344, 768])
      store.getState().setIntent('image')
      expect([store.getState().width, store.getState().height]).toEqual([1024, 1024])
      store.getState().setMode('video')
      expect([store.getState().width, store.getState().height]).toEqual([1344, 768])
      store.getState().setMode('image')
      expect([store.getState().width, store.getState().height]).toEqual([1024, 1024])
      store.getState().setIntent('animate')
      expect([store.getState().width, store.getState().height]).toEqual([1344, 768])
    })
  }

  for (const device of DESKTOPS) {
    it(`DESKTOP UNCHANGED ${device}: local by default, and the switch switches`, async () => {
      const store = await freshStore(device)
      expect(store.getState().backend).toBe('local')
      store.getState().setBackend('cloud')
      expect(store.getState().backend).toBe('cloud')
      store.getState().setBackend('local')
      expect(store.getState().backend).toBe('local')
    })

    it(`DESKTOP UNCHANGED ${device}: without a video model the tab keeps the values it had`, async () => {
      const store = await freshStore(device)
      store.getState().setMode('video')
      expect([store.getState().width, store.getState().height, store.getState().steps, store.getState().cfgScale]).toEqual([1024, 1024, 20, 7])
      store.getState().setMode('image')
      store.getState().setIntent('video')
      expect([store.getState().width, store.getState().height]).toEqual([1024, 1024])
    })
  }
})
