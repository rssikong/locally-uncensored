import { describe, expect, it } from 'vitest'
import { ONBOARDING_EMBED_MODEL } from '../../../lib/constants'
import { planModelDownload } from '../../../api/discover'
import type { DiscoverModel } from '../../../api/model-bundles'
import { RAM_CLASSES } from '../device-memory'
import {
  MOBILE_CHAT_MODELS,
  MOBILE_EMBED_MODEL,
  MOBILE_RECOMMENDATIONS,
  NOT_RECOMMENDED,
  TIGHT_RECOMMENDATIONS,
  kvBytesPerToken,
  mayBeRecommended,
  mobileModelById,
  recommendedModelsFor,
  toOnboardingModel,
} from '../mobile-models'

const GIB = 1_073_741_824
const DASHES = /[\u2012\u2013\u2014\u2015]/

describe('mobile chat catalog: format', () => {
  it('is not empty and has both kinds', () => {
    expect(MOBILE_CHAT_MODELS.length).toBeGreaterThanOrEqual(12)
    expect(MOBILE_CHAT_MODELS.some((m) => m.uncensored)).toBe(true)
    expect(MOBILE_CHAT_MODELS.some((m) => !m.uncensored)).toBe(true)
  })

  it.each(MOBILE_CHAT_MODELS.map((m) => [m.id, m] as const))('%s is a well formed entry', (_id, m) => {
    const url = new URL(m.downloadUrl)
    expect(url.protocol).toBe('https:')
    expect(url.hostname).toBe('huggingface.co')
    expect(url.pathname).toBe(`/${m.repo}/resolve/main/${m.filename}`)
    expect(url.search).toBe('')
    expect(m.filename.endsWith('.gguf')).toBe(true)
    expect(m.filename).not.toMatch(/[\\/\s]/)
    expect(m.filename.toLowerCase()).toContain('q4_k_m')
    expect(m.filename.toLowerCase()).not.toContain('mmproj')
    expect(m.quant).toBe('Q4_K_M')

    expect(Number.isInteger(m.sizeBytes)).toBe(true)
    expect(m.sizeBytes).toBeGreaterThan(100_000_000)
    // A phone catalog: nothing above 3.5 GiB.
    expect(m.sizeBytes).toBeLessThan(3.5 * GIB)
    expect(m.expectedBytes).toBe(m.sizeBytes)
    expect(m.sizeGB).toBeCloseTo(m.sizeBytes / GIB, 9)
    expect(m.sha256).toMatch(/^[0-9a-f]{64}$/)

    expect(m.license.length).toBeGreaterThan(1)
    expect(['apache-2.0', 'mit', 'gemma', 'llama3.2', 'llama3']).toContain(m.license)
    if (['gemma', 'llama3.2', 'llama3'].includes(m.license)) expect(m.licenseNote).toBeTruthy()

    expect(m.paramsB).toBeGreaterThanOrEqual(0.3)
    expect(m.paramsB).toBeLessThanOrEqual(4.1)
    if (m.kvSource === 'formula') expect(m.kvBytesPerToken).toBe(kvBytesPerToken(m.arch))
    else expect(m.kvBytesPerToken).toBeLessThan(kvBytesPerToken(m.arch))
    expect(m.kvBytesPerToken).toBeGreaterThan(0)
    expect(m.unfiltered).toBe(m.uncensored)
    expect(typeof m.thinking).toBe('boolean')
    expect(m.trainedContext).toBeGreaterThanOrEqual(4096)

    expect(m.name.length).toBeGreaterThan(3)
    expect(m.description.length).toBeGreaterThan(10)
    expect(m.tags).toContain('Q4_K_M')
    expect(m.tags.includes('Unfiltered')).toBe(m.uncensored)
    expect(m.released).toMatch(/^20\d\d-\d\d$/)
    for (const text of [m.name, m.description, m.blurb ?? '', m.licenseNote ?? '', ...m.tags]) expect(text).not.toMatch(DASHES)
  })

  it('has no duplicate ids, names, filenames, URLs or digests', () => {
    for (const key of ['id', 'name', 'filename', 'downloadUrl', 'sha256'] as const) {
      const values = MOBILE_CHAT_MODELS.map((m) => m[key].toLowerCase())
      expect(new Set(values).size, key).toBe(values.length)
    }
    expect(MOBILE_CHAT_MODELS.map((m) => m.filename)).not.toContain(MOBILE_EMBED_MODEL.filename)
  })

  it('is what the existing download logic takes', () => {
    for (const m of MOBILE_CHAT_MODELS) {
      const asDesktop: DiscoverModel = m
      const plan = planModelDownload(asDesktop, m.downloadUrl, m.filename, m.expectedBytes)
      expect(plan).toEqual([{ url: m.downloadUrl, filename: m.filename, expectedBytes: m.sizeBytes, sha256: m.sha256 }])
    }
  })

  it('converts to the onboarding shape of the desktop', () => {
    const m = MOBILE_CHAT_MODELS[0]
    const o = toOnboardingModel(m, true)
    expect(o).toMatchObject({
      name: m.id, label: m.name, recommended: true, uncensored: m.uncensored, vramGB: 0,
      downloadUrl: m.downloadUrl, filename: m.filename, expectedBytes: m.sizeBytes, sha256: m.sha256,
    })
    expect(toOnboardingModel(m).recommended).toBe(false)
  })
})

