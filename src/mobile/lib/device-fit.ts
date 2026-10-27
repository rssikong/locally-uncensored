/**
 * Does this model fit this phone?
 *
 * Pure functions, no Tauri, no DOM. The numbers come from
 * data/device-memory.ts, the calculation is explained in
 * mobile-docs/GERAETE-PASSUNG.md.
 *
 *   need  = file * 1.2 + KV cache(context) + 350 MB [+ embedding model]
 *   limit = the table by RAM class (with `momentary`: what the system reports as available right now)
 *   fits       need <= 0.65 * limit, and the model is small enough to answer at a usable pace
 *   tight      need <= 0.80 * limit, or it fits in memory but is slow on this class of device,
 *              or it is a small model in a 1 or 2 bit packing, whose answers suffer (`coarse`)
 *   too-large  everything above
 *
 * ONE verdict per model and device. Every screen that shows a badge calls
 * assessFit with the device and what it knows about the model, and gets the
 * same answer: the shape of a catalogue file is looked up here by its size
 * and by its name (so a caller that only has the file gets the same KV cache
 * as the catalogue card, also for another quantization of a catalogue model,
 * see fitModelOfFile), the limit is the stable one of the RAM class (so the
 * answer does not move with what happens to be free at that moment), and the
 * speed rule is applied here and nowhere else. Only a check right before
 * loading passes `momentary: true`.
 *
 * All "MB" in this file are MiB (1,048,576 bytes), like the limits in the table.
 */
import { formatBytes } from '../../lib/formatters'
import {
  appleDevicesByIdentifier,
  ramClassFor,
  type MobilePlatform,
} from '../data/device-memory'
import { MOBILE_CHAT_MODELS, catalogModelForFile, quantOfFileName } from '../data/mobile-models'

export { ramClassFor }

export const MIB = 1_048_576
const GIB = 1_073_741_824

/** Largest context the on device engine is started with (MAX_CTX of the Android engine, IOS-MACHBARKEIT.md 4.5). */
export const MOBILE_MAX_CTX = 4096
/** Smallest context worth offering (the Android engine clamps to 512 as well). */
export const MOBILE_MIN_CTX = 512
/** maxContextFor answers in multiples of this. */
export const CTX_STEP = 256

/** Share of the limit up to which a model simply fits. IOS-MACHBARKEIT.md 4.5. */
export const FIT_SHARE = 0.65
/** Share of the limit that is never exceeded. The remaining 20 percent cover an undocumented, moving limit. */
export const TIGHT_SHARE = 0.8

/**
 * Weights in memory relative to the file: a fifth on top for compute buffers
 * and scratch. From the Android engine's ram_guard.
 *
 * This factor and RUNTIME_OVERHEAD_MB were held against 29 models on a Mac
 * (mobile-docs/KATALOG-PROBE.md section 7) and deliberately left as they are.
 * The engine maps the model file, and on the Mac mapped weights did not count
 * towards the footprint at all: the formula was 535 to 3834 MB above what was
 * measured. Counted in full (the run without mapping) it was up to 393 MB
 * below. Which reading an iPhone applies is only known once one was measured,
 * so the constants move then and not before. The test "stays plausible on 4,
 * 6, 8 and 12 GB against the worst measured reading" holds what must be true
 * meanwhile.
 *
 * One reading said the formula is too low: 2.9 GB against "about 1.8 GB" for
 * Qwen 3.5 2B in the iOS simulator (K4). That was the resident size of a
 * process on a Mac, where every touched page of the mapped file counts, so it
 * moved nothing. On an Android device with 4 GB the app held 790 MB with
 * Qwen 3.5 0.8B and 1.1 GB with Qwen 3.5 2B IQ2_M (10.10.2026), 190 to 260 MB
 * under the formula; the test "is above what a 4 GB Android device held"
 * keeps that.
 */
export const WEIGHTS_FACTOR = 1.2
/** Runtime, tokenizer, app. From the Android engine's ram_guard. See WEIGHTS_FACTOR. */
export const RUNTIME_OVERHEAD_MB = 350
/** Context and buffers of a loaded embedding model, on top of its weights. Annahme. */
export const EMBED_OVERHEAD_MB = 50
/** nomic-embed-text v1.5 Q4_K_M, the catalog's embedding model (data/mobile-models.ts). */
export const DEFAULT_EMBED_BYTES = 84_106_624

/**
 * KV cache per token when the model's attention shape is unknown (a search
 * hit, a file the user brought). Annahme, chosen to sit above every catalog
 * model with grouped attention: at least 128 KiB per token, and 64 KiB per
 * GiB of file for larger models.
 */
export const FALLBACK_KV_MIN_BYTES = 128 * 1024
export const FALLBACK_KV_BYTES_PER_GIB = 64 * 1024

