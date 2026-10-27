/**
 * The phone catalogue and the files on this phone, in the shape the cards
 * and the detail page take, and the download plan of a model.
 */
import { planModelDownload, type PlannedDownload } from '../../../../api/discover'
import type { BundledModel } from '../../../../api/engine'
import type { DiscoverModel } from '../../../../api/model-bundles'
import { formatBytes } from '../../../../lib/formatters'
import { MOBILE_CHAT_MODELS, catalogModelForFile, mobileModelById, quantOfFileName, type MobileModel } from '../../../data/mobile-models'
import { fitModelOfFile, packedBelowThreeBit, type FitDevice } from '../../../lib/device-fit'
import type { HfVariant } from './adapters/hf'
import { answersPoorly, fitOfCatalogModel, fitView, readsImages, type FitView } from './fit'
import { bareName, catalogKinOf, chatModelId, displayName, fileOf, fileRouteId } from './installed'
import type { CardModel, CardPacking } from './ModelCard'

export type { CardPacking }

export function cardOfCatalog(model: MobileModel): CardModel {
  return {
    routeId: model.id,
    name: model.name,
    filename: model.filename,
    sizeText: formatBytes(model.sizeBytes),
    quant: model.quant,
    description: model.description,
    uncensored: model.uncensored,
    tools: model.agent === true,
    vision: readsImages(model),
    thinking: model.thinking,
    weak: answersPoorly(model),
  }
}

/** Everything a catalogue model puts on the phone, through the same planner the desktop uses. */
export function planOfCatalog(model: MobileModel): PlannedDownload[] {
  return planModelDownload(model, model.downloadUrl, model.filename, model.expectedBytes, model.sha256)
}

export function quantOfName(name: string): string | undefined {
  return quantOfFileName(name)
}

/**
 * The card of a file on this phone. The listed file of a catalogue model is
 * that model's card. Another quantization of a catalogue model keeps what the
 * model can do (Thinking, No Filter, and Tools from 3 bit on) and says which packing it is. A
 * file the catalogue does not know is shown by its name.
 */
export function cardOfFile(file: BundledModel): CardModel {
  const kin = catalogKinOf(file)
  if (kin?.exact) return cardOfCatalog(kin.model)
  const own = { routeId: fileRouteId(file.name), name: displayName(file), filename: `${file.name}.gguf`, sizeText: formatBytes(file.size), quant: quantOfName(file.name) }
  return kin ? { ...cardOfCatalog(kin.model), ...own, tools: toolsInPacking(kin.model, own.quant) } : own
}

/**
 * The Tools mark of a catalogue model in another packing: the model drives
 * tools and the file is packed with 3 bits or more. A 1 or 2 bit packing
 * loses the mark in every place, because Agent mode does not take it (check
 * on Android with 4 GB, F3; lib/model-facts.ts says the same to the chat).
 */
export function toolsInPacking(model: MobileModel, quant: string | undefined): boolean {
  return model.agent === true && !packedBelowThreeBit(quant)
}

/**
 * The verdict for a GGUF file by its name and size: the one way for a variant
 * on the detail page, a search hit and a file on this phone (lib/device-fit
 * `fitModelOfFile`). The same file gets the same verdict before and after its download.
 */
export function fitOfNamedFile(filename: string, sizeBytes: number | undefined, device: FitDevice | null): FitView {
  return fitView(fitModelOfFile(filename, sizeBytes), device)
}

export function fitOfFile(file: BundledModel, device: FitDevice | null): FitView {
  const kin = catalogKinOf(file)
  if (kin?.exact) return fitOfCatalogModel(kin.model, device)
  const view = fitOfNamedFile(file.name, file.size, device)
  // What the file itself says about its trained context narrows the context that is offered, never the verdict.
  const trained = typeof file.ctx_train === 'number' && file.ctx_train > 0 ? file.ctx_train : 0
  return trained > 0 && view.maxContext > trained ? { ...view, maxContext: trained } : view
}

/** Repository id of a search hit ("bartowski/Foo-GGUF"). */
export function repoOfHit(hit: DiscoverModel): string {
  return hit.description
}

export function hitRouteId(repo: string): string {
  return `hf:${repo}`
}

/** The variant a card offers for a hit: Q4_K_M when it is a single file, else the smallest single file. */
export function defaultVariant(variants: readonly HfVariant[]): HfVariant | undefined {
  const single = variants.filter((v) => !v.sharded)
  return single.find((v) => v.quant === 'Q4_K_M') ?? single[0] ?? variants[0]
}

