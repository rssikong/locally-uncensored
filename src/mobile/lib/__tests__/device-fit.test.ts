import { afterEach, describe, expect, it } from 'vitest'
import { APPLE_DEVICES, MEMORY_BUDGETS, RAM_CLASSES, type MobilePlatform } from '../../data/device-memory'
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL, MOBILE_RECOMMENDATIONS, TIGHT_RECOMMENDATIONS, mobileModelById, type MobileModel } from '../../data/mobile-models'
import {
  CTX_STEP,
  DEFAULT_EMBED_BYTES,
  FIT_SHARE,
  MOBILE_MAX_CTX,
  MOBILE_MIN_CTX,
  SIMULATOR_DEFAULT,
  comfortParamsFor,
  TIGHT_SHARE,
  COMFORT_PARAMS_B,
  knownShape,
  paramsOf,
  assessFit,
  defaultContextFor,
  estimateFileBytes,
  fitModelOfFile,
  formatMemory,
  getDeviceOverride,
  maxContextFor,
  memoryLimitFor,
  parseDeviceOverride,
  ramClassFor,
  resolveDevice,
  setDeviceOverride,
  type FitDevice,
  type FitModel,
} from '../device-fit'

const MIB = 1_048_576
const GIB = 1_073_741_824
const DASHES = /[\u2012\u2013\u2014\u2015]/

const fitModel = (m: MobileModel): FitModel => ({ fileBytes: m.sizeBytes, quant: m.quant, kvBytesPerToken: m.kvBytesPerToken, maxContext: m.trainedContext })

/**
 * KV cache per token in KiB where llama.cpp allocates less than the attention
 * shape says, copied by hand from KATALOG-PROBE.md section 6.
 */
const MEASURED_KV_KIB: Record<string, number> = {
  'qwen3.5-0.8b': 12, 'qwen3.5-0.8b-abliterated': 12,
  'qwen3.5-2b': 12, 'qwen3.5-2b-abliterated': 12,
  'qwen3.5-4b': 32, 'qwen3.5-4b-abliterated': 32,
  'gemma-4-e2b': 18,
}

/** The formula from GERAETE-PASSUNG.md, written out a second time on purpose. */
function needByHand(m: MobileModel, ctx: number, embedding = false): number {
  const weights = (m.sizeBytes / MIB) * 1.2
  const perToken = m.id in MEASURED_KV_KIB ? MEASURED_KV_KIB[m.id] * 1024 : m.arch.blocks * m.arch.kvHeads * (m.arch.keyLength + m.arch.valueLength) * 2
  const kv = (perToken * ctx) / MIB
  const embed = embedding ? (MOBILE_EMBED_MODEL.sizeBytes / MIB) * 1.2 + 50 : 0
  return weights + kv + 350 + embed
}

interface Case { label: string; device: FitDevice; limitMb: number }

/** Every Apple device, without and with the entitlement, and every Android RAM class. */
function allDevices(): Case[] {
  const cases: Case[] = []
  for (const d of APPLE_DEVICES) {
    const row = MEMORY_BUDGETS.ios.find((b) => b.ramGb === d.ramGb)!
    cases.push({ label: `${d.name} ${d.ramGb} GB`, device: { platform: 'ios', ramGb: d.ramGb }, limitMb: row.limitMb })
    cases.push({ label: `${d.name} ${d.ramGb} GB entitled`, device: { platform: 'ios', ramGb: d.ramGb, increasedMemoryLimit: true }, limitMb: row.increasedLimitMb })
  }
  for (const b of MEMORY_BUDGETS.android) cases.push({ label: `Android ${b.ramGb} GB`, device: { platform: 'android', ramGb: b.ramGb }, limitMb: b.limitMb })
  return cases
}