/**
 * Average bits per weight of llama.cpp quantizations, for estimating a file
 * size from a parameter count. Annahme: rounded community figures, only used
 * when no real file size is known. A real size always wins.
 */
export const QUANT_BITS_PER_WEIGHT: Record<string, number> = {
  Q2_K: 3.35,
  Q3_K_S: 3.5,
  Q3_K_M: 3.9,
  Q3_K_L: 4.3,
  IQ4_XS: 4.25,
  Q4_0: 4.55,
  Q4_K_S: 4.6,
  Q4_K_M: 4.85,
  Q5_K_S: 5.5,
  Q5_K_M: 5.7,
  Q6_K: 6.6,
  Q8_0: 8.5,
  F16: 16,
  BF16: 16,
  F32: 32,
}
/**
 * Flat addition to the estimate. Token embeddings and metadata are stored
 * at higher precision, which weighs most on small models (Gemma 3 1B is
 * 806 MB where the bare formula says 606 MB). Annahme, set so the estimate
 * reaches at least 90 percent of the real size of the catalog models.
 */
const ESTIMATE_FLAT_BYTES = 150_000_000

/**
 * The largest model, in billions of parameters, that still counts as "runs
 * well" on a RAM class. Above it a model that fits in memory is `tight`: it
 * loads, but answers slowly.
 *
 * Why a table and not a speed: the pace of a phone cannot be estimated
 * seriously from what the app knows. The three places that measure one
 * disagree by a factor of four on the same device (acceptance run Android,
 * 08.10.2026: 20.5, 8.5 and 4.9 tokens per second), and a thinking model
 * spends most of its tokens before the first visible word. What is known:
 * time per token grows with the parameter count, and phones with more memory
 * carry faster chips. So the parameter count is held against the RAM class.
 * The line is drawn where a model is expected to stay above about 2 tokens
 * per second. Annahme, to be replaced by measurements per chip:
 *
 *   - 6 GB: Qwen 3.5 2B ran at 0.5 to 1.4 tokens per second in the acceptance
 *     run (an emulator, so a lower bound), the 1.5B models are the proposal
 *     of this class and stay "runs well". Line at 1.7.
 *   - 8 GB: the 2B models are written for this class, the 3B ones are tight
 *     in memory there anyway. Line at 2.5.
 *   - 12 GB and up: the 4B models are the proposal. Line at 4.1.
 *   - up to 4 GB: the proposals are 0.5B to 0.8B; a 1B model is the most that
 *     is still pleasant.
 */
export const COMFORT_PARAMS_B: Record<MobilePlatform, Record<number, number>> = {
  android: { 3: 1.0, 4: 1.3, 6: 1.7, 8: 2.5, 12: 4.1, 16: 8 },
  // An iPhone or iPad computes on the GPU (Metal) and its RAM classes sit on faster chips: memory, not pace, is what
  // holds a model back there. The lines are one step above the Android ones, so they only catch what is clearly too slow.
  ios: { 2: 1.0, 3: 1.3, 4: 2.5, 6: 3.3, 8: 4.1, 12: 8, 16: 8 },
}

/**
 * Up to this many billion parameters a 1 or 2 bit packing (IQ2_M, Q2_K,
 * IQ1_S and their kin) is never "runs well". What such a packing leaves of a
 * small model is too little to promise good answers:
 *  - Qwen3 0.6B IQ2_M answered a plain question with unreadable characters
 *    on the 8 GB Android phone (r6 Nachpruefung Android, N11),
 *  - Qwen 3.5 2B IQ2_M carried "Runs well on this phone" and answered
 *    "What is the capital of Italy? One word." with "Florence." (second
 *    check on Android, F8, one probe).
 * The first rule stopped below 1.5 billion and rested on two measurements,
 * with nothing measured between 1 and 1.7 billion. Decided 10.10.2026: the
 * mark promises nothing for these packings up to and including 4 billion
 * parameters. From 3 bit on nothing changes. Such a file fits in memory and
 * is quick; the badge says what suffers.
 */
export const COARSE_UP_TO_PARAMS_B = 4
/** The packings that rule is about: Q2_K, IQ2_M, IQ2_XXS, IQ1_S and their kin. Q3 and above are not. */
// Anywhere a packing is named, also behind a prefix a packer puts in front ("UD-IQ2_XXS", "i1-IQ2_XS"): every
// place that asks goes through this one pattern, so the card, the page of the model and the chat agree (check 4
// on an iPhone, N1).
const COARSE_QUANT = /(^|[-_. ])I?Q[12](_|$)/i

/**
 * Is this a 1 or 2 bit packing, whatever the size of the model. Agent mode asks this: a tool call is strict
 * text, and a packing below 3 bit does not hold it (check on Android with 4 GB, F3).
 */