describe('what the measurement run changed (KATALOG-PROBE.md)', () => {
  it('carries the measured KV cache for the Qwen 3.5 entries and Gemma 4, and the formula for all others', () => {
    const measured = Object.fromEntries(MOBILE_CHAT_MODELS.filter((m) => m.kvSource === 'measured').map((m) => [m.id, m.kvBytesPerToken]))
    // KiB per token times 1024: 12, 32 and 18 KiB (section 6 of the report).
    expect(measured).toEqual({
      'qwen3.5-0.8b': 12288,
      'qwen3.5-2b': 12288,
      'qwen3.5-4b': 32768,
      'gemma-4-e2b': 18432,
      'qwen3.5-0.8b-abliterated': 12288,
      'qwen3.5-2b-abliterated': 12288,
      'qwen3.5-4b-abliterated': 32768,
    })
    // The figures the report confirmed to the byte, spot checked.
    expect(mobileModelById('qwen3-0.6b')!.kvBytesPerToken).toBe(112 * 1024)
    expect(mobileModelById('gemma-3-4b')!.kvBytesPerToken).toBe(136 * 1024)
    expect(mobileModelById('smollm2-360m')!.kvBytesPerToken).toBe(40 * 1024)
  })

  it('marks exactly the ten models that wrote a think block', () => {
    expect(MOBILE_CHAT_MODELS.filter((m) => m.thinking).map((m) => m.id).sort()).toEqual([
      'qwen3-0.6b',
      'qwen3-1.7b',
      'qwen3-1.7b-abliterated',
      'qwen3.5-0.8b',
      'qwen3.5-0.8b-abliterated',
      'qwen3.5-2b',
      'qwen3.5-2b-abliterated',
      'qwen3.5-4b',
      'qwen3.5-4b-abliterated',
      'smollm3-3b',
    ])
  })

  it('has one unambiguous mark for the store switch', () => {
    for (const m of MOBILE_CHAT_MODELS) {
      expect(m.unfiltered, m.id).toBe(m.uncensored)
      expect(m.unfiltered, m.id).toBe(/abliterated|dolphin|hermes/i.test(m.id))
    }
  })

  it('keeps the models that failed the plain question out of every proposal', () => {
    expect(Object.keys(NOT_RECOMMENDED).sort()).toEqual(['gemma-3-1b-abliterated', 'qwen2.5-1.5b-abliterated', 'smollm2-360m'])
    for (const id of Object.keys(NOT_RECOMMENDED)) {
      expect(mobileModelById(id), id).toBeDefined()
      expect(mayBeRecommended(id)).toBe(false)
    }
    for (const platform of ['ios', 'android'] as const) {
      for (const [cls, rec] of Object.entries(MOBILE_RECOMMENDATIONS[platform])) {
        expect(mayBeRecommended(rec.uncensored), `${platform} ${cls}: ${rec.uncensored}`).toBe(true)
        expect(mayBeRecommended(rec.mainstream), `${platform} ${cls}: ${rec.mainstream}`).toBe(true)
      }
    }
  })

  it('has in every class a proposal that survives unfilteredCatalog === false', () => {
    for (const platform of ['ios', 'android'] as const) {
      for (const cls of RAM_CLASSES[platform]) {
        const filtered = MOBILE_CHAT_MODELS.filter((m) => !m.unfiltered)
        const rec = recommendedModelsFor(platform, cls)!
        expect(filtered.map((m) => m.id), `${platform} ${cls}`).toContain(rec.mainstream.id)
        expect(rec.mainstream.unfiltered).toBe(false)
        expect(rec.uncensored.unfiltered).toBe(true)
      }
    }
  })

  it('names its tight proposals by class and kind', () => {
    for (const key of TIGHT_RECOMMENDATIONS) {
      const [platform, cls, kind] = key.split(':')
      expect(['ios', 'android']).toContain(platform)
      expect(RAM_CLASSES[platform as 'ios' | 'android']).toContain(Number(cls))
      expect(['mainstream', 'uncensored']).toContain(kind)
    }
  })
})