describe('whole device table against the whole catalog', () => {
  const cases = allDevices()

  it('covers every Apple device twice and every Android class', () => {
    expect(cases.length).toBe(APPLE_DEVICES.length * 2 + RAM_CLASSES.android.length)
  })

  it('never calls a model fits or tight whose need is above its share of the limit', () => {
    let checked = 0
    for (const c of cases) {
      for (const m of MOBILE_CHAT_MODELS) {
        const r = assessFit({ device: c.device, model: fitModel(m) })
        const need = needByHand(m, r.contextLength)
        const where = `${m.id} on ${c.label}`
        expect(r.limitMb, where).toBe(c.limitMb)
        expect(r.limitSource, where).toBe('table')
        expect(r.needMb, where).toBe(Math.ceil(need))
        expect(r.budgetMb, where).toBeLessThanOrEqual(c.limitMb * 0.8)
        if (r.verdict === 'fits') expect(need, where).toBeLessThanOrEqual(c.limitMb * 0.65)
        if (r.verdict !== 'too-large') expect(need, where).toBeLessThanOrEqual(r.budgetMb)
        if (r.verdict === 'too-large') expect(need, where).toBeGreaterThan(c.limitMb * 0.8 - 1)
        if (r.verdict === 'tight' && !r.slow) expect(need, where).toBeGreaterThan(c.limitMb * 0.65 - 1)
        // Tight for its pace alone: memory would be comfortable, the model is above the line of the class.
        if (r.slow) {
          expect(r.verdict, where).toBe('tight')
          expect(need, where).toBeLessThanOrEqual(c.limitMb * 0.65)
          expect(m.paramsB, where).toBeGreaterThan(comfortParamsFor(c.device))
        } else if (r.verdict === 'fits') expect(m.paramsB, where).toBeLessThanOrEqual(comfortParamsFor(c.device))
        checked++
      }
    }
    expect(checked).toBe(cases.length * MOBILE_CHAT_MODELS.length)
  })

  it('gives every supported device at least one mainstream and one uncensored model that fits', () => {
    for (const c of cases) {
      for (const uncensored of [false, true]) {
        const fitting = MOBILE_CHAT_MODELS.filter((m) => m.uncensored === uncensored && assessFit({ device: c.device, model: fitModel(m) }).verdict === 'fits')
        expect(fitting.length, `${c.label}, uncensored ${uncensored}`).toBeGreaterThan(0)
      }
    }
  })

  it('still has a model that fits everywhere with the embedding model loaded next to it', () => {
    for (const c of cases) {
      const fitting = MOBILE_CHAT_MODELS.filter((m) => assessFit({ device: c.device, model: fitModel(m), embeddingLoaded: true }).verdict !== 'too-large')
      expect(fitting.length, c.label).toBeGreaterThan(0)
    }
  })

  it('has no model in the catalog that fits nowhere', () => {
    for (const m of MOBILE_CHAT_MODELS) {
      expect(cases.some((c) => assessFit({ device: c.device, model: fitModel(m) }).verdict === 'fits'), m.id).toBe(true)
    }
  })

  it('never gets worse on a larger RAM class of the same platform', () => {
    const rank = { 'too-large': 0, tight: 1, fits: 2 }
    for (const platform of ['ios', 'android'] as const) {
      for (const m of MOBILE_CHAT_MODELS) {
        let last = 0
        for (const ramGb of RAM_CLASSES[platform]) {
          // Same context for all classes, otherwise the larger default context of 6 GB hides the comparison.
          const now = rank[assessFit({ device: { platform, ramGb }, model: fitModel(m), contextLength: 2048 }).verdict]
          expect(now, `${m.id} ${platform} ${ramGb}`).toBeGreaterThanOrEqual(last)
          last = now
        }
      }
    }
  })

  it('recommends per class only models that fit on that class, and names the two that are tight', () => {
    for (const platform of ['ios', 'android'] as const) {
      for (const ramGb of RAM_CLASSES[platform]) {
        const rec = MOBILE_RECOMMENDATIONS[platform][ramGb]
        for (const kind of ['uncensored', 'mainstream'] as const) {
          const id = rec[kind]
          const r = assessFit({ device: { platform, ramGb }, model: fitModel(mobileModelById(id)!) })
          const wanted = TIGHT_RECOMMENDATIONS.has(`${platform}:${ramGb}:${kind}`) ? 'tight' : 'fits'
          expect(r.verdict, `${id} on ${platform} ${ramGb} GB: ${r.reason}`).toBe(wanted)
        }
      }
    }
    expect([...TIGHT_RECOMMENDATIONS].sort()).toEqual(['android:3:mainstream', 'ios:2:mainstream'])
  })

  it('pins the smallest RAM class per model, the table in GERAETE-PASSUNG.md', () => {
    const smallest = (m: MobileModel, platform: MobilePlatform) =>
      RAM_CLASSES[platform].find((ramGb) => assessFit({ device: { platform, ramGb }, model: fitModel(m) }).verdict === 'fits') ?? 0
    const table = Object.fromEntries(MOBILE_CHAT_MODELS.map((m) => [m.id, [smallest(m, 'ios'), smallest(m, 'android')]]))
    expect(table).toEqual({
      'smollm2-360m': [2, 3],
      'qwen3-0.6b': [3, 4],
      'qwen3.5-0.8b': [3, 4],
      'gemma-3-1b': [4, 6],
      'llama-3.2-1b': [6, 6],
      'qwen2.5-1.5b': [6, 6],
      'qwen3-1.7b': [8, 8],
      // Memory alone says 6 since the measured KV cache (48 MB at 4096 tokens instead of 192 MB).
      // On Android the pace line of the 6 GB class (1.7B) moves it to 8.
      'qwen3.5-2b': [6, 8],
      // 0 on iOS: fits only with the increased-memory-limit entitlement.
      'smollm3-3b': [0, 12],
      'llama-3.2-3b': [0, 12],
      'gemma-3-4b': [0, 12],
      'phi-4-mini': [0, 12],
      'qwen3-4b-2507': [0, 12],
      'qwen3.5-4b': [0, 12],
      'gemma-4-e2b': [0, 12],
      'qwen2.5-0.5b-abliterated': [2, 3],
      'qwen3.5-0.8b-abliterated': [3, 4],
      'gemma-3-1b-abliterated': [4, 6],
      'dolphin3-llama3.2-1b': [6, 6],
      'dolphin3-qwen2.5-1.5b': [6, 6],
      'qwen2.5-1.5b-abliterated': [6, 6],
      'qwen3-1.7b-abliterated': [8, 8],
      'qwen3.5-2b-abliterated': [6, 8],
      'dolphin3-llama3.2-3b': [0, 12],
      'hermes-3-llama3.2-3b': [0, 12],
      'llama-3.2-3b-abliterated': [0, 12],
      'gemma-3-4b-abliterated': [0, 12],
      'qwen3-4b-2507-abliterated': [0, 12],
      'qwen3.5-4b-abliterated': [0, 12],
    })
  })

  /**
   * Peak footprint in MB at context 4096 with the weights counted in full
   * (run e of KATALOG-PROBE.md, Metal without mmap, table 7.1). The engine
   * maps the file, so its real footprint on the Mac was far lower (run a);
   * run e is the worst reading, the one that would hold if an iPhone counted
   * mapped weights. Measured on a Mac, not on a phone.
   */
  const WORST_PEAK_MB: Record<string, number> = {
    'smollm2-360m': 635, 'qwen3-0.6b': 1227, 'qwen3.5-0.8b': 1172, 'gemma-3-1b': 1649, 'llama-3.2-1b': 1475,
    'qwen2.5-1.5b': 1519, 'qwen3-1.7b': 2152, 'qwen3.5-2b': 2286, 'smollm3-3b': 2700, 'llama-3.2-3b': 3165,
    'gemma-3-4b': 4136, 'phi-4-mini': 4022, 'qwen3-4b-2507': 3730, 'qwen3.5-4b': 3994, 'gemma-4-e2b': 3728,
    'qwen2.5-0.5b-abliterated': 858, 'qwen3.5-0.8b-abliterated': 1165, 'gemma-3-1b-abliterated': 1652,
    'dolphin3-llama3.2-1b': 1476, 'dolphin3-qwen2.5-1.5b': 1574, 'qwen2.5-1.5b-abliterated': 1572,
    'qwen3-1.7b-abliterated': 2152, 'qwen3.5-2b-abliterated': 2279, 'dolphin3-llama3.2-3b': 3164,
    'hermes-3-llama3.2-3b': 3165, 'llama-3.2-3b-abliterated': 3069, 'gemma-3-4b-abliterated': 4134,
    'qwen3-4b-2507-abliterated': 3731, 'qwen3.5-4b-abliterated': 3963,
  }

  it('stays plausible on 4, 6, 8 and 12 GB against the worst measured reading', () => {
    // The constants 1.2 and 350 MB stay as they are until an iPhone was
    // measured. What must hold meanwhile: a model the formula calls `fits`
    // stays inside the never-exceeded budget (80 percent of the limit) even
    // when the weights count in full, and a model it calls `tight` stays
    // under the limit itself.
    expect(Object.keys(WORST_PEAK_MB).sort()).toEqual(MOBILE_CHAT_MODELS.map((m) => m.id).sort())
    const seen = { fits: 0, tight: 0, 'too-large': 0 }
    for (const platform of ['ios', 'android'] as const) {
      for (const ramGb of [4, 6, 8, 12]) {
        for (const m of MOBILE_CHAT_MODELS) {
          const r = assessFit({ device: { platform, ramGb }, model: fitModel(m) })
          seen[r.verdict]++
          // The peak was measured at 4096. A smaller default context holds less KV cache.
          const worst = WORST_PEAK_MB[m.id] - (m.kvBytesPerToken * (4096 - r.contextLength)) / MIB
          const where = `${m.id} on ${platform} ${ramGb} GB: formula ${r.needMb} MB, worst reading ${Math.round(worst)} MB, limit ${r.limitMb} MB`
          if (r.verdict === 'fits') expect(worst, where).toBeLessThanOrEqual(r.limitMb * TIGHT_SHARE)
          if (r.verdict === 'tight') expect(worst, where).toBeLessThanOrEqual(r.limitMb)
        }
      }
    }
    expect(seen.fits).toBeGreaterThan(0)
    expect(seen.tight).toBeGreaterThan(0)
    expect(seen['too-large']).toBeGreaterThan(0)
  })

  /**
   * What the app process held with the model loaded, on an Android device
   * with 4 GB (acceptance android-4gb, 10.10.2026, PSS after three answers).
   * The one reading that says the formula is too low is from the iOS
   * simulator (K4: 2.9 GB against "about 1.8 GB" for Qwen 3.5 2B). There the
   * figure was the resident size of a process on a Mac, which counts every
   * page of the mapped model file that was touched; the limit of an iPhone
   * counts what the process dirtied. So K4 moves no constant. These two
   * readings from a device are what the formula is held against meanwhile:
   * it must not be below them, and it is 190 to 260 MB above.
   */
  const MEASURED_ANDROID_4GB_MB: [string, number, number][] = [
    ['Qwen3.5-0.8B-Q4_K_M.gguf', 507.8, 790],
    ['Qwen3.5-2B-UD-IQ2_M.gguf', 820.0, 1100],
  ]

  it('is above what a 4 GB Android device held with the model loaded (K4)', () => {
    for (const [file, fileMb, heldMb] of MEASURED_ANDROID_4GB_MB) {
      const r = assessFit({ device: { platform: 'android', ramGb: 4 }, model: fitModelOfFile(file, Math.round(fileMb * MIB)) })
      const where = `${file}: formula ${r.needMb} MB, held ${heldMb} MB`
      expect(r.verdict, where).not.toBe('too-large')
      expect(r.needMb, where).toBeGreaterThanOrEqual(heldMb)
      // Not so far above that a model that runs is locked away: within a third.
      expect(r.needMb, where).toBeLessThanOrEqual(heldMb * 1.34)
    }
  })

  it('pins the verdicts of the seven corrected models on 4, 6, 8 and 12 GB', () => {
    const row = (id: string, platform: MobilePlatform) =>
      [4, 6, 8, 12].map((ramGb) => assessFit({ device: { platform, ramGb }, model: fitModel(mobileModelById(id)!) }).verdict)
    const table = Object.fromEntries(
      ['qwen3.5-0.8b', 'qwen3.5-2b', 'qwen3.5-4b', 'gemma-4-e2b', 'qwen3.5-0.8b-abliterated', 'qwen3.5-2b-abliterated', 'qwen3.5-4b-abliterated']
        .map((id) => [id, { ios: row(id, 'ios'), android: row(id, 'android') }]),
    )
    const small = { ios: ['fits', 'fits', 'fits', 'fits'], android: ['fits', 'fits', 'fits', 'fits'] }
    // 6 GB is new: with the old KV figure the 2B models needed 8 GB.
    // On a 6 GB Android phone the 2B models fit in memory but are above the pace line of the class (COMFORT_PARAMS_B): tight.
    const mid = { ios: ['too-large', 'fits', 'fits', 'fits'], android: ['too-large', 'tight', 'fits', 'fits'] }
    // iOS without the entitlement stops at 4000 MB for 8 GB and more.
    const large = { ios: ['too-large', 'too-large', 'too-large', 'too-large'], android: ['too-large', 'too-large', 'too-large', 'fits'] }
    expect(table).toEqual({
      'qwen3.5-0.8b': small,
      'qwen3.5-0.8b-abliterated': small,
      'qwen3.5-2b': mid,
      'qwen3.5-2b-abliterated': mid,
      'qwen3.5-4b': large,
      'qwen3.5-4b-abliterated': large,
      'gemma-4-e2b': large,
    })
  })

  it('lets the 3B and most 4B models fit an 8 GB iPhone once the entitlement is there', () => {
    const entitled: FitDevice = { platform: 'ios', ramGb: 8, increasedMemoryLimit: true }
    for (const id of ['llama-3.2-3b', 'gemma-3-4b', 'phi-4-mini', 'qwen3.5-4b-abliterated']) {
      expect(assessFit({ device: entitled, model: fitModel(mobileModelById(id)!) }).verdict, id).toBe('fits')
    }
    expect(assessFit({ device: { platform: 'ios', ramGb: 6, increasedMemoryLimit: true }, model: fitModel(mobileModelById('llama-3.2-3b')!) }).verdict).toBe('too-large')
  })
})