export function packedBelowThreeBit(quant: string | undefined): boolean {
  return !!quant && COARSE_QUANT.test(quant.trim())
}

/** Is this a small model in a 1 or 2 bit packing. Needs both facts: without them the answer is no. */
export function packedTooHard(paramsB: number | undefined, quant: string | undefined): boolean {
  if (!quant || !COARSE_QUANT.test(quant.trim())) return false
  return typeof paramsB === 'number' && Number.isFinite(paramsB) && paramsB > 0 && paramsB <= COARSE_UP_TO_PARAMS_B
}

export type FitVerdict = 'fits' | 'tight' | 'too-large'

export interface FitDevice {
  platform: MobilePlatform
  /**
   * RAM in GB. Either the nominal figure (6) or what the device reports
   * (5.57): both land in the same class, see ramClassFor.
   */
  ramGb: number
  /**
   * Memory the system reports as still available, in MB. iOS:
   * os_proc_available_memory (limit minus current footprint). Android:
   * available memory of the system. 0 or undefined means "not known".
   * Measure it with no model loaded, otherwise the loaded model is counted twice.
   */
  availableMb?: number
  /** iOS: the app is signed with `increased-memory-limit`. Only changes the table fallback. */
  increasedMemoryLimit?: boolean
}

export interface FitModel {
  /** Size of the GGUF file. Preferred. */
  fileBytes?: number
  /**
   * Name of the GGUF file, with or without folder and ending. With it a file
   * that is another quantization of a catalogue model gets the shape of that
   * model (knownShape), so its verdict is the same before and after the download.
   */
  filename?: string
  /** Parameters in billions. With `quant` this estimates the size when fileBytes is missing. */
  paramsB?: number
  /** Quantization name such as "Q4_K_M". Case does not matter. */
  quant?: string
  /** KV cache bytes per context token (catalog: `kvBytesPerToken`). */
  kvBytesPerToken?: number
  /** Context the model was trained for. Caps the default context and maxContextFor. */
  maxContext?: number
}

export interface FitInput {
  device: FitDevice
  model: FitModel
  /** Context in tokens. Default: the RAM class default, capped by the model. */
  contextLength?: number
  /** True when the embedding model stays loaded next to the chat model. */
  embeddingLoaded?: boolean
  /** Size of that embedding model. Default: the catalog's. */
  embeddingBytes?: number
  /**
   * Measure against what the system reports as available right now
   * (`device.availableMb`) instead of the stable limit of the RAM class. Only
   * for a check right before a model is loaded, and only with a figure that
   * was read while no model was loaded. A badge never sets this: its answer
   * must be the same on every screen and at every moment.
   */
  momentary?: boolean
}

export interface FitResult {
  verdict: FitVerdict
  /** Estimated memory need in MB, rounded up. 0 when the size is unknown. */
  needMb: number
  /** Assumed or reported ceiling in MB. 0 when the device is below the smallest class. */
  limitMb: number
  /** TIGHT_SHARE of the limit: the budget that is never exceeded. */
  budgetMb: number
  /** FIT_SHARE of the limit: up to here the verdict is `fits`. */
  comfortMb: number
  /** Whether the limit is the reported figure or the table. */
  limitSource: 'reported' | 'table' | 'none'
  /** Context the estimate was made for. */
  contextLength: number
  parts: { weightsMb: number; kvCacheMb: number; runtimeMb: number; embeddingMb: number }
  /** The model fits in memory comfortably and is `tight` only because it is slow on this class of device (COMFORT_PARAMS_B). */
  slow: boolean
  /**
   * A small model in a 1 or 2 bit packing answers unreliably (`packedTooHard`). Then the verdict is `tight`, and
   * the badge speaks of the answers. Set whenever the file is not too large, also when it is slow or near the limit.
   */
  coarse: boolean
  /** Tight for memory: the need is above the comfortable share of the limit. */
  nearLimit: boolean
  /** One or two English sentences for the user. */
  reason: string
}

/**
 * The ceiling the verdict is measured against, or null when the device is
 * below the smallest class. Without `momentary` this is the table of the RAM
 * class and nothing else, so two screens that ask at different moments get
 * the same answer.
 */