export function fitOfVariant(variant: HfVariant | undefined, device: FitDevice | null): FitView {
  return fitOfNamedFile(variant?.files[0]?.filename ?? '', variant && variant.totalBytes > 0 ? variant.totalBytes : undefined, device)
}

export function planOfVariant(variant: HfVariant): PlannedDownload[] {
  return variant.files.map((f) => ({ url: f.url, filename: f.filename, expectedBytes: f.sizeBytes > 0 ? f.sizeBytes : undefined, sha256: f.sha256 }))
}

export function cardOfHit(hit: DiscoverModel, variant: HfVariant | undefined): CardModel {
  const repo = repoOfHit(hit)
  return {
    routeId: hitRouteId(repo),
    name: hit.name,
    filename: variant?.files[0]?.filename ?? '',
    sizeText: variant && variant.totalBytes > 0 ? formatBytes(variant.totalBytes) : '',
    quant: variant?.quant,
    description: repo,
  }
}

function mobileModelByFilename(filename: string): MobileModel | undefined {
  return MOBILE_CHAT_MODELS.find((m) => m.filename === filename)
}

export type ModelRef =
  | { kind: 'catalog'; model: MobileModel }
  | { kind: 'hf'; repo: string }
  | { kind: 'file'; name: string }
  | { kind: 'none' }

/** What a detail page id points at: a catalogue id, "hf:<repo>" or "file:<name>". */
export function parseRouteId(id: string | undefined): ModelRef {
  if (!id) return { kind: 'none' }
  if (id.startsWith('hf:')) {
    const repo = id.slice(3)
    return /^[\w.-]+\/[\w.-]+$/.test(repo) ? { kind: 'hf', repo } : { kind: 'none' }
  }
  if (id.startsWith('file:')) return id.length > 5 ? { kind: 'file', name: id.slice(5) } : { kind: 'none' }
  const model = mobileModelById(id)
  return model ? { kind: 'catalog', model } : { kind: 'none' }
}

/** Where the row of a download leads: the catalogue model, the repository it came from, or the file. */
export function routeIdOfDownload(filename: string, url: string | undefined): string {
  const known = mobileModelByFilename(filename)
  if (known) return known.id
  const repo = /huggingface\.co\/([\w.-]+\/[\w.-]+)\/resolve\//.exec(url ?? '')?.[1]
  return repo ? `hf:${repo}` : fileRouteId(filename.replace(/\.gguf$/i, ''))
}


export interface CatalogCardState {
  /** The file on this phone the card acts on: the listed file, else a packing of the same model. */
  file?: BundledModel
  /** Set when `file` is not the listed file. */
  packing?: CardPacking
  /** The download of another packing that is not finished, when the listed file has none of its own. */
  transfer?: { id: string; name: string; quant: string }
  /**
   * Set when the listed file is on the phone AND other packings of the model are too:
   * the packing of the listed file and the packings next to it, largest first.
   */
  beside?: { listed: string; others: string[] }
}

/** The id of an unfinished download of ANOTHER packing of `model`. Empty when there is none. */
export function packingInFlight(model: Pick<MobileModel, 'id' | 'filename'>, rows: Readonly<Record<string, { status: string } | undefined>>): string {
  for (const [id, row] of Object.entries(rows)) {
    if (!row || row.status === 'complete' || id === model.filename) continue
    const kin = catalogModelForFile(id)
    if (kin && !kin.exact && kin.model.id === model.id) return id
  }
  return ''
}

/**
 * The list "Installed": which card shows the download of a further packing.
 *
 * A card there is a file. While another packing of the same catalogue model
 * was loading, "Get new" showed its progress on the card of the model and
 * "Installed" showed nothing (second check on Android, F13). The download is
 * shown once per model, on the first card of that model in the list, so two
 * packings on the phone do not show the same bar twice.
 *
 * Returns path of the file -> the download to show on its card.
 */
export function installedCardTransfers(
  files: readonly BundledModel[],
  rows: Readonly<Record<string, { status: string } | undefined>>,
): Record<string, { id: string; name: string; quant: string }> {
  const out: Record<string, { id: string; name: string; quant: string }> = {}
  const shown = new Set<string>()
  const names = new Set(files.map((f) => f.name))
  for (const file of files) {
    const kin = catalogKinOf(file)
    if (!kin || shown.has(kin.model.id)) continue
    for (const [id, row] of Object.entries(rows)) {
      // A finished download is a file of the list already. So is a row that carries the name of a file that is there.
      if (!row || row.status === 'complete' || names.has(id) || names.has(bareName(id))) continue
      const other = catalogModelForFile(id)
      if (!other || other.model.id !== kin.model.id) continue
      out[file.path] = { id, name: displayName({ name: bareName(id) }), quant: quantOfFileName(id) ?? '' }
      shown.add(kin.model.id)
      break
    }
  }
  return out
}

