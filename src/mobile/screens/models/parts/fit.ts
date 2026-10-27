/**
 * The fit verdict in the words of the screens.
 *
 * The calculation is lib/device-fit.ts (assessFit, maxContextFor) and is not
 * repeated here: memory, the pace line of the RAM class and the shape of a
 * catalogue file are all decided there, so this strand, the model sheet of
 * the chat and the onboarding show the same verdict for the same model. This file only turns its result into what a card, the detail
 * page and the onboarding show: the level for the badge, one sentence for the
 * card, whole sentences for M2, and the line about this phone.
 *
 * Pure: no store, no DOM, no Tauri. Tested in ../__tests__/fit.test.ts.
 */
import { formatBytes, formatContextWindow } from '../../../../lib/formatters'
import { ramClassFor } from '../../../data/device-memory'
import { MOBILE_CHAT_MODELS, mayBeRecommended, quantOfFileName, recommendedModelsFor, type MobileModel } from '../../../data/mobile-models'
import { MIB, assessFit, maxContextFor, memoryLimitFor, TIGHT_SHARE, type FitDevice, type FitModel } from '../../../lib/device-fit'
import { MODELS_STRINGS as S } from '../../../strings/models'

export type FitLevel = 'fits' | 'tight' | 'too-large' | 'unknown'

const GIB = 1_073_741_824

export interface FitView {
  level: FitLevel
  /** Memory the model needs while it runs. 0 when unknown. */
  needBytes: number
  /** What this phone can give a model without risk (the tight budget). 0 when unknown. */
  usableBytes: number
  /** Context the verdict was made for, 0 when unknown. */
  contextLength: number
  /** Largest context that still runs on this phone, 0 when none or unknown. */
  maxContext: number
  /** One sentence for the card. Empty for `fits`. */
  short: string
  /** Whole sentences for the detail page. */
  long: string
  /** A small model in a 1 or 2 bit packing: the badge says that its answers may be poor, whatever else is true of the file. */
  coarse?: boolean
  /** With `coarse`: the file is also close to the memory limit, and the question before the download says both. */
  nearLimit?: boolean
}

/** The words of the badge. One place, so the card, the detail page, the onboarding and the model sheet say the same. */
export function fitWord(fit: Pick<FitView, 'level' | 'coarse'>): string {
  if (fit.coarse) return S.fit.coarse
  return { fits: S.fit.fits, tight: S.fit.tight, 'too-large': S.fit.tooLarge, unknown: S.fit.unknown }[fit.level]
}

/** "8 GB": the class the phone belongs to, else what it reports. */
export function ramText(device: FitDevice): string {
  const row = ramClassFor(device.platform, device.ramGb)
  const gb = row ? row.ramGb : Math.max(0, Math.round(device.ramGb))
  return formatBytes(gb * GIB).replace('.0 ', ' ')
}

/** What can safely go to a model on this phone, in bytes. 0 below the smallest class. */
export function usableBytesFor(device: FitDevice): number {
  const limit = memoryLimitFor(device)
  return limit ? Math.floor(limit.limitMb * TIGHT_SHARE) * MIB : 0
}

/** True when nothing usable is known about the phone (browser without figures). */
export function deviceUnknown(device: FitDevice | null): device is null {
  return !device || !(device.ramGb > 0)
}

const EMPTY: Omit<FitView, 'level' | 'short' | 'long'> = { needBytes: 0, usableBytes: 0, contextLength: 0, maxContext: 0 }