export function memoryLimitFor(device: FitDevice, momentary = false): { limitMb: number; source: 'reported' | 'table' } | null {
  const row = ramClassFor(device.platform, device.ramGb)
  if (!row) return null
  const tableMb = device.platform === 'ios' && device.increasedMemoryLimit ? row.increasedLimitMb : row.limitMb
  if (!momentary) return { limitMb: tableMb, source: 'table' }
  const reported = typeof device.availableMb === 'number' && Number.isFinite(device.availableMb) && device.availableMb > 0
    ? device.availableMb
    : 0
  if (!reported) return { limitMb: tableMb, source: 'table' }
  // iOS reports the real limit minus the current footprint, so it replaces
  // the table in both directions (it is higher with the entitlement). Android
  // reports a momentary system figure that can exceed what one app may take,
  // so the table stays the upper bound.
  if (device.platform === 'ios') return { limitMb: reported, source: 'reported' }
  return reported < tableMb ? { limitMb: reported, source: 'reported' } : { limitMb: tableMb, source: 'table' }
}

/** File size from parameter count and quantization. Undefined when either is unusable. */
export function estimateFileBytes(paramsB: number | undefined, quant: string | undefined): number | undefined {
  if (!paramsB || !Number.isFinite(paramsB) || paramsB <= 0 || !quant) return undefined
  const bits = QUANT_BITS_PER_WEIGHT[quant.trim().toUpperCase()]
  if (!bits) return undefined
  return Math.round((paramsB * 1e9 * bits) / 8 + ESTIMATE_FLAT_BYTES)
}

function modelFileBytes(model: FitModel): number | undefined {
  if (typeof model.fileBytes === 'number' && Number.isFinite(model.fileBytes) && model.fileBytes > 0) return model.fileBytes
  return estimateFileBytes(model.paramsB, model.quant)
}

const CATALOG_BY_SIZE: ReadonlyMap<number, FitModel> = new Map(
  [...MOBILE_CHAT_MODELS].reverse().map((m) => [m.sizeBytes, { paramsB: m.paramsB, quant: m.quant, kvBytesPerToken: m.kvBytesPerToken, maxContext: m.trainedContext }]),
)

/**
 * What the catalogue knows about a file. Two ways lead there, and both give
 * the same shape the catalogue card uses:
 *
 *   - the size: file sizes are exact to the byte, so a hit IS the listed file.
 *     A caller that only has the downloaded file is served that way.
 *   - the name: another quantization of a catalogue model (the detail page
 *     offers them) has another size but the same parameters, the same KV
 *     cache per token and the same trained context. Its own quantization
 *     comes from its own name, never from the catalogue entry.
 *
 * Anything else keeps the careful fallbacks.
 */
export function knownShape(model: FitModel): FitModel {
  const bySize = typeof model.fileBytes === 'number' ? CATALOG_BY_SIZE.get(model.fileBytes) : undefined
  if (bySize) {
    return {
      ...model,
      paramsB: model.paramsB ?? bySize.paramsB,
      quant: model.quant ?? bySize.quant,
      kvBytesPerToken: model.kvBytesPerToken ?? bySize.kvBytesPerToken,
      maxContext: model.maxContext ?? bySize.maxContext,
    }
  }
  const byName = model.filename ? catalogModelForFile(model.filename) : undefined
  if (!byName) return model
  return {
    ...model,
    // The catalogue is the truth about its own models: what a caller guessed from a name or read from the file gives way.
    paramsB: byName.model.paramsB,
    quant: byName.quant ?? model.quant,
    kvBytesPerToken: byName.model.kvBytesPerToken,
    maxContext: byName.model.trainedContext,
  }
}

/** Parameters in billions, read from a repository or file name ("Qwen3-4B-GGUF" is 4). Undefined when it names none. */
export function paramsFromName(name: string): number | undefined {
  const hit = /(?:^|[-_ .])(\d+(?:\.\d+)?)\s?([bm])(?=$|[-_ .])/i.exec(name)
  if (!hit) return undefined
  const value = Number(hit[1])
  if (!(value > 0)) return undefined
  return hit[2].toLowerCase() === 'm' ? value / 1000 : value
}

/**
 * The model of a GGUF file as the fit functions take it, from the two things
 * that are known about a file both before the download (the file list of the
 * repository) and after it (the model folder): its name and its size.
 *
 * EVERY verdict about a file goes through here: the variants of the detail
 * page, a search hit, the list "Installed", the model sheet of the chat, the
 * check before a load. Nothing else may be added by a caller (no figure from
 * the repository name, none read from the downloaded file), because a second
 * source of facts is how one model got two verdicts (acceptance Android,
 * re-run, N1). What the catalogue knows about the file comes in through
 * knownShape inside assessFit.
 */
export function fitModelOfFile(filename: string, fileBytes?: number): FitModel {
  const leaf = (filename.split(/[\\/]/).pop() ?? filename).replace(/\.gguf$/i, '')
  return {
    fileBytes: typeof fileBytes === 'number' && fileBytes > 0 ? fileBytes : undefined,
    filename: leaf,
    quant: quantOfFileName(leaf),
    paramsB: paramsFromName(leaf),
  }
}

