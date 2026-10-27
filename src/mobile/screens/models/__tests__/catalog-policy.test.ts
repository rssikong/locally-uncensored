import { describe, expect, it } from 'vitest'
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL } from '../../../data/mobile-models'
import type { FitDevice } from '../../../lib/device-fit'
import { paramsFromName, variantsFromTree } from '../parts/adapters/hf'
import { latestRuns } from '../parts/bench'
import { cardOfCatalog, defaultVariant, hitRouteId, parseRouteId, quantOfName, routeIdOfDownload } from '../parts/catalog'
import { DEFAULT_FILTERS, filterCatalog, fitOfCatalogModel } from '../parts/fit'
import { starterModels } from '../parts/fit'
import { catalogModelOffered, downloadVerdict, hubSearchOffered, isUnfilteredName, offeredCatalog, repoOffered, type StorePolicy } from '../parts/policy'
import { setStorePresetForTests } from '../../../policy'
import { storePolicy } from '../parts/policy'
import { LOW_STORAGE_BYTES, storageIsLow, storageShares } from '../parts/storage'
import { contextChoiceOf, contextOptions, tuningOfContextChoice, usesGraphics } from '../parts/tuning'

const OPEN: StorePolicy = { unfilteredCatalog: true, unfilteredMarketing: true, unfilteredWords: true, customModelUrl: true, hubSearch: true, ageGate: 'none' }
const STORE: StorePolicy = { unfilteredCatalog: false, unfilteredMarketing: false, unfilteredWords: false, customModelUrl: false, hubSearch: false, ageGate: 'declare-18' }
/** The Play build since 10.10.2026: the catalogue, its other packings and the user's own files, without the open search. */
const NO_SEARCH: StorePolicy = { unfilteredCatalog: true, unfilteredMarketing: true, unfilteredWords: true, customModelUrl: true, hubSearch: false, ageGate: 'declare-18' }
const mainstream = MOBILE_CHAT_MODELS.find((m) => !m.uncensored)!
const unfiltered = MOBILE_CHAT_MODELS.find((m) => m.uncensored)!
const fileOf = (m: { filename: string; downloadUrl: string }) => ({ filename: m.filename, url: m.downloadUrl })

describe('detail page ids', () => {
  it('reads a catalogue id, a repository and a file', () => {
    expect(parseRouteId(mainstream.id)).toEqual({ kind: 'catalog', model: mainstream })
    expect(parseRouteId('hf:bartowski/Foo-GGUF')).toEqual({ kind: 'hf', repo: 'bartowski/Foo-GGUF' })
    expect(parseRouteId('file:Foo-Q4_K_M')).toEqual({ kind: 'file', name: 'Foo-Q4_K_M' })
  })

  it('refuses what is no id', () => {
    expect(parseRouteId(undefined).kind).toBe('none')
    expect(parseRouteId('no-such-model').kind).toBe('none')
    expect(parseRouteId('hf:not a repo').kind).toBe('none')
    expect(parseRouteId('hf:https://evil.example/x').kind).toBe('none')
    expect(parseRouteId('file:').kind).toBe('none')
  })

  it('leads a download row to its model', () => {
    expect(routeIdOfDownload(mainstream.filename, mainstream.downloadUrl)).toBe(mainstream.id)
    expect(routeIdOfDownload('Foo-Q8_0.gguf', 'https://huggingface.co/bartowski/Foo-GGUF/resolve/main/Foo-Q8_0.gguf')).toBe(hitRouteId('bartowski/Foo-GGUF'))
    expect(routeIdOfDownload('Foo-Q8_0.gguf', undefined)).toBe('file:Foo-Q8_0')
  })

  it('reads the quantization from a file name', () => {
    expect(quantOfName('Foo-1B-Q4_K_M')).toBe('Q4_K_M')
    expect(quantOfName('foo.q8_0')).toBe('Q8_0')
    expect(quantOfName('foo')).toBeUndefined()
  })
})