describe('one verdict per model and device (acceptance Android 08.10.2026, M2)', () => {
  const rank = { fits: 0, tight: 1, 'too-large': 2 } as const

  it('gives a caller that only has the file the verdict of the catalogue card', () => {
    // The model sheet of the chat asks with the size of the downloaded file alone.
    for (const c of allDevices()) {
      for (const m of MOBILE_CHAT_MODELS) {
        const card = assessFit({ device: c.device, model: { fileBytes: m.sizeBytes, paramsB: m.paramsB, quant: m.quant, kvBytesPerToken: m.kvBytesPerToken, maxContext: m.trainedContext } })
        const sheet = assessFit({ device: c.device, model: { fileBytes: m.sizeBytes } })
        expect(sheet, `${m.id} on ${c.label}`).toEqual(card)
        expect(maxContextFor({ device: c.device, model: { fileBytes: m.sizeBytes } }), `${m.id} on ${c.label}`).toBe(maxContextFor({ device: c.device, model: fitModel(m) }))
      }
    }
    const m = mobileModelById('qwen3.5-2b')!
    expect(knownShape({ fileBytes: m.sizeBytes })).toMatchObject({ paramsB: 2, kvBytesPerToken: 12288, maxContext: 262144 })
    // What the caller knows wins, and an unknown file keeps the careful fallbacks.
    expect(knownShape({ fileBytes: m.sizeBytes, kvBytesPerToken: 5 }).kvBytesPerToken).toBe(5)
    expect(knownShape({ fileBytes: m.sizeBytes + 1 })).toEqual({ fileBytes: m.sizeBytes + 1 })
  })

  it('does not move with the memory that happens to be free', () => {
    const model = { fileBytes: mobileModelById('qwen3.5-2b')!.sizeBytes }
    const calm = assessFit({ device: { platform: 'android', ramGb: 8 }, model })
    // Another model is loaded, or other apps are open: the system reports far less.
    const busy = assessFit({ device: { platform: 'android', ramGb: 8, availableMb: 900 }, model })
    expect(busy).toEqual(calm)
    expect(calm.verdict).toBe('fits')
    expect(assessFit({ device: { platform: 'ios', ramGb: 6, availableMb: 700 }, model }).verdict).toBe('fits')
    // Only the check right before loading looks at the moment.
    expect(assessFit({ device: { platform: 'android', ramGb: 8, availableMb: 900 }, model, momentary: true }).verdict).toBe('too-large')
  })

  it('the case of the acceptance run: on a 6 GB Android phone Qwen 3.5 2B is not "runs well", and no larger model fits better than a smaller one', () => {
    const device: FitDevice = { platform: 'android', ramGb: 6 }
    const of = (id: string) => assessFit({ device, model: { fileBytes: mobileModelById(id)!.sizeBytes } })
    expect(of('qwen2.5-1.5b').verdict).toBe('fits')
    // Tight for memory: 448 MB of KV cache at 4096 tokens on top of 1.0 GB.
    expect(of('qwen3-1.7b')).toMatchObject({ verdict: 'tight', slow: false })
    // Fits in memory, slow: it ran at 0.5 to 1.4 tokens per second.
    expect(of('qwen3.5-2b')).toMatchObject({ verdict: 'tight', slow: true })
    expect(of('qwen3.5-2b').reason).toMatch(/^Fits in memory, but a model of this size answers slowly on this device\. Needs about 1\.8 GB of the 2\.3 GB that are safe to use\.$/)
    expect(of('llama-3.2-3b').verdict).toBe('too-large')
  })

  it('never ranks a model better than one that is smaller in parameters and in memory', () => {
    let pairs = 0
    for (const c of allDevices()) {
      const rows = MOBILE_CHAT_MODELS.map((m) => ({ m, r: assessFit({ device: c.device, model: fitModel(m) }) }))
      for (const a of rows) {
        for (const b of rows) {
          if (a.m.paramsB > b.m.paramsB || a.r.needMb > b.r.needMb) continue
          expect(rank[a.r.verdict], `${a.m.id} (${a.r.verdict}) against ${b.m.id} (${b.r.verdict}) on ${c.label}`).toBeLessThanOrEqual(rank[b.r.verdict])
          pairs++
        }
      }
    }
    expect(pairs).toBeGreaterThan(1000)
  })

  it('draws the pace line per platform and RAM class, and every proposal of the catalogue is under it', () => {
    for (const platform of ['ios', 'android'] as const) {
      const classes = RAM_CLASSES[platform]
      expect(Object.keys(COMFORT_PARAMS_B[platform]).map(Number).sort((a, b) => a - b)).toEqual(classes)
      // More memory never lowers the line.
      classes.forEach((ramGb, i) => {
        if (i > 0) expect(COMFORT_PARAMS_B[platform][ramGb]).toBeGreaterThanOrEqual(COMFORT_PARAMS_B[platform][classes[i - 1]])
        expect(comfortParamsFor({ platform, ramGb })).toBe(COMFORT_PARAMS_B[platform][ramGb])
        for (const id of Object.values(MOBILE_RECOMMENDATIONS[platform][ramGb] ?? {})) {
          expect(mobileModelById(id)!.paramsB, `${id} on ${platform} ${ramGb} GB`).toBeLessThanOrEqual(COMFORT_PARAMS_B[platform][ramGb])
        }
      })
    }
    expect(comfortParamsFor({ platform: 'android', ramGb: 1 })).toBe(0)
  })

  it('reads the parameter count back from the file when nobody names it', () => {
    expect(paramsOf({ paramsB: 3.2 }, 1)).toBe(3.2)
    // Every catalogue file lands near its real count (Q4_K_M).
    for (const m of MOBILE_CHAT_MODELS) {
      if (m.id === 'gemma-4-e2b') continue // counts 2B effective parameters, the file holds more
      const guessed = paramsOf({ quant: m.quant }, m.sizeBytes)
      // Never far above the real count: a guess must not call a small model slow. Below 1B the flat part of a file weighs most and the guess runs low, which is harmless.
      expect(guessed / m.paramsB, m.id).toBeLessThan(1.35)
      if (m.paramsB >= 1) expect(guessed / m.paramsB, m.id).toBeGreaterThan(0.75)
    }
    expect(paramsOf({}, 10)).toBe(0)
    // A file the user brought, 4.4 GB at Q4_K_M: about 7B, slow on an 8 GB Android phone even if it fitted.
    expect(paramsOf({}, 4.4e9)).toBeGreaterThan(6.5)
    const own = assessFit({ device: { platform: 'android', ramGb: 16 }, model: { fileBytes: 2.2e9 * 1.0 } })
    expect(own.verdict).toBe('fits')
    expect(assessFit({ device: { platform: 'android', ramGb: 8 }, model: { fileBytes: 1.75e9, kvBytesPerToken: 1 } })).toMatchObject({ verdict: 'tight', slow: true })
    expect(maxContextFor({ device: { platform: 'android', ramGb: 8 }, model: { fileBytes: 1.75e9, kvBytesPerToken: 1 } }, { allow: 'fits' })).toBe(0)
    expect(maxContextFor({ device: { platform: 'android', ramGb: 8 }, model: { fileBytes: 1.75e9, kvBytesPerToken: 1 } })).toBe(MOBILE_MAX_CTX)
  })
})