/** Parameters in billions: what is known, else read back from the file size and its quantization (Q4_K_M when unknown). */
export function paramsOf(model: FitModel, fileBytes: number): number {
  if (typeof model.paramsB === 'number' && Number.isFinite(model.paramsB) && model.paramsB > 0) return model.paramsB
  const bits = (model.quant ? QUANT_BITS_PER_WEIGHT[model.quant.trim().toUpperCase()] : undefined) ?? QUANT_BITS_PER_WEIGHT.Q4_K_M
  return Math.max(0, ((fileBytes - ESTIMATE_FLAT_BYTES) * 8) / bits / 1e9)
}

/** The largest parameter count that still counts as "runs well" on this device. 0 below the smallest class. */
export function comfortParamsFor(device: FitDevice): number {
  const row = ramClassFor(device.platform, device.ramGb)
  return row ? (COMFORT_PARAMS_B[device.platform][row.ramGb] ?? 0) : 0
}

function kvPerToken(model: FitModel, fileBytes: number): number {
  if (typeof model.kvBytesPerToken === 'number' && model.kvBytesPerToken > 0) return model.kvBytesPerToken
  return Math.max(FALLBACK_KV_MIN_BYTES, (fileBytes / GIB) * FALLBACK_KV_BYTES_PER_GIB)
}

function modelContextCap(model: FitModel): number {
  return typeof model.maxContext === 'number' && model.maxContext > 0 ? model.maxContext : Number.POSITIVE_INFINITY
}

/** Context a chat starts with on this device: the class default, capped by the model and MOBILE_MAX_CTX. */
export function defaultContextFor(device: FitDevice, model: FitModel = {}): number {
  const row = ramClassFor(device.platform, device.ramGb)
  const classDefault = row ? row.defaultContext : MOBILE_MIN_CTX
  return Math.max(1, Math.min(classDefault, MOBILE_MAX_CTX, modelContextCap(model)))
}

interface Need { needMb: number; parts: FitResult['parts'] }

function needFor(model: FitModel, fileBytes: number, contextLength: number, embeddingLoaded: boolean, embeddingBytes: number): Need {
  const weightsMb = (fileBytes / MIB) * WEIGHTS_FACTOR
  const kvCacheMb = (kvPerToken(model, fileBytes) * contextLength) / MIB
  const embeddingMb = embeddingLoaded ? (embeddingBytes / MIB) * WEIGHTS_FACTOR + EMBED_OVERHEAD_MB : 0
  const total = weightsMb + kvCacheMb + RUNTIME_OVERHEAD_MB + embeddingMb
  return {
    needMb: Math.ceil(total),
    parts: {
      weightsMb: Math.round(weightsMb),
      kvCacheMb: Math.round(kvCacheMb),
      runtimeMb: RUNTIME_OVERHEAD_MB,
      embeddingMb: Math.round(embeddingMb),
    },
  }
}

function verdictFor(needMb: number, limitMb: number): FitVerdict {
  if (needMb <= Math.floor(limitMb * FIT_SHARE)) return 'fits'
  if (needMb <= Math.floor(limitMb * TIGHT_SHARE)) return 'tight'
  return 'too-large'
}

/**
 * "850 MB" or "1.4 GB". From 1000 MB on the text comes from formatBytes, the
 * one place that turns bytes into text (lib/__tests__/eine-regel-fuer-bytes).
 * Below that a whole number of MB reads better than "850.0 MB".
 */
export function formatMemory(mb: number): string {
  if (mb < 1000) return `${Math.round(mb)} MB`
  // 1000 to 1023 MB would read "1000.0 MB"; they are "1.0 GB" like before.
  return formatBytes(Math.max(mb, 1024) * MIB)
}

function normalContext(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) return fallback
  return Math.floor(value)
}