describe('embedding model', () => {
  it('is the same file the desktop onboarding downloads', () => {
    expect(MOBILE_EMBED_MODEL.downloadUrl).toBe(ONBOARDING_EMBED_MODEL.downloadUrl)
    expect(MOBILE_EMBED_MODEL.filename).toBe(ONBOARDING_EMBED_MODEL.filename)
  })

  it('is well formed', () => {
    expect(MOBILE_EMBED_MODEL.downloadUrl.startsWith('https://huggingface.co/')).toBe(true)
    expect(MOBILE_EMBED_MODEL.filename.endsWith('.gguf')).toBe(true)
    expect(MOBILE_EMBED_MODEL.sizeBytes).toBeGreaterThan(0)
    expect(MOBILE_EMBED_MODEL.expectedBytes).toBe(MOBILE_EMBED_MODEL.sizeBytes)
    expect(MOBILE_EMBED_MODEL.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(MOBILE_EMBED_MODEL.license).toBe('apache-2.0')
  })
})

describe('recommendations', () => {
  it('cover exactly the RAM classes of each platform with existing models of the right kind', () => {
    for (const platform of ['ios', 'android'] as const) {
      expect(Object.keys(MOBILE_RECOMMENDATIONS[platform]).map(Number).sort((a, b) => a - b)).toEqual(RAM_CLASSES[platform])
      for (const rec of Object.values(MOBILE_RECOMMENDATIONS[platform])) {
        expect(mobileModelById(rec.uncensored)?.uncensored, rec.uncensored).toBe(true)
        expect(mobileModelById(rec.mainstream)?.uncensored, rec.mainstream).toBe(false)
      }
    }
  })

  it('never recommend a smaller model to a larger class', () => {
    // By parameters, not by file size: Qwen3 1.7B (8 GB) is a 10 MB smaller
    // file than Qwen 2.5 1.5B (6 GB) and still the larger model.
    for (const platform of ['ios', 'android'] as const) {
      let lastU = 0
      let lastM = 0
      for (const cls of RAM_CLASSES[platform]) {
        const rec = recommendedModelsFor(platform, cls)!
        expect(rec.uncensored.paramsB).toBeGreaterThanOrEqual(lastU)
        expect(rec.mainstream.paramsB).toBeGreaterThanOrEqual(lastM)
        lastU = rec.uncensored.paramsB
        lastM = rec.mainstream.paramsB
      }
    }
  })

  it('round a RAM figure down to its class and give nothing below the smallest', () => {
    expect(recommendedModelsFor('ios', 5.57)?.uncensored.id).toBe(MOBILE_RECOMMENDATIONS.ios[6].uncensored)
    expect(recommendedModelsFor('ios', 2.75)?.uncensored.id).toBe(MOBILE_RECOMMENDATIONS.ios[3].uncensored)
    expect(recommendedModelsFor('android', 10)?.uncensored.id).toBe(MOBILE_RECOMMENDATIONS.android[8].uncensored)
    expect(recommendedModelsFor('ios', 24)?.mainstream.id).toBe(MOBILE_RECOMMENDATIONS.ios[16].mainstream)
    expect(recommendedModelsFor('android', 2)).toBeUndefined()
    expect(recommendedModelsFor('ios', 1)).toBeUndefined()
  })
})