describe('RAM classes', () => {
  it('maps what devices really report to their nominal class', () => {
    // Reported totals from Stack Overflow answer 15200855, in MB.
    expect(ramClassFor('ios', 2813 / 1024)?.ramGb).toBe(3)
    expect(ramClassFor('ios', 3754 / 1024)?.ramGb).toBe(4)
    expect(ramClassFor('ios', 5703 / 1024)?.ramGb).toBe(6)
    expect(ramClassFor('ios', 1971 / 1024)?.ramGb).toBe(2)
    expect(ramClassFor('android', 7.4)?.ramGb).toBe(8)
    expect(ramClassFor('android', 11.2)?.ramGb).toBe(12)
  })

  it('rounds sizes between classes down and anything huge to the top class', () => {
    expect(ramClassFor('android', 10)?.ramGb).toBe(8)
    expect(ramClassFor('android', 5)?.ramGb).toBe(4)
    expect(ramClassFor('android', 24)?.ramGb).toBe(16)
    expect(ramClassFor('ios', 48)?.ramGb).toBe(16)
  })

  it('knows no class below the smallest, for zero and for nonsense', () => {
    expect(ramClassFor('android', 2)).toBeUndefined()
    expect(ramClassFor('ios', 1)).toBeUndefined()
    expect(ramClassFor('ios', 0)).toBeUndefined()
    expect(ramClassFor('ios', -4)).toBeUndefined()
    expect(ramClassFor('ios', Number.NaN)).toBeUndefined()
  })
})

