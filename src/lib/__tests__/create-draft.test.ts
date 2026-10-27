/**
 * The draft of Create: the record of the words, its age limit, and the keeper
 * that holds the files in step with the slots.
 */
import { describe, expect, it } from 'vitest'
import {
  DRAFT_KEY,
  DRAFT_TTL_MS,
  draftFileKeeper,
  memoryDraftFiles,
  parseDraftWords,
  readDraftWords,
  sortDraftFiles,
  wordsAreEmpty,
  writeDraftWords,
  type DraftSlot,
  type DraftWords,
} from '../create-draft'

const NOW = Date.UTC(2026, 9, 8, 12, 0)
const words = (over: Partial<DraftWords> = {}): Omit<DraftWords, 'v' | 'at'> => ({
  intent: 'image', prompt: '', negativePrompt: '', musicLyrics: '', characterTab: 'use', selectedCharacter: null, voiceFromJob: null, extendSource: null, models: { image: '', video: '', op: '' }, ...over,
})
function storage() {
  const map = new Map<string, string>()
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v), removeItem: (k: string) => void map.delete(k) }
}

describe('the words', () => {
  it('come back as they were written', () => {
    const st = storage()
    const w = words({ intent: 'edit', prompt: 'a fox in the snow', negativePrompt: 'blur', selectedCharacter: { id: 'c1', name: 'Mia', triggerWord: 'mia', family: 'flux' } })
    expect(writeDraftWords(st, w, false, NOW)).toBe(true)
    expect(readDraftWords(st, NOW + 1000)).toEqual({ v: 1, at: NOW, ...w })
  })

  it('an empty draft leaves no record, unless files are kept', () => {
    const st = storage()
    writeDraftWords(st, words({ prompt: 'x' }), false, NOW)
    writeDraftWords(st, words(), false, NOW)
    expect(st.map.has(DRAFT_KEY)).toBe(false)
    writeDraftWords(st, words(), true, NOW)
    expect(st.map.has(DRAFT_KEY)).toBe(true)
    expect(wordsAreEmpty(words({ intent: 'music' }))).toBe(false)
  })

  it('a draft that is too old, from the future or not a draft is no draft', () => {
    const raw = (over: object) => JSON.stringify({ v: 1, at: NOW, ...words({ prompt: 'x' }), ...over })
    expect(parseDraftWords(raw({}), NOW + DRAFT_TTL_MS)).not.toBeNull()
    expect(parseDraftWords(raw({}), NOW + DRAFT_TTL_MS + 1)).toBeNull()
    expect(parseDraftWords(raw({ at: NOW + 3_600_000 }), NOW)).toBeNull()
    expect(parseDraftWords(raw({ v: 2 }), NOW)).toBeNull()
    expect(parseDraftWords(raw({ at: 'yesterday' }), NOW)).toBeNull()
    expect(parseDraftWords('{not json', NOW)).toBeNull()
    expect(parseDraftWords('[1,2]', NOW)).toBeNull()
    expect(parseDraftWords(null, NOW)).toBeNull()
  })

  it('foreign fields and wrong types do not get through', () => {
    const got = parseDraftWords(JSON.stringify({
      v: 1, at: NOW, intent: 7, prompt: ['x'], negativePrompt: 'ok', characterTab: 'elsewhere', cloudImageCount: 4,
      selectedCharacter: { name: 'no id' }, voiceFromJob: { jobId: '' }, extendSource: { jobId: 'j1', url: 5, label: 'Clip' },
    }), NOW)
    expect(got).toEqual({
      v: 1, at: NOW, intent: 'image', prompt: '', negativePrompt: 'ok', musicLyrics: '', characterTab: 'use',
      selectedCharacter: null, voiceFromJob: null, extendSource: { jobId: 'j1', url: '', label: 'Clip' },
      models: { image: '', video: '', op: '' },
    })
    expect(got).not.toHaveProperty('cloudImageCount')
  })

  it('a phone that refuses to write answers false instead of throwing', () => {
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') }, removeItem: () => {} }
    expect(writeDraftWords(full, words({ prompt: 'x' }), false, NOW)).toBe(false)
    const broken = { getItem: () => { throw new Error('SecurityError') }, setItem: () => {}, removeItem: () => {} }
    expect(readDraftWords(broken, NOW)).toBeNull()
  })
})

