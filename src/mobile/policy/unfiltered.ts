/**
 * What a build may show about models that do not refuse, in one place.
 *
 * Four switches of the store policy meet here (policy/storePolicy.ts):
 *
 *   unfilteredCatalog    may such models be offered at all
 *   unfilteredMarketing  may the app advertise them: marks ("No Filter",
 *                        "Uncensored"), group heads, claims, descriptions
 *   unfilteredWords      may the words "Unfiltered" and "Abliterated" stand
 *                        as a plain designation: the name of a model, the
 *                        filter of the catalogue, the tab of the onboarding
 *   directBadge          may a LU Cloud model that is named by such a word
 *                        be listed without the word, under the mark "Direct"
 *
 * A store build shows no mark, no group head, no filter and no advertising
 * text. Decided 10.10.2026: it shows none of the words either, in no name.
 * So a LU Cloud model whose name carries one of them is shown in one of two
 * ways and never in a third:
 *
 *  - with `directBadge`: under its name without the word ("Qwen3 8B
 *    Abliterated" reads "Qwen3 8B") and with the mark "Direct". The name the
 *    server gave is not changed, only what this build draws,
 *  - without it: not listed.
 *
 * The routed id of a model ("lu-cloud::maker/model") is never a name: no
 * build shows it, and a store build does not even fall back to it.
 *
 * Every screen asks here, so the questions are answered the same way in the
 * onboarding, the catalogue, the model sheet of the chat and in Create.
 * Which names say it is not decided here: that is the one list of
 * policy/unfiltered-names.ts. Imports the switches, that list and the texts of
 * the mark, nothing else.
 */
import { POLICY } from '../strings/policy'
import { storePolicy, type StorePolicy } from './storePolicy'
import { carriesUnfilteredWord, namesUnfiltered, withoutUnfilteredWords } from './unfiltered-names'

export type UnfilteredSwitches = Pick<StorePolicy, 'unfilteredCatalog' | 'unfilteredMarketing' | 'unfilteredWords'> & Partial<Pick<StorePolicy, 'directBadge'>>

/** Marks, group heads, claims and descriptions about answers without refusals. */
export function unfilteredMarksShown(policy: UnfilteredSwitches = storePolicy()): boolean {
  return policy.unfilteredCatalog && policy.unfilteredMarketing
}

/** The words as a designation: names that carry them, the filter of the catalogue, the tab of the onboarding. */
export function unfilteredWordsShown(policy: UnfilteredSwitches = storePolicy()): boolean {
  return policy.unfilteredCatalog && (policy.unfilteredMarketing || policy.unfilteredWords)
}

/** Does this build show the mark "Direct" in place of the word: it lists such models, and it may not show the words. */
export function directMarkShown(policy: UnfilteredSwitches = storePolicy()): boolean {
  return policy.unfilteredCatalog && !unfilteredWordsShown(policy) && policy.directBadge === true
}

/** The mark, its short form for a place without room, and the one sentence a tap on it shows. */
export const DIRECT_MARK = POLICY.directMark
export const DIRECT_MARK_SHORT = POLICY.directMarkShort
export const DIRECT_SENTENCE = POLICY.directSentence

/** What a store build calls a LU Cloud model it has no name for that it may show. Never the id. */
export const UNNAMED_CLOUD_MODEL = POLICY.unnamedCloudModel

/** What a Cloud chat model must carry to be judged. */
export interface NamedCloudModel {
  /** The id the store keeps ("lu-cloud::maker/model"). */
  name: string
  displayName?: string
  /** The name the catalogue route itself gives the model (types/models.ts). */
  catalogName?: string
  /** What the server says about the model, where a list carries it. */
  description?: string
  unfiltered?: unknown
  unrestricted?: unknown
}