describe('verdict boundaries', () => {
  // A synthetic model whose need is exactly what the test wants: no KV cache to speak of.
  const modelNeeding = (needMb: number): FitModel => ({ fileBytes: ((needMb - 350) / 1.2) * MIB, kvBytesPerToken: 1e-9 })
  const device: FitDevice = { platform: 'ios', ramGb: 6 } // limit 3050, comfort 1982, budget 2440

  it('switches from fits to tight exactly at 65 percent and to too-large at 80 percent', () => {
    expect(Math.floor(3050 * FIT_SHARE)).toBe(1982)
    expect(Math.floor(3050 * TIGHT_SHARE)).toBe(2440)
    expect(assessFit({ device, model: modelNeeding(1981.5) }).verdict).toBe('fits')
    expect(assessFit({ device, model: modelNeeding(1982.5) }).verdict).toBe('tight')
    expect(assessFit({ device, model: modelNeeding(2439.5) }).verdict).toBe('tight')
    expect(assessFit({ device, model: modelNeeding(2440.5) }).verdict).toBe('too-large')
  })

  it('reports the parts it added up', () => {
    const m = mobileModelById('llama-3.2-3b')!
    const r = assessFit({ device: { platform: 'android', ramGb: 12 }, model: fitModel(m), contextLength: 4096, embeddingLoaded: true })
    expect(r.parts.weightsMb).toBe(Math.round((m.sizeBytes / MIB) * 1.2))
    expect(r.parts.kvCacheMb).toBe(448)
    expect(r.parts.runtimeMb).toBe(350)
    expect(r.parts.embeddingMb).toBe(Math.round((DEFAULT_EMBED_BYTES / MIB) * 1.2 + 50))
    expect(r.needMb).toBe(Math.ceil(needByHand(m, 4096, true)))
    expect(DEFAULT_EMBED_BYTES).toBe(MOBILE_EMBED_MODEL.sizeBytes)
  })

  it('needs more with a longer context and with the embedding model', () => {
    const model = fitModel(mobileModelById('qwen3-1.7b')!)
    const d: FitDevice = { platform: 'ios', ramGb: 8 }
    const short = assessFit({ device: d, model, contextLength: 1024 }).needMb
    const long = assessFit({ device: d, model, contextLength: 4096 }).needMb
    const withEmbed = assessFit({ device: d, model, contextLength: 4096, embeddingLoaded: true }).needMb
    expect(long).toBeGreaterThan(short)
    expect(withEmbed).toBeGreaterThan(long)
    expect(assessFit({ device: d, model, contextLength: 4096, embeddingLoaded: true, embeddingBytes: 400 * MIB }).needMb).toBeGreaterThan(withEmbed)
  })

  it('uses the class default context, capped by the model', () => {
    expect(defaultContextFor({ platform: 'ios', ramGb: 4 })).toBe(2048)
    expect(defaultContextFor({ platform: 'ios', ramGb: 6 })).toBe(4096)
    expect(defaultContextFor({ platform: 'android', ramGb: 16 })).toBe(MOBILE_MAX_CTX)
    expect(defaultContextFor({ platform: 'ios', ramGb: 8 }, { maxContext: 1024 })).toBe(1024)
    expect(assessFit({ device: { platform: 'ios', ramGb: 3 }, model: { fileBytes: 300 * MIB } }).contextLength).toBe(2048)
    // Nonsense context values fall back to the default instead of producing NaN.
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = assessFit({ device: { platform: 'ios', ramGb: 6 }, model: { fileBytes: 300 * MIB }, contextLength: bad })
      expect(r.contextLength).toBe(4096)
      expect(Number.isFinite(r.needMb)).toBe(true)
    }
  })

  it('blocks a device below the smallest class and says to use the cloud', () => {
    const r = assessFit({ device: { platform: 'android', ramGb: 2 }, model: fitModel(MOBILE_CHAT_MODELS[0]) })
    expect(r.verdict).toBe('too-large')
    expect(r.limitMb).toBe(0)
    expect(r.limitSource).toBe('none')
    expect(r.needMb).toBeGreaterThan(0)
    expect(r.reason).toContain('LU Cloud')
    expect(maxContextFor({ device: { platform: 'android', ramGb: 2 }, model: fitModel(MOBILE_CHAT_MODELS[0]) })).toBe(0)
  })

  it('blocks a model of unknown size instead of guessing', () => {
    for (const model of [{}, { fileBytes: 0 }, { fileBytes: -1 }, { fileBytes: Number.NaN }, { paramsB: 3 }, { quant: 'Q4_K_M' }, { paramsB: 3, quant: 'nonsense' }]) {
      const r = assessFit({ device: { platform: 'android', ramGb: 16 }, model })
      expect(r.verdict).toBe('too-large')
      expect(r.needMb).toBe(0)
      expect(r.reason).toContain('unknown')
      expect(maxContextFor({ device: { platform: 'android', ramGb: 16 }, model })).toBe(0)
    }
  })

  it('falls back to a cautious KV estimate when the attention shape is unknown', () => {
    for (const m of MOBILE_CHAT_MODELS) {
      const known = assessFit({ device: { platform: 'android', ramGb: 16 }, model: fitModel(m) }).needMb
      const unknown = assessFit({ device: { platform: 'android', ramGb: 16 }, model: { fileBytes: m.sizeBytes, maxContext: m.trainedContext } }).needMb
      expect(unknown, m.id).toBeGreaterThanOrEqual(known)
    }
  })
})