/** The verdict for one model on this phone, in the words of the screens. Never throws. */
export function fitView(model: FitModel, device: FitDevice | null, fileBytes?: number): FitView {
  const sized: FitModel = { ...model, fileBytes: model.fileBytes ?? fileBytes }
  const hasSize = (typeof sized.fileBytes === 'number' && sized.fileBytes > 0) || (!!sized.paramsB && !!sized.quant)
  if (deviceUnknown(device)) {
    return { ...EMPTY, level: 'unknown', short: S.fit.unknownDevice, long: S.fit.unknownDeviceLong }
  }
  if (!hasSize) return { ...EMPTY, usableBytes: usableBytesFor(device), level: 'unknown', short: '', long: S.fit.unknownLong }

  const result = assessFit({ device, model: sized })
  const needBytes = result.needMb * MIB
  const usableBytes = result.budgetMb * MIB
  const need = formatBytes(needBytes)
  const usable = formatBytes(usableBytes)
  const maxContext = maxContextFor({ device, model: sized })
  const base = { needBytes, usableBytes, contextLength: result.contextLength, maxContext }
  if (result.limitSource === 'none') {
    return { ...base, level: 'too-large', short: S.fit.tooSmallDevice, long: S.fit.tooSmallDevice }
  }
  if (result.verdict === 'fits') return { ...base, level: 'fits', short: '', long: S.fit.fitsLong(need, usable) }
  // A small model in a 1 or 2 bit packing. Said before pace: the answers are what the user cannot guess from a size.
  // It has room unless it is near the limit as well, and then both are said.
  if (result.coarse) {
    const packing = (sized.quant ?? quantOfFileName(sized.filename ?? '') ?? '').toUpperCase()
    if (result.nearLimit) return { ...base, level: 'tight', coarse: true, nearLimit: true, short: '', long: `${S.fit.tightLong(need, usable)} ${S.fit.coarseAlso(packing)}` }
    return { ...base, level: 'tight', coarse: true, short: '', long: S.fit.coarseLong(need, usable, packing) }
  }
  // Tight for its pace, not for memory: the sentence must not speak of a limit that is not near.
  if (result.slow) return { ...base, level: 'tight', short: '', long: S.fit.slowLong(need, usable, ramText(device)) }
  if (result.verdict === 'tight') return { ...base, level: 'tight', short: '', long: S.fit.tightLong(need, usable) }
  const size = sized.fileBytes ? formatBytes(sized.fileBytes) : need
  return {
    ...base,
    level: 'too-large',
    short: S.fit.tooLargeShort(need, usable, ramText(device)),
    long: S.fit.tooLargeLong(need, ramText(device), usable, size),
  }
}

export function fitOfCatalogModel(model: MobileModel, device: FitDevice | null): FitView {
  return fitView(
    { fileBytes: model.sizeBytes, paramsB: model.paramsB, quant: model.quant, kvBytesPerToken: model.kvBytesPerToken, maxContext: model.trainedContext },
    device,
  )
}

/** The line about this phone above the catalogue (M1) and in the onboarding (A2). */
export function deviceLine(device: FitDevice | null, freeBytes: number | null, short = false): string {
  if (deviceUnknown(device)) return S.device.unknown
  const ram = ramText(device)
  const usable = formatBytes(usableBytesFor(device))
  const free = typeof freeBytes === 'number' && freeBytes >= 0 ? formatBytes(freeBytes) : null
  if (short) return free ? S.device.short(ram, free) : S.device.shortNoStorage(ram)
  return free ? S.device.line(ram, usable, free) : S.device.lineNoStorage(ram, usable)
}

export interface CatalogFilters {
  fitsOnly: boolean
  mainstream: boolean
  unfiltered: boolean
  vision: boolean
}

export const DEFAULT_FILTERS: CatalogFilters = { fitsOnly: true, mainstream: false, unfiltered: false, vision: false }

/** Can the model read images on this phone. The catalogue lists no projector yet, so today this is false for all. */
export function readsImages(model: { mmprojUrl?: string }): boolean {
  return !!model.mmprojUrl
}

/**
 * A catalogue model that did not answer a plain question in the measurement
 * run (NOT_RECOMMENDED in data/mobile-models.ts). It stays in the catalogue
 * because it loads and computes correctly, but the card and the detail page
 * say so, it stands below the others, and it is never proposed.
 */
export function answersPoorly(model: { id?: string } | null | undefined): boolean {
  return !!model?.id && !mayBeRecommended(model.id)
}

/** Does any model of this list read images. While none does, the filter "Vision" is not shown (vollstaendigkeit-2 M4). */
export function anyReadsImages(models: readonly { mmprojUrl?: string }[]): boolean {
  return models.some(readsImages)
}

/**
 * The catalogue as M1 shows it. "Fits this phone" hides what is too large,
 * the two kind chips narrow to their kind (both or none means both), Vision
 * keeps models that read images. Order: as the catalogue lists them, models
 * that answer poorly last.
 */