/** The last part of a routed id, with the separators of an id read as blanks: "lu-cloud::maker/Atlas-8B_v2" reads "Atlas 8B v2". */
function nameFromId(id: string): string {
  const bare = id.includes('::') ? id.slice(id.indexOf('::') + 2) : id
  const last = bare.split(/[\\/]/).pop() ?? bare
  return last.replace(/\.gguf$/i, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

/** The name this build shows for a Cloud chat model: the app's own, or in a store build the one of the catalogue route. */
export function cloudModelStoreName(model: NamedCloudModel, policy: UnfilteredSwitches = storePolicy()): string {
  const own = policy.unfilteredMarketing ? model.displayName : (model.catalogName ?? model.displayName)
  // Without a name the app shows the short form of the id, so that is what is judged.
  return own || model.name
}

export interface ShownName {
  /** What the build draws. */
  name: string
  /** The model carries the mark "Direct" in this build. */
  direct: boolean
}

/**
 * Pure: a name as a build that may not show the words draws it, and whether
 * the mark "Direct" stands next to it. `text` is the name a list gives;
 * `more` is what else says the same about the model (its id, its
 * description, a mark of the catalogue). Used for the models of Create too,
 * which have a label and an id.
 */
export function shownName(text: string, policy: UnfilteredSwitches = storePolicy(), more: { also?: ReadonlyArray<string | null | undefined>; marked?: boolean } = {}): ShownName {
  if (unfilteredWordsShown(policy)) return { name: text, direct: false }
  const marks = directMarkShown(policy)
  const said = carriesUnfilteredWord(text) || (more.also ?? []).some((other) => carriesUnfilteredWord(other))
  const direct = marks && (said || more.marked === true || namesUnfiltered(text))
  if (!carriesUnfilteredWord(text)) return { name: text, direct }
  // Without the mark the word is not cut out of a name: such a model is not listed, and where a name is drawn
  // anyway (an answer it gave before, a choice of an earlier build) it is the plain one.
  return { name: marks ? withoutUnfilteredWords(text) || UNNAMED_CLOUD_MODEL : UNNAMED_CLOUD_MODEL, direct }
}

/**
 * The name and the mark of a Cloud chat model in this build.
 *
 * The open build and a build without the catalogue: the name of the list, no
 * mark of this kind. A store build with the catalogue: the name without the
 * word, and "Direct" where the name, the id or the description says that the
 * model does not refuse, or where the catalogue marks it as released that
 * way (`unrestricted`). The measured mark alone (`unfiltered`) is no reason:
 * a store build shows nothing for it.
 */
export function cloudModelShown(model: NamedCloudModel, policy: UnfilteredSwitches = storePolicy()): ShownName {
  const listed = cloudModelStoreName(model, policy)
  // The id is never a name. Where the list gives none, the last part of the id is read as words.
  const text = listed === model.name ? nameFromId(model.name) : listed
  return shownName(text, policy, { also: [model.name, model.description], marked: model.unrestricted === true })
}

/** Two names that read the same to a user: case and blanks do not tell models apart. */
const sameName = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim()

/** A row of a list that is a LU Cloud chat model. Rows of this phone and of the user's own providers are named elsewhere. */
const isCloudRow = (model: NamedCloudModel & { provider?: string }) => model.provider === 'lu-cloud' || model.name.startsWith('lu-cloud::')

const shownLists = new WeakMap<ReadonlyArray<NamedCloudModel>, { key: string; names: ReadonlyMap<string, ShownName> }>()

/**
 * The names and marks of all Cloud chat models a list holds, as this build
 * shows them, told apart (keyed by the routed id).
 *
 * A name that loses its word can come out as the name of another model of
 * the same list: "Gemma 4 26B Unfiltered" next to "Gemma 4 26B". The picker
 * draws the mark next to the one, but the head of an answer, the list of
 * chats, Compare, the export and the sentence about a switch of models show
 * the name alone, and two models would read as one. So in a build with the
 * mark a model with the mark whose name another listed model also carries
 * says the mark in its name ("Gemma 4 26B Direct"). Two such models that
 * still read the same are counted, in the order of the list. A name no other
 * model carries is left as it is, and the open build is not touched at all.
 */
export function cloudModelsShown(models: ReadonlyArray<NamedCloudModel & { provider?: string }>, policy: UnfilteredSwitches = storePolicy()): ReadonlyMap<string, ShownName> {
  const key = `${policy.unfilteredCatalog}${policy.unfilteredMarketing}${policy.unfilteredWords}${policy.directBadge === true}`
  const kept = shownLists.get(models)
  if (kept && kept.key === key) return kept.names
  const names = new Map<string, ShownName>()
  for (const model of models) if (isCloudRow(model) && cloudModelListed(model, policy) && !names.has(model.name)) names.set(model.name, cloudModelShown(model, policy))
  if (directMarkShown(policy)) {
    const count = () => {
      const seen = new Map<string, number>()
      for (const shown of names.values()) seen.set(sameName(shown.name), (seen.get(sameName(shown.name)) ?? 0) + 1)
      return seen
    }
    const first = count()
    for (const [id, shown] of names) if (shown.direct && (first.get(sameName(shown.name)) ?? 0) > 1) names.set(id, { name: `${shown.name} ${DIRECT_MARK}`, direct: true })
    const taken = new Set<string>()
    for (const shown of names.values()) if (!shown.direct) taken.add(sameName(shown.name))
    for (const [id, shown] of names) {
      if (!shown.direct) continue
      let name = shown.name
      for (let n = 2; taken.has(sameName(name)); n += 1) name = `${shown.name} ${n}`
      taken.add(sameName(name))
      if (name !== shown.name) names.set(id, { name, direct: true })
    }
  }
  shownLists.set(models, { key, names })
  return names
}

/**
 * The name and the mark of one Cloud chat model, told apart from the other
 * models of its list (`cloudModelsShown`). A model that is not in the list
 * (an answer it gave before, a list that has not arrived yet) is named on
 * its own, as `cloudModelShown` does.
 */
export function cloudModelShownAmong(models: ReadonlyArray<NamedCloudModel & { provider?: string }>, model: NamedCloudModel, policy: UnfilteredSwitches = storePolicy()): ShownName {
  return cloudModelsShown(models, policy).get(model.name) ?? cloudModelShown(model, policy)
}

/**
 * Is this Cloud chat model listed in this build.
 *  - without the unfiltered catalogue: no model that carries a mark of the server, and none that its name, its id
 *    or its description says it of. A neutral name over an id with the word is still such a model,
 *  - without the words: no model whose shown name carries one of them, unless the build has the mark "Direct" for it.
 */
export function cloudModelListed(model: NamedCloudModel, policy: UnfilteredSwitches = storePolicy()): boolean {
  if (!policy.unfilteredCatalog) {
    if (model.unfiltered === 'full' || model.unrestricted === true) return false
    if (carriesUnfilteredWord(model.name) || carriesUnfilteredWord(model.description)) return false
  }
  if (unfilteredWordsShown(policy)) return true
  if (directMarkShown(policy)) return true
  return !namesUnfiltered(cloudModelStoreName(model, policy))
}

/**
 * Pure: a text the server wrote about a model, as this build may show it. A
 * store build does not show a description that carries one of the words; a
 * build with the mark says the sentence of the mark in its place.
 */
export function shownDescription(text: string | null | undefined, policy: UnfilteredSwitches = storePolicy()): string {
  if (!text) return ''
  if (unfilteredMarksShown(policy) || !carriesUnfilteredWord(text)) return text
  return directMarkShown(policy) ? DIRECT_SENTENCE : ''
}