/**
 * What the card of a catalogue model stands for on this phone.
 *
 * The card knew one file: the listed one. A model whose smallest packing was
 * on the phone, or on its way, still offered "Download 1.2 GB" and said
 * nothing of either (acceptance on the large iPhone, G3 and G11). Now the
 * card says which packing is there or loads. The listed file wins when it is
 * there too. Among several packings the loaded one stands for the model, then
 * the chat model, then the largest.
 *
 * With the listed file on the phone the card said "Installed" and nothing
 * else, also while a second packing was loading and after it had arrived
 * (re-check Android 8 GB, A-05). The listed file still is the card, but the
 * download of the other packing and the packings next to it are handed on.
 */
export function catalogCardState(
  model: MobileModel,
  files: readonly BundledModel[],
  inFlightId: string,
  prefer: { loadedPath?: string | null; activeChatModel?: string | null } = {},
): CatalogCardState {
  const listed = fileOf(files, model.filename)
  const packings = files.filter((f) => {
    const kin = catalogKinOf(f)
    return !!kin && !kin.exact && kin.model.id === model.id
  })
  const transfer = inFlightId
    ? { id: inFlightId, name: displayName({ name: bareName(inFlightId) }), quant: quantOfFileName(inFlightId) ?? '' }
    : undefined
  if (listed) {
    const state: CatalogCardState = { file: listed }
    if (transfer) state.transfer = transfer
    if (packings.length > 0) {
      const others = [...packings].sort((a, b) => (b.size || 0) - (a.size || 0)).map((f) => quantOfFileName(f.name) || displayName(f))
      state.beside = { listed: model.quant || quantOfFileName(model.filename) || model.name, others }
    }
    return state
  }
  if (packings.length === 0) return { transfer }
  const file =
    packings.find((f) => !!prefer.loadedPath && f.path === prefer.loadedPath) ??
    packings.find((f) => !!prefer.activeChatModel && chatModelId(f.name) === prefer.activeChatModel) ??
    [...packings].sort((a, b) => (b.size || 0) - (a.size || 0))[0]
  return {
    file,
    packing: { quant: quantOfFileName(file.name) ?? '', name: displayName(file), sizeText: formatBytes(file.size), more: packings.length - 1 },
    transfer,
  }
}

/**
 * The card of a catalogue model, for the file it stands for on this phone.
 *
 * With another packing on the phone the card already gave the verdict of that
 * file and named it ("Installed: IQ2_M, 1.0 GB"), but its head still showed
 * the size of the listed file: "1.8 GB" above a verdict for 1.0 GB
 * (acceptance Android 8 GB, N1 and B17). The size in the head is now the size
 * of the file the verdict is about. Name and marks are the model's, as in the
 * list "Installed".
 */
export function cardOfCatalogWith(model: MobileModel, packing: CardPacking | undefined): CardModel {
  const card = cardOfCatalog(model)
  return packing ? { ...card, sizeText: packing.sizeText, quant: packing.quant || card.quant, tools: toolsInPacking(model, packing.quant || card.quant) } : card
}

/**
 * The models of the catalogue with a download that is not finished: running, paused, waiting for
 * the network, failed. Without internet "Get new" has no catalogue to show, but a download that
 * was started there must stay where the user left it, with its progress and its buttons
 * (acceptance Android buttons, N2).
 */
export function modelsInFlight<M extends { filename: string; id?: string }>(models: readonly M[], rows: Readonly<Record<string, { status: string } | undefined>>): M[] {
  return models.filter((model) => {
    const row = rows[model.filename]
    // The download of another packing of the model counts as well: its card shows it (G11).
    return (!!row && row.status !== 'complete') || (model.id !== undefined && packingInFlight({ id: model.id, filename: model.filename }, rows) !== '')
  })
}

/**
 * Pure: the digest the download of this file was checked against, from the
 * records of the downloads. Undefined for a file without a record (brought in
 * by hand) and for a download the source listed no digest for.
 */
export function checkedDigest(records: Readonly<Record<string, { sha256?: string } | undefined>>, filename: string): string | undefined {
  const digest = records[filename]?.sha256?.trim()
  return digest ? digest : undefined
}