export function filterCatalog(models: readonly MobileModel[], device: FitDevice | null, filters: CatalogFilters): MobileModel[] {
  const kinds = filters.mainstream !== filters.unfiltered
  // A stored "Vision" from a time the chip existed must not empty the list while no model reads images.
  const vision = filters.vision && anyReadsImages(models)
  const kept = models.filter((model) => {
    if (kinds && filters.mainstream && model.uncensored) return false
    if (kinds && filters.unfiltered && !model.uncensored) return false
    if (vision && !readsImages(model)) return false
    if (filters.fitsOnly && fitOfCatalogModel(model, device).level === 'too-large') return false
    return true
  })
  return [...kept.filter((model) => !answersPoorly(model)), ...kept.filter(answersPoorly)]
}

export interface StarterList {
  /** The model the onboarding proposes for this kind, when there is one that runs. */
  recommended: MobileModel | null
  /** Recommended first, then what runs well (largest first), then tight, then too large. */
  models: MobileModel[]
  /** False when nothing of this kind can run on this phone. */
  anyRuns: boolean
}

const ORDER: Record<FitLevel, number> = { fits: 0, unknown: 1, tight: 2, 'too-large': 3 }

/**
 * The starter models of one kind for the onboarding (A2).
 *
 * The proposal is the line of the table (data/mobile-models.ts) for the class
 * of this phone, as long as it runs here: "fits" or "tight". Two lines of the
 * table are tight on purpose (TIGHT_RECOMMENDATIONS): on the smallest class
 * no model that answers correctly fits comfortably, and the tight one is the
 * right proposal. It keeps its "tight" badge and the question before the
 * download.
 *
 * Only when the proposal of the table does not run here (a pretended device,
 * a reported figure below the class) another model stands in: the largest
 * that runs well, else the smallest that runs tight. A model that must not be
 * proposed (NOT_RECOMMENDED, for example SmolLM2 360M) never stands in, and
 * then there is no proposal rather than a wrong one.
 *
 * `uncensored` false is the proposal with `unfiltered: false`, the only one a
 * build without the unfiltered catalogue has (parts/policy.ts `startersFor`).
 */
export function starterModels(device: FitDevice | null, uncensored: boolean, all: readonly MobileModel[] = MOBILE_CHAT_MODELS): StarterList {
  const kind = all.filter((model) => model.uncensored === uncensored)
  const levels = new Map(kind.map((model) => [model.id, fitOfCatalogModel(model, device).level]))
  const levelOf = (model: MobileModel): FitLevel => levels.get(model.id) ?? 'unknown'
  const pair = deviceUnknown(device) ? undefined : recommendedModelsFor(device.platform, device.ramGb)
  const wanted = pair ? (uncensored ? pair.uncensored : pair.mainstream) : undefined
  // The table may name a model this build does not offer (a narrowed catalogue).
  const proposal = wanted && kind.some((model) => model.id === wanted.id) ? wanted : undefined
  const runs = (model: MobileModel) => levelOf(model) !== 'too-large'
  const allowed = kind.filter((model) => mayBeRecommended(model.id))
  const well = allowed.filter((model) => levelOf(model) === 'fits').sort((a, b) => b.sizeBytes - a.sizeBytes)[0]
  const tight = allowed.filter((model) => levelOf(model) === 'tight').sort((a, b) => a.sizeBytes - b.sizeBytes)[0]
  // An unknown phone has no table line and no verdict: nothing is proposed, nothing is locked.
  const standIn = deviceUnknown(device) ? undefined : (well ?? tight)
  const proposalRuns = !!proposal && (levelOf(proposal) === 'fits' || levelOf(proposal) === 'tight')
  const recommended = proposalRuns ? proposal : (standIn ?? null)
  const models = [...kind].sort((a, b) => {
    if (recommended && a.id === recommended.id) return -1
    if (recommended && b.id === recommended.id) return 1
    const byLevel = ORDER[levelOf(a)] - ORDER[levelOf(b)]
    if (byLevel !== 0) return byLevel
    // Inside a level, a model that answers poorly stands below the others.
    const byAnswer = Number(answersPoorly(a)) - Number(answersPoorly(b))
    if (byAnswer !== 0) return byAnswer
    return levelOf(a) === 'too-large' ? a.sizeBytes - b.sizeBytes : b.sizeBytes - a.sizeBytes
  })
  return { recommended, models, anyRuns: kind.some(runs) }
}

/** Context sizes the engine page offers: powers of two up to what the phone carries with this model. */
export function contextChoices(maxContext: number): number[] {
  return [1024, 2048, 4096].filter((ctx) => ctx <= maxContext)
}

export function contextText(tokens: number): string {
  return formatContextWindow(tokens)
}