/** The verdict for one model on one device. Never throws. */
export function assessFit(input: FitInput): FitResult {
  const { device } = input
  const model = knownShape(input.model)
  const contextLength = normalContext(input.contextLength, defaultContextFor(device, model))
  const fileBytes = modelFileBytes(model)
  const limit = memoryLimitFor(device, input.momentary === true)
  const limitMb = limit ? Math.floor(limit.limitMb) : 0
  const budgetMb = Math.floor(limitMb * TIGHT_SHARE)
  const comfortMb = Math.floor(limitMb * FIT_SHARE)
  const base = { limitMb, budgetMb, comfortMb, limitSource: limit ? limit.source : 'none' as const, contextLength, slow: false, coarse: false, nearLimit: false }

  if (fileBytes === undefined) {
    return {
      ...base, verdict: 'too-large', needMb: 0,
      parts: { weightsMb: 0, kvCacheMb: 0, runtimeMb: RUNTIME_OVERHEAD_MB, embeddingMb: 0 },
      reason: 'The size of this model is unknown, so LU cannot check whether it fits this device.',
    }
  }

  const embeddingBytes = typeof input.embeddingBytes === 'number' && input.embeddingBytes > 0 ? input.embeddingBytes : DEFAULT_EMBED_BYTES
  const embeddingLoaded = input.embeddingLoaded === true
  const { needMb, parts } = needFor(model, fileBytes, contextLength, embeddingLoaded, embeddingBytes)

  if (!limit) {
    return {
      ...base, verdict: 'too-large', needMb, parts,
      reason: 'This device has less memory than local models need. Use LU Cloud on this device.',
    }
  }

  const need = formatMemory(needMb)
  const byMemory = verdictFor(needMb, limitMb)
  // A small model in a 1 or 2 bit packing loads and is quick, and still answers badly. That is said first, whatever
  // else is true of the file: it is the one thing the user cannot see from the size. What the caller knows counts
  // here (name or catalogue), a guess from the file size does not.
  if (byMemory !== 'too-large' && packedTooHard(model.paramsB, model.quant)) {
    const packing = (model.quant ?? '').toUpperCase()
    const budget = formatMemory(budgetMb)
    if (byMemory === 'tight') {
      return {
        ...base, verdict: 'tight', coarse: true, nearLimit: true, needMb, parts,
        reason: `Tight on this device, and a model this small in the packing ${packing} may answer badly. Needs about ${need} of the ${budget} that are safe to use. Close other apps first. It may stop if memory runs low.`,
      }
    }
    const slow = paramsOf(model, fileBytes) > comfortParamsFor(device)
    return {
      ...base, verdict: 'tight', coarse: true, slow, needMb, parts,
      reason: `Fits in memory, but a model this small in the packing ${packing} may answer badly.${slow ? ' A model of this size also answers slowly on this device.' : ''} Needs about ${need} of the ${budget} that are safe to use.`,
    }
  }
  // Memory is not all: a model that fits but is too large for the pace of this class is not "runs well".
  if (byMemory === 'fits' && paramsOf(model, fileBytes) > comfortParamsFor(device)) {
    return {
      ...base, verdict: 'tight', slow: true, needMb, parts,
      reason: `Fits in memory, but a model of this size answers slowly on this device. Needs about ${need} of the ${formatMemory(budgetMb)} that are safe to use.`,
    }
  }
  const verdict = byMemory
  let reason: string
  if (verdict === 'fits') {
    reason = `Fits this device. Needs about ${need} of the ${formatMemory(budgetMb)} that are safe to use.`
  } else if (verdict === 'tight') {
    reason = `Tight on this device. Needs about ${need} of the ${formatMemory(budgetMb)} that are safe to use. Close other apps first. It may stop if memory runs low.`
  } else {
    const smaller = maxContextFor({ ...input, model, contextLength: undefined }, { allow: 'tight', ceiling: contextLength - 1 })
    const head = `Too large for this device. Needs about ${need}, but only ${formatMemory(budgetMb)} are safe to use.`
    const bits = model.quant ? QUANT_BITS_PER_WEIGHT[model.quant.trim().toUpperCase()] : undefined
    if (smaller > 0) reason = `${head} A context of ${smaller} tokens would fit.`
    else if (embeddingLoaded && verdictFor(needFor(model, fileBytes, contextLength, false, embeddingBytes).needMb, limitMb) !== 'too-large') {
      reason = `${head} It would fit without the document model loaded at the same time.`
    } else if (bits && bits > QUANT_BITS_PER_WEIGHT.Q4_K_M) reason = `${head} Choose a smaller quantization such as Q4_K_M, or a smaller model.`
    else reason = `${head} Choose a smaller model.`
  }
  return { ...base, verdict, nearLimit: verdict === 'tight', needMb, parts, reason }
}

export interface MaxContextOptions {
  /** `tight` (default) accepts a tight fit, `fits` only a comfortable one. */
  allow?: 'fits' | 'tight'
  /** Upper bound in tokens. Default MOBILE_MAX_CTX. The model's own maximum always applies too. */
  ceiling?: number
}

/**
 * The largest context (the ceiling itself, else a multiple of CTX_STEP) with
 * which the model still gets the wanted verdict. 0 when not even
 * MOBILE_MIN_CTX works. `input.contextLength` is ignored.
 */