describe('quantization', () => {
  it('estimates a file size from parameters and quantization when no size is known', () => {
    // Llama 3.2 3B Q4_K_M is 2,019,377,696 bytes on Hugging Face.
    const estimate = estimateFileBytes(3.21, 'Q4_K_M')!
    expect(estimate).toBeGreaterThan(2_019_377_696 * 0.9)
    expect(estimate).toBeLessThan(2_019_377_696 * 1.15)
    expect(estimateFileBytes(3.21, 'q4_k_m')).toBe(estimate)
    expect(estimateFileBytes(3.21, 'Q8_0')!).toBeGreaterThan(estimate * 1.6)
    expect(estimateFileBytes(3.21, 'Q3_K_M')!).toBeLessThan(estimate)
    expect(estimateFileBytes(undefined, 'Q4_K_M')).toBeUndefined()
    expect(estimateFileBytes(3, undefined)).toBeUndefined()
    expect(estimateFileBytes(3, 'Q9')).toBeUndefined()
    expect(estimateFileBytes(-1, 'Q4_K_M')).toBeUndefined()
  })

  it('reaches at least 90 percent of the real file size for the catalog models, with one known exception', () => {
    const under = MOBILE_CHAT_MODELS.filter((m) => estimateFileBytes(m.paramsB, m.quant)! < m.sizeBytes * 0.9)
    // Gemma 4 E2B carries large per layer embeddings that the parameter label does not count.
    expect(under.map((m) => m.id)).toEqual(['gemma-4-e2b'])
  })

  it('judges the same model harder in a larger quantization and prefers a real size over the estimate', () => {
    const d: FitDevice = { platform: 'android', ramGb: 8 }
    const q4 = assessFit({ device: d, model: { paramsB: 3.21, quant: 'Q4_K_M' } })
    const q8 = assessFit({ device: d, model: { paramsB: 3.21, quant: 'Q8_0' } })
    expect(q8.needMb).toBeGreaterThan(q4.needMb)
    expect(q4.verdict).not.toBe('too-large')
    expect(q8.verdict).toBe('too-large')
    expect(q8.reason).toContain('smaller quantization')
    const real = assessFit({ device: d, model: { fileBytes: 500 * MIB, paramsB: 3.21, quant: 'Q8_0' } })
    expect(real.parts.weightsMb).toBe(600)
  })
})

describe('reported available memory, for the check right before loading (momentary)', () => {
  const model = fitModel(mobileModelById('qwen2.5-1.5b')!) // needs about 1741 MB at 4096

  it('on iOS replaces the table in both directions', () => {
    const low = assessFit({ device: { platform: 'ios', ramGb: 6, availableMb: 1500 }, model, momentary: true })
    expect(low.limitSource).toBe('reported')
    expect(low.limitMb).toBe(1500)
    expect(low.verdict).toBe('too-large')
    const high = assessFit({ device: { platform: 'ios', ramGb: 8, availableMb: 6000 }, model: fitModel(mobileModelById('llama-3.2-3b')!), momentary: true })
    expect(high.limitMb).toBe(6000)
    expect(high.verdict).toBe('fits')
  })

  it('on Android only ever lowers the table', () => {
    expect(memoryLimitFor({ platform: 'android', ramGb: 8, availableMb: 7000 }, true)).toEqual({ limitMb: 4200, source: 'table' })
    expect(memoryLimitFor({ platform: 'android', ramGb: 8, availableMb: 2000 }, true)).toEqual({ limitMb: 2000, source: 'reported' })
    expect(assessFit({ device: { platform: 'android', ramGb: 8, availableMb: 2000 }, model, momentary: true }).verdict).toBe('too-large')
    expect(assessFit({ device: { platform: 'android', ramGb: 8 }, model, momentary: true }).verdict).toBe('fits')
    expect(maxContextFor({ device: { platform: 'android', ramGb: 8, availableMb: 2000 }, model, momentary: true })).toBe(0)
  })

  it('treats 0, the answer of the iOS simulator, and nonsense as not reported', () => {
    for (const availableMb of [0, -1, Number.NaN, undefined]) {
      expect(memoryLimitFor({ platform: 'ios', ramGb: 6, availableMb }, true)).toEqual({ limitMb: 3050, source: 'table' })
    }
  })

  it('uses the entitlement only for the table, a reported figure already contains it', () => {
    expect(memoryLimitFor({ platform: 'ios', ramGb: 8, increasedMemoryLimit: true }, true)).toEqual({ limitMb: 6144, source: 'table' })
    expect(memoryLimitFor({ platform: 'ios', ramGb: 8, increasedMemoryLimit: true, availableMb: 5000 }, true)).toEqual({ limitMb: 5000, source: 'reported' })
    expect(memoryLimitFor({ platform: 'android', ramGb: 8, increasedMemoryLimit: true }, true)).toEqual({ limitMb: 4200, source: 'table' })
  })
})