describe('files of a Hugging Face repository', () => {
  const tree = [
    { type: 'file', path: 'Tiny-1B-Q8_0.gguf', size: 1200 },
    { type: 'file', path: 'Tiny-1B-Q4_K_M.gguf', size: 700 },
    { type: 'file', path: 'mmproj-Tiny-1B-f16.gguf', size: 300 },
    { type: 'file', path: 'README.md', size: 10 },
    { type: 'directory', path: 'extra', size: 0 },
  ]

  it('lists every quantization, smallest first, without projector files', () => {
    const variants = variantsFromTree(tree, 'lab/Tiny-1B-GGUF')
    expect(variants.map((v) => v.quant)).toEqual(['Q4_K_M', 'Q8_0'])
    expect(variants[0].totalBytes).toBe(700)
    expect(variants[0].files[0].url).toBe('https://huggingface.co/lab/Tiny-1B-GGUF/resolve/main/Tiny-1B-Q4_K_M.gguf')
  })

  it('offers Q4_K_M first, else the smallest single file', () => {
    const variants = variantsFromTree(tree, 'lab/Tiny-1B-GGUF')
    expect(defaultVariant(variants)?.quant).toBe('Q4_K_M')
    expect(defaultVariant(variants.filter((v) => v.quant !== 'Q4_K_M'))?.quant).toBe('Q8_0')
    expect(defaultVariant([])).toBeUndefined()
  })

  it('has nothing for a repository without GGUF files', () => {
    expect(variantsFromTree([{ type: 'file', path: 'model.safetensors', size: 5 }], 'lab/x')).toEqual([])
  })

  it('reads the parameters from a name', () => {
    expect(paramsFromName('Qwen3-4B-GGUF')).toBe(4)
    expect(paramsFromName('SmolLM2-360M-Instruct')).toBeCloseTo(0.36)
    expect(paramsFromName('mystery')).toBeUndefined()
  })
})