export function maxContextFor(input: FitInput, options: MaxContextOptions = {}): number {
  const { device } = input
  const model = knownShape(input.model)
  const fileBytes = modelFileBytes(model)
  const limit = memoryLimitFor(device, input.momentary === true)
  if (fileBytes === undefined || !limit) return 0
  const limitMb = Math.floor(limit.limitMb)
  const allowTight = (options.allow ?? 'tight') === 'tight'
  const wanted = typeof options.ceiling === 'number' && Number.isFinite(options.ceiling) ? Math.floor(options.ceiling) : MOBILE_MAX_CTX
  const ceiling = Math.min(wanted, modelContextCap(model))
  if (ceiling < MOBILE_MIN_CTX) return 0
  const embeddingBytes = typeof input.embeddingBytes === 'number' && input.embeddingBytes > 0 ? input.embeddingBytes : DEFAULT_EMBED_BYTES
  // A model that is slow on this class never "fits", whatever the context: a shorter one does not make it faster.
  if (!allowTight && paramsOf(model, fileBytes) > comfortParamsFor(device)) return 0
  const ok = (ctx: number): boolean => {
    const verdict = verdictFor(needFor(model, fileBytes, ctx, input.embeddingLoaded === true, embeddingBytes).needMb, limitMb)
    return verdict === 'fits' || (allowTight && verdict === 'tight')
  }
  if (ok(ceiling)) return ceiling
  for (let ctx = Math.floor((ceiling - 1) / CTX_STEP) * CTX_STEP; ctx >= MOBILE_MIN_CTX; ctx -= CTX_STEP) {
    if (ok(ctx)) return ctx
  }
  return 0
}

// Test seam
//
// The iOS simulator reports 0 available bytes and the RAM of the Mac, an
// Android emulator whatever it was configured with. Without a way to pretend
// to be a device, every model would be "fits" (48 GB) or none would. The
// override below is that way: tests set it directly, the app sets it from a
// debug setting (parseDeviceOverride reads the text form).

/** What the native side reports. Every field may be missing. */
export interface ReportedMemory {
  platform: MobilePlatform
  /** Physical memory in bytes (iOS hw.memsize, Android MemTotal). */
  totalBytes?: number
  /** iOS os_proc_available_memory, Android available memory. 0 means unknown. */
  availableBytes?: number
  /** iOS hw.machine, e.g. "iPhone15,4". "arm64" or "x86_64" in the simulator. */
  machine?: string
  increasedMemoryLimit?: boolean
  /** The native layer says this is the iOS simulator or an Android emulator. */
  emulator?: boolean
}

/** A pretended device. */
export interface DeviceOverride {
  /** Default: the platform that was reported. */
  platform?: MobilePlatform
  ramGb: number
  availableMb?: number
  increasedMemoryLimit?: boolean
  /** Shown in debug views. */
  label?: string
}

export interface ResolvedDevice {
  device: FitDevice
  /**
   * override    a pretended device is active
   * identifier  found in the Apple table by hw.machine
   * reported    RAM as reported by the system
   * simulator   iOS simulator without override: the simulated model, else SIMULATOR_DEFAULT
   * unknown     nothing usable was reported: ramGb is 0 and nothing fits
   */
  source: 'override' | 'identifier' | 'reported' | 'simulator' | 'unknown'
  /** True when the report looks like the iOS simulator. */
  simulator: boolean
  label?: string
}

/** What the iOS simulator counts as when nobody chose a device: a 6 GB iPhone, the most common class. */
export const SIMULATOR_DEFAULT: DeviceOverride = { platform: 'ios', ramGb: 6, label: 'Simulator (as iPhone 15, 6 GB)' }

/** No real iPhone or iPad has more than 16 GB. Anything clearly above is a Mac. */
const IOS_MAX_REAL_RAM_BYTES = 17 * GIB

let activeOverride: DeviceOverride | null = null

/** Pretend to be a device. Pass null to stop pretending. */
export function setDeviceOverride(override: DeviceOverride | null): void {
  activeOverride = override ? { ...override } : null
}

export function getDeviceOverride(): DeviceOverride | null {
  return activeOverride ? { ...activeOverride } : null
}

/**
 * Text form of an override, for a debug setting or an environment variable:
 *
 *   "ios:6"            a 6 GB iPhone or iPad
 *   "android:8"        an 8 GB Android phone
 *   "ios:8+"           with the increased-memory-limit entitlement
 *   "ios:6:2500"       additionally 2500 MB reported as available
 *   "iPhone15,4"       a device from the table by identifier
 *   "iPad16,3:16"      an identifier with two RAM sizes, the 16 GB one
 *
 * Returns null for anything else, including an empty string.
 */
