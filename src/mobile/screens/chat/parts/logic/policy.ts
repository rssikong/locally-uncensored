/**
 * Pure parts of the store duties in the chat: what a report carries, when the
 * cloud consent is due and which wording a purchase hint gets.
 */
import type { Message } from '../../../../../types/chat'
import { cloudModelListed, cloudModelShown, cloudModelsShown, unfilteredMarksShown, type UnfilteredSwitches } from '../../../../policy/unfiltered'

/** The store switch `purchase`. 'in-app' (round 17, in no preset) reads like 'none' here: no link and no other place to buy. */
export type PurchaseMode = 'links' | 'text-only' | 'none' | 'in-app'

export const REPORT_EXCERPT_MAX = 500

export interface MessageReport {
  kind: 'message'
  id: string
  model: string
  source: 'local' | 'cloud'
  excerpt?: string
}

/**
 * What is handed to openReport for one answer.
 * `nameOf` turns the id of a model into the name the user sees in the app
 * (lib/model-label); the report then names the model the way the user knows it.
 */
export function reportForAnswer(
  message: Pick<Message, 'id' | 'modelId'>,
  text: string,
  cloud: boolean,
  fallbackModel = '',
  nameOf: (id: string) => string = (id) => id,
): MessageReport {
  const excerpt = text.trim().slice(0, REPORT_EXCERPT_MAX)
  const id = message.modelId || fallbackModel
  return {
    kind: 'message',
    id: message.id,
    model: id ? nameOf(id) || id : '',
    source: cloud ? 'cloud' : 'local',
    ...(excerpt ? { excerpt } : {}),
  }
}

/** Only an answer of a model can be reported, and only where the policy asks for it. */
export function canReport(role: Message['role'], reportContent: boolean): boolean {
  return reportContent && role === 'assistant'
}

export interface PurchaseHint {
  title: string
  text: string
  /** Label of the button that leads to the plans. Null: no button and no link. */
  action: string | null
}

export interface PurchaseTexts {
  title: string
  text: string
  action: string
  /** The ONE sentence a store allows about buying, without a link. It follows the neutral text. */
  textOnly: string
  neutralTitle: string
  neutralText: string
}

/**
 * links: as before. none: a neutral statement without any word about buying.
 * text-only: that same neutral statement, and after it the one sentence the
 * store allows. No other wording about plans in such a build.
 */
export function purchaseHint(mode: PurchaseMode, texts: PurchaseTexts): PurchaseHint {
  if (mode === 'links') return { title: texts.title, text: texts.text, action: texts.action }
  if (mode === 'text-only') return { title: texts.neutralTitle, text: `${texts.neutralText} ${texts.textOnly}`, action: null }
  // 'none', and 'in-app' as well: a neutral statement, no button, no pointer.
  return { title: texts.neutralTitle, text: texts.neutralText, action: null }
}

/** The filters of the Cloud model list this build offers: a build that shows no marks has no filter for them. */
export function offeredPickerFilters<F extends string>(filters: readonly F[], marksShown: boolean): F[] {
  return filters.filter((filter) => marksShown || filter !== 'marked')
}

/**
 * The rows of the Cloud model list this build offers: without the unfiltered catalogue, none that carries a mark.
 * `mark` is the one mark of a picker row (lib/model-picker.ts): the measured one or the makers' statement. Both count.
 */
export function offeredCloudRows<R extends { unfiltered?: unknown; mark?: unknown }>(rows: readonly R[], unfilteredCatalog: boolean): R[] {
  return unfilteredCatalog ? [...rows] : rows.filter((row) => !row.unfiltered && !row.mark)
}

/** What a model of the list must carry so a store build can name it. */
export interface StoreNamedModel {
  name: string
  displayName?: string
  /** The name the catalogue route itself gives the model (types/models.ts). */
  catalogName?: string
  unfiltered?: 'full' | 'partial'
  unrestricted?: boolean
  /** Set by storeCloudModels: this build shows the mark "Direct" at the model (policy/unfiltered.ts). */
  direct?: boolean
}

/**
 * The Cloud models as THIS build lists and names them (policy/unfiltered.ts).
 *
 * The app shows the models that do not refuse with their marks ("No Filter",
 * "Uncensored") and, where their makers released them that way, under their
 * real names. A store build may not advertise: its switch
 * `unfilteredMarketing` is off. Such a build writes no word of its own in
 * that place:
 *  - a model carries no mark, neither the measured one nor the statement, so
 *    there is no group head and no filter for it,
 *  - it shows the name the catalogue route itself gives (`catalogName`), the
 *    name of the web app, and stands in the group of its lineage,
 *  - a model whose shown name itself carries one of the words is shown
 *    without the word and with the mark "Direct" (`directBadge`, decided
 *    10.10.2026), and is not listed in a build that has no such mark,
 *  - a model with the mark whose name another model of the list also
 *    carries says the mark in its name ("Gemma 4 26B Direct"),
 *  - a model the list gives no name for is named by the last part of its
 *    id, read as words. The routed id itself is never shown.
 *
 * A build without the unfiltered catalogue lists no marked model at all; that
 * is decided first, on the marks the server sent.
 */
export function storeCloudModels<M extends StoreNamedModel>(models: readonly M[], policy: UnfilteredSwitches): Array<M & { direct?: boolean }> {
  const offered = models.filter((model) => cloudModelListed(model, policy))
  if (unfilteredMarksShown(policy)) return offered
  // Told apart from the other models of the list: two models never read as one (policy/unfiltered.ts).
  const names = cloudModelsShown(models, policy)
  return offered.map((model) => {
    const shown = names.get(model.name) ?? cloudModelShown(model, policy)
    const marked = model.unrestricted === true || !!model.unfiltered || !!model.catalogName
    if (!marked && !shown.direct && shown.name === model.displayName) return model
    return { ...model, displayName: shown.name, unrestricted: undefined, unfiltered: undefined, direct: shown.direct || undefined }
  })
}