describe('store policy', () => {
  it('everything is allowed until a build says otherwise, and the App Store preset closes both', () => {
    setStorePresetForTests(null)
    expect(storePolicy()).toMatchObject(OPEN)
    setStorePresetForTests('appstore')
    expect(storePolicy()).toMatchObject(STORE)
    setStorePresetForTests(null)
  })

  it('every catalogue entry carries the mark', () => {
    for (const model of MOBILE_CHAT_MODELS) expect(typeof model.uncensored).toBe('boolean')
    // The mark and the name agree: what is called abliterated or uncensored is marked.
    for (const model of MOBILE_CHAT_MODELS) {
      if (/abliterat|uncensor/i.test(`${model.name} ${model.filename} ${model.repo}`)) expect(model.uncensored).toBe(true)
    }
  })

  it('without the unfiltered catalogue no marked model is offered', () => {
    const offered = offeredCatalog(STORE)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.some((m) => m.uncensored)).toBe(false)
    expect(offeredCatalog(OPEN).length).toBe(MOBILE_CHAT_MODELS.length)
    expect(catalogModelOffered(STORE, unfiltered)).toBe(false)
    expect(catalogModelOffered(STORE, mainstream)).toBe(true)
    expect(catalogModelOffered(OPEN, unfiltered)).toBe(true)
  })

  it('the onboarding finds a fitting proposal with both values, on every size of phone', () => {
    for (const policy of [OPEN, STORE]) {
      for (const ramGb of [3, 4, 6, 8, 12, 16]) {
        const device: FitDevice = { platform: 'android', ramGb }
        const list = starterModels(device, false, offeredCatalog(policy))
        expect(list.recommended, `${ramGb} GB`).not.toBeNull()
        expect(list.recommended!.uncensored).toBe(false)
      }
    }
  })

  it('reads a foreign file by its name', () => {
    expect(isUnfilteredName('huihui-ai/Qwen3-4B-abliterated-GGUF')).toBe(true)
    expect(isUnfilteredName('Some-Uncensored-7B')).toBe(true)
    expect(isUnfilteredName('Dolphin3.0-Llama3.2-1B')).toBe(true)
    expect(isUnfilteredName('bartowski/Qwen3-4B-GGUF')).toBe(false)
  })

  it('a repository from the search needs both permissions', () => {
    expect(repoOffered(OPEN, 'x/Foo-abliterated-GGUF')).toBe(true)
    expect(repoOffered({ ...OPEN, unfilteredCatalog: false }, 'x/Foo-abliterated-GGUF')).toBe(false)
    expect(repoOffered({ ...OPEN, unfilteredCatalog: false }, 'x/Foo-GGUF')).toBe(true)
    expect(repoOffered({ ...OPEN, customModelUrl: false }, 'x/Foo-GGUF')).toBe(false)
  })

  it('the last gate before a download', () => {
    const foreign = { filename: 'Foo-Q4_K_M.gguf', url: 'https://huggingface.co/x/Foo-GGUF/resolve/main/Foo-Q4_K_M.gguf' }
    const foreignUnfiltered = { filename: 'Foo-abliterated-Q4_K_M.gguf', url: 'https://huggingface.co/x/Foo-abliterated-GGUF/resolve/main/Foo-abliterated-Q4_K_M.gguf' }
    expect(downloadVerdict(OPEN, [fileOf(unfiltered), foreign, foreignUnfiltered])).toBe('ok')
    expect(downloadVerdict(STORE, [fileOf(mainstream)])).toBe('ok')
    expect(downloadVerdict(STORE, [fileOf(MOBILE_EMBED_MODEL)])).toBe('ok')
    expect(downloadVerdict(STORE, [fileOf(unfiltered)])).toBe('unfiltered')
    expect(downloadVerdict(STORE, [foreign])).toBe('custom')
    expect(downloadVerdict({ ...OPEN, unfilteredCatalog: false }, [foreign])).toBe('ok')
    expect(downloadVerdict({ ...OPEN, unfilteredCatalog: false }, [foreignUnfiltered])).toBe('unfiltered')
    // A catalogue file name with another address is a foreign file.
    expect(downloadVerdict(STORE, [{ filename: mainstream.filename, url: 'https://example.com/other.gguf' }])).toBe('custom')
  })

  it('without the open search only the repositories of the catalogue are offered', () => {
    expect(hubSearchOffered(OPEN)).toBe(true)
    expect(hubSearchOffered(NO_SEARCH)).toBe(false)
    // The switch never opens a search in a build without foreign files.
    expect(hubSearchOffered({ ...STORE, hubSearch: true })).toBe(false)
    expect(repoOffered(NO_SEARCH, 'x/Foo-GGUF')).toBe(false)
    expect(repoOffered(NO_SEARCH, 'x/Foo-lorablated-GGUF')).toBe(false)
    // The other packings of a catalogue model live in its repository: that page stays.
    expect(repoOffered(NO_SEARCH, mainstream.repo)).toBe(true)
    expect(repoOffered(NO_SEARCH, mainstream.repo.toUpperCase())).toBe(true)
    expect(repoOffered(NO_SEARCH, unfiltered.repo)).toBe(true)
    // A repository of a model this build does not list is none of the catalogue.
    expect(repoOffered({ ...NO_SEARCH, unfilteredCatalog: false }, unfiltered.repo)).toBe(false)
  })

  it('without the open search the last gate lets a foreign file through from a catalogue repository only', () => {
    const foreign = { filename: 'Foo-Q4_K_M.gguf', url: 'https://huggingface.co/x/Foo-GGUF/resolve/main/Foo-Q4_K_M.gguf' }
    const otherPacking = { filename: 'Another-Packing-Q8_0.gguf', url: `https://huggingface.co/${mainstream.repo}/resolve/main/Another-Packing-Q8_0.gguf` }
    expect(downloadVerdict(NO_SEARCH, [foreign])).toBe('custom')
    expect(downloadVerdict(NO_SEARCH, [{ filename: 'a.gguf', url: 'https://example.com/a.gguf' }])).toBe('custom')
    expect(downloadVerdict(NO_SEARCH, [otherPacking])).toBe('ok')
    expect(downloadVerdict(NO_SEARCH, [fileOf(mainstream), fileOf(unfiltered), fileOf(MOBILE_EMBED_MODEL)])).toBe('ok')
    // With the search the same file is fine, as before.
    expect(downloadVerdict(OPEN, [foreign])).toBe('ok')
  })
})