export function parseDeviceOverride(text: string | null | undefined): DeviceOverride | null {
  const raw = (text ?? '').trim()
  if (!raw) return null
  const parts = raw.split(':').map((part) => part.trim())
  const head = parts[0].toLowerCase()
  if (head === 'ios' || head === 'android') {
    const match = /^(\d+(?:\.\d+)?)(\+?)$/.exec(parts[1] ?? '')
    if (!match) return null
    const ramGb = Number(match[1])
    if (!(ramGb > 0)) return null
    const override: DeviceOverride = { platform: head, ramGb, label: raw }
    if (match[2] === '+') override.increasedMemoryLimit = true
    if (parts[2] !== undefined) {
      const availableMb = Number(parts[2])
      if (!Number.isFinite(availableMb) || availableMb < 0) return null
      override.availableMb = availableMb
    }
    return override
  }
  const rows = appleDevicesByIdentifier(parts[0])
  if (rows.length === 0) return null
  let row = rows.reduce((low, next) => (next.ramGb < low.ramGb ? next : low))
  if (parts[1] !== undefined) {
    const wanted = rows.find((candidate) => candidate.ramGb === Number(parts[1]))
    if (!wanted) return null
    row = wanted
  }
  return { platform: 'ios', ramGb: row.ramGb, label: `${row.name} (${row.ramGb} GB)` }
}

function looksLikeIosSimulator(reported: ReportedMemory): boolean {
  if (reported.platform !== 'ios') return false
  if (reported.emulator === true) return true
  const machine = (reported.machine ?? '').trim().toLowerCase()
  if (machine === 'arm64' || machine === 'x86_64' || machine === 'i386') return true
  return typeof reported.totalBytes === 'number' && reported.totalBytes > IOS_MAX_REAL_RAM_BYTES
}

function fromOverride(override: DeviceOverride, reported: ReportedMemory, source: 'override' | 'simulator', simulator: boolean): ResolvedDevice {
  const device: FitDevice = { platform: override.platform ?? reported.platform, ramGb: override.ramGb }
  if (typeof override.availableMb === 'number' && override.availableMb > 0) device.availableMb = override.availableMb
  if (override.increasedMemoryLimit) device.increasedMemoryLimit = true
  return { device, source, simulator, ...(override.label ? { label: override.label } : {}) }
}

/**
 * Turn the native report into the device the fit functions take.
 *
 * Order: an override wins over everything. The iOS simulator without an
 * override becomes the phone it simulates, or SIMULATOR_DEFAULT when it does
 * not say which. A known identifier gives the nominal
 * RAM (with two RAM sizes per identifier the reported RAM picks, else the
 * smaller one). Otherwise the reported RAM is used as it is.
 */
export function resolveDevice(reported: ReportedMemory, override: DeviceOverride | null = getDeviceOverride()): ResolvedDevice {
  const simulator = looksLikeIosSimulator(reported)
  if (override) return fromOverride(override, reported, 'override', simulator)
  if (simulator) {
    // The simulator reports the memory of the Mac and nothing as available,
    // so neither figure is used. When it names the phone it plays (hw.machine
    // of the simulated model), that phone's nominal RAM counts, the smaller
    // one where an identifier has two. Otherwise it is a 6 GB iPhone.
    const rows = reported.machine ? appleDevicesByIdentifier(reported.machine) : []
    if (rows.length === 0) return fromOverride(SIMULATOR_DEFAULT, reported, 'simulator', true)
    const row = rows.reduce((low, next) => (next.ramGb < low.ramGb ? next : low))
    return {
      device: { platform: 'ios', ramGb: row.ramGb },
      source: 'simulator', simulator: true, label: `Simulator (as ${row.name}, ${row.ramGb} GB)`,
    }
  }

  const totalGb = typeof reported.totalBytes === 'number' && reported.totalBytes > 0 ? reported.totalBytes / GIB : 0
  const availableMb = typeof reported.availableBytes === 'number' && reported.availableBytes > 0 ? reported.availableBytes / MIB : 0
  const extras: Partial<FitDevice> = {}
  if (availableMb > 0) extras.availableMb = availableMb
  if (reported.increasedMemoryLimit) extras.increasedMemoryLimit = true

  if (reported.platform === 'ios' && reported.machine) {
    const rows = appleDevicesByIdentifier(reported.machine)
    if (rows.length > 0) {
      const reportedClass = totalGb > 0 ? ramClassFor('ios', totalGb)?.ramGb : undefined
      const row = rows.find((candidate) => candidate.ramGb === reportedClass)
        ?? rows.reduce((low, next) => (next.ramGb < low.ramGb ? next : low))
      return {
        device: { platform: 'ios', ramGb: row.ramGb, ...extras },
        source: 'identifier', simulator: false, label: `${row.name} (${row.ramGb} GB)`,
      }
    }
  }
  if (totalGb > 0) return { device: { platform: reported.platform, ramGb: totalGb, ...extras }, source: 'reported', simulator: false }
  return { device: { platform: reported.platform, ramGb: 0, ...extras }, source: 'unknown', simulator: false }
}