describe('the files', () => {
  const slot = (name: string, key: object, bytes = 4): DraftSlot & { reads: number } => {
    const s = { slot: name, key, name: `${name}.png`, reads: 0, blob: () => { s.reads++; return new Blob([new Uint8Array(bytes)]) } }
    return s
  }

  it('writes what is new, leaves what is unchanged, removes what is gone', async () => {
    const store = memoryDraftFiles()
    const keeper = draftFileKeeper(store)
    const a = {}, b = {}
    const s1 = slot('source', a)
    const t0 = slot('train:0', b)
    await keeper.sync([s1, t0])
    expect((await store.all()).map((f) => f.slot).sort()).toEqual(['source', 'train:0'])
    await keeper.sync([s1, t0])
    expect(s1.reads).toBe(1)
    // The source was replaced, the training photo removed.
    const s2 = slot('source', {})
    await keeper.sync([s2])
    expect(s2.reads).toBe(1)
    expect((await store.all()).map((f) => f.slot)).toEqual(['source'])
  })

  it('leftovers of an earlier run that nobody adopted are removed on the first pass', async () => {
    const store = memoryDraftFiles()
    await store.put({ slot: 'video', blob: new Blob(['x']), name: 'old.mp4' })
    await store.put({ slot: 'source', blob: new Blob(['x']), name: 'kept.png' })
    const keeper = draftFileKeeper(store)
    const key = {}
    keeper.adopt([{ slot: 'source', key }])
    const s = slot('source', key)
    await keeper.sync([s])
    expect((await store.all()).map((f) => f.name)).toEqual(['kept.png'])
    expect(s.reads).toBe(0)
  })

  it('a file that is too large is not kept, and an older one in its slot goes', async () => {
    const store = memoryDraftFiles()
    const keeper = draftFileKeeper(store, 10)
    await keeper.sync([slot('video', {}, 8)])
    expect(await store.all()).toHaveLength(1)
    await keeper.sync([slot('video', {}, 11)])
    expect(await store.all()).toHaveLength(0)
  })

  it('a store that fails does not stop the rest, and the file is tried again', async () => {
    const inner = memoryDraftFiles()
    let fail = true
    const store = { ...inner, put: async (f: Parameters<typeof inner.put>[0]) => { if (fail && f.slot === 'source') throw new Error('QuotaExceededError'); return inner.put(f) } }
    const keeper = draftFileKeeper(store)
    const key = {}
    await keeper.sync([slot('source', key), slot('audio', {})])
    expect((await inner.all()).map((f) => f.slot)).toEqual(['audio'])
    fail = false
    await keeper.sync([slot('source', key), slot('audio', {})])
    expect((await inner.all()).map((f) => f.slot).sort()).toEqual(['audio', 'source'])
  })

  it('forgetAll empties the store, and the same files are written again afterwards', async () => {
    const store = memoryDraftFiles()
    const keeper = draftFileKeeper(store)
    const s = slot('source', {})
    await keeper.sync([s])
    await keeper.forgetAll()
    expect(await store.all()).toHaveLength(0)
    await keeper.sync([s])
    expect(await store.all()).toHaveLength(1)
  })

  it('sorts the stored files back into their places', () => {
    const f = (slotName: string) => ({ slot: slotName, blob: new Blob(['x']), name: slotName })
    const { single, lists } = sortDraftFiles([f('train:10'), f('source'), f('train:2'), f('ref:0'), f('train:0'), f('audio')])
    expect(Object.keys(single).sort()).toEqual(['audio', 'source'])
    expect(lists.train.map((x) => x.slot)).toEqual(['train:0', 'train:2', 'train:10'])
    expect(lists.ref.map((x) => x.slot)).toEqual(['ref:0'])
  })
})