describe('engine settings', () => {
  it('shows Auto until the user picked a size the phone offers', () => {
    expect(contextChoiceOf({ ctx: 8192, ctxChosen: false })).toBe('auto')
    expect(contextChoiceOf({ ctx: 2048, ctxChosen: true })).toBe('2048')
    // M10: a size picked in the chat options (3K) is marked as that size, never as "auto".
    expect(contextChoiceOf({ ctx: 3072, ctxChosen: true })).toBe('3072')
    expect(contextOptions([1024, 2048, 4096], { ctx: 3072, ctxChosen: true })).toEqual([1024, 2048, 3072, 4096])
    expect(contextOptions([1024, 2048, 4096], { ctx: 2048, ctxChosen: true })).toEqual([1024, 2048, 4096])
    expect(contextOptions([1024, 2048], { ctx: 8192, ctxChosen: false })).toEqual([1024, 2048])
  })

  it('turns a choice back into the stored values', () => {
    expect(tuningOfContextChoice('2048')).toEqual({ ctx: 2048, ctxChosen: true })
    expect(tuningOfContextChoice('auto').ctxChosen).toBe(false)
    expect(tuningOfContextChoice('nonsense').ctxChosen).toBe(false)
  })

  it('graphics acceleration is off only with zero layers', () => {
    expect(usesGraphics({ gpuLayers: -1 })).toBe(true)
    expect(usesGraphics({ gpuLayers: 20 })).toBe(true)
    expect(usesGraphics({ gpuLayers: 0 })).toBe(false)
  })
})

describe('storage page', () => {
  it('splits the bar into three shares', () => {
    expect(storageShares(60, 20, 20)).toEqual({ models: 0.6, chats: 0.2, free: 0.2 })
    expect(storageShares(0, 0, null)).toEqual({ models: 0, chats: 0, free: 0 })
    expect(storageShares(-5, 10, 10)).toEqual({ models: 0, chats: 0.5, free: 0.5 })
  })

  it('warns below 1 GB of free storage, not when it is unknown', () => {
    expect(storageIsLow(LOW_STORAGE_BYTES - 1)).toBe(true)
    expect(storageIsLow(LOW_STORAGE_BYTES)).toBe(false)
    expect(storageIsLow(null)).toBe(false)
  })
})

describe('benchmark results', () => {
  it('keeps the newest run of each prompt, in the order of the prompts', () => {
    const run = (promptId: string, tokensPerSec: number) => ({ modelName: 'm', promptId, tokensPerSec, timeToFirstToken: 1, totalTime: 1, totalTokens: 1, timestamp: 0 })
    const latest = latestRuns([run('code', 1), run('speed', 2), run('speed', 3), run('unknown', 9)])
    expect(latest.map((r) => [r.promptId, r.tokensPerSec])).toEqual([['speed', 3], ['code', 1]])
  })
})

describe('thinking models and Gemma 4 in the catalogue', () => {
  it('a card carries the mark exactly for the models the catalogue lists as thinking', () => {
    const marked = MOBILE_CHAT_MODELS.filter((m) => cardOfCatalog(m).thinking).map((m) => m.id)
    expect(marked).toEqual(MOBILE_CHAT_MODELS.filter((m) => m.thinking).map((m) => m.id))
    expect(marked.length).toBeGreaterThan(0)
    expect(marked).toContain('qwen3-0.6b')
    // Gemma 4 does not write a thinking block by itself (ENGINE-NACHZUG.md section 8, point 5).
    expect(marked).not.toContain('gemma-4-e2b')
    expect(cardOfCatalog(MOBILE_CHAT_MODELS.find((m) => !m.thinking)!).thinking).toBe(false)
  })

  it('Gemma 4 is offered in every store preset: the phone engine speaks its chat format now', () => {
    for (const policy of [OPEN, STORE]) {
      expect(offeredCatalog(policy).some((m) => m.id === 'gemma-4-e2b')).toBe(true)
    }
    expect(parseRouteId('gemma-4-e2b').kind).toBe('catalog')
  })

  it('Gemma 4 shows in the list wherever it runs, and with the filter off everywhere', () => {
    const big: FitDevice = { platform: 'android', ramGb: 12 }
    const small: FitDevice = { platform: 'android', ramGb: 4 }
    const gemma = MOBILE_CHAT_MODELS.find((m) => m.id === 'gemma-4-e2b')!
    expect(fitOfCatalogModel(gemma, big).level).not.toBe('too-large')
    expect(filterCatalog(offeredCatalog(OPEN), big, DEFAULT_FILTERS).some((m) => m.id === gemma.id)).toBe(true)
    // Too large for a 4 GB phone: hidden by "Fits this phone", shown and locked once that filter is off.
    expect(filterCatalog(offeredCatalog(OPEN), small, DEFAULT_FILTERS).some((m) => m.id === gemma.id)).toBe(false)
    expect(filterCatalog(offeredCatalog(OPEN), small, { ...DEFAULT_FILTERS, fitsOnly: false }).some((m) => m.id === gemma.id)).toBe(true)
  })
})