describe('maxContextFor', () => {
  it('returns the ceiling when it fits and never more than the model or MOBILE_MAX_CTX', () => {
    const small = fitModel(mobileModelById('qwen2.5-0.5b-abliterated')!)
    expect(maxContextFor({ device: { platform: 'ios', ramGb: 8 }, model: small })).toBe(MOBILE_MAX_CTX)
    expect(maxContextFor({ device: { platform: 'ios', ramGb: 8 }, model: small }, { ceiling: 8192 })).toBe(8192)
    expect(maxContextFor({ device: { platform: 'ios', ramGb: 8 }, model: { ...small, maxContext: 3000 } })).toBe(3000)
    expect(maxContextFor({ device: { platform: 'ios', ramGb: 8 }, model: { ...small, maxContext: 300 } })).toBe(0)
  })

  it('finds the largest step that still passes, and the next step does not', () => {
    let reduced = 0
    for (const c of allDevices()) {
      for (const m of MOBILE_CHAT_MODELS) {
        for (const allow of ['fits', 'tight'] as const) {
          const input = { device: c.device, model: fitModel(m) }
          const ctx = maxContextFor(input, { allow })
          const where = `${m.id} on ${c.label}, ${allow}`
          const passes = (n: number) => {
            const v = assessFit({ ...input, contextLength: n }).verdict
            return v === 'fits' || (allow === 'tight' && v === 'tight')
          }
          if (ctx === 0) {
            expect(passes(MOBILE_MIN_CTX), where).toBe(false)
            continue
          }
          expect(ctx, where).toBeGreaterThanOrEqual(MOBILE_MIN_CTX)
          expect(ctx, where).toBeLessThanOrEqual(MOBILE_MAX_CTX)
          expect(passes(ctx), where).toBe(true)
          if (ctx < MOBILE_MAX_CTX) {
            expect(ctx % CTX_STEP, where).toBe(0)
            expect(passes(ctx + CTX_STEP), where).toBe(false)
            reduced++
          }
        }
      }
    }
    // The test is only worth something if the reduced branch really happens.
    expect(reduced).toBeGreaterThan(10)
  })

  it('is smaller for fits than for tight, and smaller with the embedding model loaded', () => {
    const input = { device: { platform: 'ios' as const, ramGb: 8 }, model: fitModel(mobileModelById('llama-3.2-3b-abliterated')!) }
    const tight = maxContextFor(input)
    expect(tight).toBe(2560)
    expect(maxContextFor(input, { allow: 'fits' })).toBe(0)
    expect(maxContextFor({ ...input, embeddingLoaded: true })).toBeLessThan(tight)
  })

  it('ignores the context in the input', () => {
    const input = { device: { platform: 'ios' as const, ramGb: 6 }, model: fitModel(mobileModelById('qwen3-1.7b')!) }
    expect(maxContextFor({ ...input, contextLength: 512 })).toBe(maxContextFor({ ...input, contextLength: 100000 }))
  })
})

describe('reasons', () => {
  it('are English sentences without dashes for every verdict', () => {
    const seen = new Set<string>()
    for (const c of allDevices()) {
      for (const m of MOBILE_CHAT_MODELS) {
        for (const embeddingLoaded of [false, true]) {
          const r = assessFit({ device: c.device, model: fitModel(m), embeddingLoaded })
          seen.add(r.verdict)
          expect(r.reason, r.reason).not.toMatch(DASHES)
          expect(r.reason).not.toContain(' - ')
          expect(r.reason).not.toMatch(/NaN|undefined|Infinity/)
          expect(r.reason.endsWith('.')).toBe(true)
          expect(r.reason).toMatch(r.verdict === 'fits' ? /^Fits this device\./ : r.slow ? /^Fits in memory, but a model of this size answers slowly on this device\./ : r.verdict === 'tight' ? /^Tight on this device\./ : /^Too large for this device\./)
          expect(r.reason).toContain(formatMemory(r.needMb))
        }
      }
    }
    expect([...seen].sort()).toEqual(['fits', 'tight', 'too-large'])
  })

  it('offer the shorter context that would work', () => {
    const r = assessFit({ device: { platform: 'ios', ramGb: 8 }, model: fitModel(mobileModelById('llama-3.2-3b-abliterated')!) })
    expect(r.verdict).toBe('too-large')
    expect(r.reason).toContain('A context of 2560 tokens would fit.')
  })

  it('say when only the document model is in the way', () => {
    const device: FitDevice = { platform: 'ios', ramGb: 4 }
    const model = fitModel(mobileModelById('dolphin3-qwen2.5-1.5b')!)
    expect(assessFit({ device, model, contextLength: 512 }).verdict).toBe('tight')
    const r = assessFit({ device, model, contextLength: 512, embeddingLoaded: true })
    expect(r.verdict).toBe('too-large')
    expect(r.reason).toContain('without the document model')
  })

  it('otherwise ask for a smaller model', () => {
    const r = assessFit({ device: { platform: 'ios', ramGb: 3 }, model: fitModel(mobileModelById('qwen3.5-4b')!) })
    expect(r.reason).toContain('Choose a smaller model.')
  })

  it('formats memory the way a person reads it', () => {
    expect(formatMemory(850)).toBe('850 MB')
    expect(formatMemory(999.4)).toBe('999 MB')
    expect(formatMemory(1434)).toBe('1.4 GB')
    expect(formatMemory(6144)).toBe('6.0 GB')
  })
})

describe('test seam', () => {
  afterEach(() => setDeviceOverride(null))

  // Measured in the simulator, IOS-MACHBARKEIT.md 4.4: os_proc_available_memory=0, hw.memsize=51539607552.
  const simulatorReport = { platform: 'ios' as const, totalBytes: 51_539_607_552, availableBytes: 0, machine: 'arm64' }

  it('recognises the iOS simulator and treats it as a 6 GB iPhone instead of a 48 GB one', () => {
    const r = resolveDevice(simulatorReport)
    expect(r.simulator).toBe(true)
    expect(r.source).toBe('simulator')
    expect(r.device).toEqual({ platform: 'ios', ramGb: SIMULATOR_DEFAULT.ramGb })
    // Without the seam the Mac's RAM would let everything through.
    const big = fitModel(mobileModelById('qwen3.5-4b')!)
    expect(assessFit({ device: r.device, model: big }).verdict).toBe('too-large')
    // Recognised by RAM alone too, when the machine name is missing.
    expect(resolveDevice({ platform: 'ios', totalBytes: 51_539_607_552 }).simulator).toBe(true)
    // A 16 GB iPad Pro is not a simulator.
    expect(resolveDevice({ platform: 'ios', totalBytes: 16 * GIB, machine: 'iPad16,3' }).simulator).toBe(false)
  })

  it('lets a test pretend to be any device, and stops pretending on null', () => {
    setDeviceOverride({ platform: 'ios', ramGb: 3, label: 'iPhone XR' })
    expect(getDeviceOverride()).toEqual({ platform: 'ios', ramGb: 3, label: 'iPhone XR' })
    const r = resolveDevice(simulatorReport)
    expect(r.source).toBe('override')
    expect(r.simulator).toBe(true)
    expect(r.label).toBe('iPhone XR')
    expect(r.device).toEqual({ platform: 'ios', ramGb: 3 })
    const model = fitModel(mobileModelById('qwen2.5-1.5b')!)
    expect(assessFit({ device: r.device, model }).verdict).toBe('too-large')

    setDeviceOverride({ platform: 'ios', ramGb: 8, increasedMemoryLimit: true, availableMb: 5500 })
    expect(resolveDevice(simulatorReport).device).toEqual({ platform: 'ios', ramGb: 8, increasedMemoryLimit: true, availableMb: 5500 })

    setDeviceOverride(null)
    expect(getDeviceOverride()).toBeNull()
    expect(resolveDevice(simulatorReport).source).toBe('simulator')
  })

  it('does not hand out its internal object', () => {
    const mine = { platform: 'android' as const, ramGb: 8 }
    setDeviceOverride(mine)
    mine.ramGb = 16
    const copy = getDeviceOverride()!
    copy.ramGb = 3
    expect(getDeviceOverride()!.ramGb).toBe(8)
  })

  it('takes an explicit override argument without touching the global one', () => {
    const r = resolveDevice({ platform: 'android', totalBytes: 12 * GIB, availableBytes: 6 * GIB }, { ramGb: 4 })
    expect(r.device).toEqual({ platform: 'android', ramGb: 4 })
    expect(r.source).toBe('override')
    expect(getDeviceOverride()).toBeNull()
  })

  it('resolves a real iPhone by identifier and passes the reported available memory on', () => {
    const r = resolveDevice({ platform: 'ios', machine: 'iPhone15,4', totalBytes: 5703 * MIB, availableBytes: 2900 * MIB })
    expect(r.source).toBe('identifier')
    expect(r.label).toBe('iPhone 15 (6 GB)')
    expect(r.device).toEqual({ platform: 'ios', ramGb: 6, availableMb: 2900 })
  })

  it('picks the RAM variant of a shared identifier by reported RAM, else the smaller one', () => {
    expect(resolveDevice({ platform: 'ios', machine: 'iPad16,3', totalBytes: 15.2 * GIB }).device.ramGb).toBe(16)
    expect(resolveDevice({ platform: 'ios', machine: 'iPad16,3', totalBytes: 7.5 * GIB }).device.ramGb).toBe(8)
    expect(resolveDevice({ platform: 'ios', machine: 'iPad16,3' }).device.ramGb).toBe(8)
    expect(resolveDevice({ platform: 'ios', machine: 'iPad17,1', totalBytes: 11.3 * GIB }).device.ramGb).toBe(12)
  })

  it('falls back to reported RAM for an unknown identifier and for Android', () => {
    const newPhone = resolveDevice({ platform: 'ios', machine: 'iPhone19,2', totalBytes: 11.2 * GIB })
    expect(newPhone.source).toBe('reported')
    expect(ramClassFor('ios', newPhone.device.ramGb)?.ramGb).toBe(12)
    const android = resolveDevice({ platform: 'android', totalBytes: 7.4 * GIB, availableBytes: 3000 * MIB, increasedMemoryLimit: false })
    expect(android.source).toBe('reported')
    expect(android.device.availableMb).toBe(3000)
    expect(memoryLimitFor(android.device, true)).toEqual({ limitMb: 3000, source: 'reported' })
    // The badge does not move with what is free at the moment.
    expect(memoryLimitFor(android.device)).toEqual({ limitMb: 4200, source: 'table' })
  })

  it('lets nothing fit when nothing was reported', () => {
    const r = resolveDevice({ platform: 'android' })
    expect(r.source).toBe('unknown')
    expect(assessFit({ device: r.device, model: fitModel(MOBILE_CHAT_MODELS[0]) }).verdict).toBe('too-large')
  })

  it('parses the text form of an override', () => {
    expect(parseDeviceOverride('ios:6')).toEqual({ platform: 'ios', ramGb: 6, label: 'ios:6' })
    expect(parseDeviceOverride(' Android:8 ')).toEqual({ platform: 'android', ramGb: 8, label: 'Android:8' })
    expect(parseDeviceOverride('ios:8+')).toEqual({ platform: 'ios', ramGb: 8, increasedMemoryLimit: true, label: 'ios:8+' })
    expect(parseDeviceOverride('ios:6:2500')).toEqual({ platform: 'ios', ramGb: 6, availableMb: 2500, label: 'ios:6:2500' })
    expect(parseDeviceOverride('iPhone15,4')).toEqual({ platform: 'ios', ramGb: 6, label: 'iPhone 15 (6 GB)' })
    expect(parseDeviceOverride('iPad16,3')).toMatchObject({ ramGb: 8 })
    expect(parseDeviceOverride('iPad16,3:16')).toMatchObject({ ramGb: 16 })
  })

  it('rejects text it does not understand', () => {
    for (const bad of ['', '   ', null, undefined, 'ios', 'ios:', 'ios:abc', 'ios:0', 'ios:-4', 'windows:8', 'iPhone99,9', 'iPad16,3:12', 'ios:6:x', 'ios:6:-1']) {
      expect(parseDeviceOverride(bad), String(bad)).toBeNull()
    }
  })

  it('makes a parsed override usable end to end', () => {
    setDeviceOverride(parseDeviceOverride('android:3'))
    const { device } = resolveDevice(simulatorReport)
    expect(device).toEqual({ platform: 'android', ramGb: 3 })
    const verdicts = MOBILE_CHAT_MODELS.map((m) => assessFit({ device, model: fitModel(m) }).verdict)
    expect(verdicts).toContain('fits')
    expect(verdicts).toContain('too-large')
  })
})
