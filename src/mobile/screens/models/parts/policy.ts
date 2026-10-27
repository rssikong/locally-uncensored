/**
 * What the store policy means for the models of this strand. The ONE place
 * that imports the policy; every screen asks here.
 *
 * - A build that does not list unfiltered models (`listsUnfiltered`): no
 *   model that is listed as abliterated or uncensored is offered, not as a
 *   proposal in the onboarding, not in the list, not as a search hit, not by
 *   its address. A model that is already on the phone stays usable.
 *   That is a build without the unfiltered catalogue, and also a store build
 *   that may not show the words: every such model of the phone catalogue
 *   carries the word in its name ("... Abliterated") or is found only behind
 *   the filter "Unfiltered" (policy/unfiltered.ts, acceptance Android B3).
 * - Marks and claims (`showsMarks`): the tag on a card and the sentence that
 *   says a model answers without refusals are advertising. A store build
 *   shows neither, also not on a model that is already on the phone.
 * - customModelUrl false: nothing outside the phone catalogue can be
 *   fetched. The search on Hugging Face and the other quantizations of a
 *   repository are gone.
 * - hubSearch false: the open search at the hub is gone, and with it every
 *   repository the catalogue does not list. The other quantizations of a
 *   listed repository and a file the user brings in himself stay.
 *
 * The mark of a catalogue entry is `uncensored` in data/mobile-models.ts.
 * A file from outside the catalogue has no mark, so it is read from its
 * name.
 */
import { MOBILE_CHAT_MODELS, MOBILE_EMBED_MODEL, type MobileModel } from '../../../data/mobile-models'
import type { FitDevice } from '../../../lib/device-fit'
import { namesUnfiltered, storePolicy, unfilteredMarksShown, unfilteredWordsShown, type StorePolicy as FullStorePolicy } from '../../../policy'
import { starterModels, type StarterList } from './fit'

/** The switches this strand reads, of the scaffold's policy (src/mobile/policy). */
export type StorePolicy = Pick<FullStorePolicy, 'unfilteredCatalog' | 'unfilteredMarketing' | 'unfilteredWords' | 'customModelUrl' | 'hubSearch' | 'ageGate'>

export { storePolicy }

/**
 * Is a repository or file from outside the catalogue listed as abliterated or uncensored, judged by its name.
 * The spellings are the one list of policy/unfiltered-names.ts (F10: "lorablated" was not on the list that stood here).
 */
export function isUnfilteredName(name: string): boolean {
  return namesUnfiltered(name)
}

/** Does this build list unfiltered models: in the catalogue, behind its filter, in the onboarding, as a search hit. */
export function listsUnfiltered(policy: StorePolicy): boolean {
  return unfilteredWordsShown(policy)
}

/** Does this build show the mark of such a model and the sentence that advertises it. */
export function showsMarks(policy: StorePolicy): boolean {
  return unfilteredMarksShown(policy)
}

/**
 * What a card or a detail page says about a catalogue model in this build:
 * without marks, a model that does not refuse carries no tag, and its
 * description, which says exactly that, is left out.
 */
export function shownFacts<T extends { uncensored?: boolean; description?: string }>(policy: StorePolicy, model: T): T {
  if (!model.uncensored || showsMarks(policy)) return model
  return { ...model, uncensored: false, description: undefined }
}

/** The catalogue entry of a file name, when it has one. */
function catalogEntry(filename: string): MobileModel | undefined {
  return MOBILE_CHAT_MODELS.find((m) => m.filename === filename)
}

/** The phone catalogue as this build may offer it. */
export function offeredCatalog(policy: StorePolicy, models: readonly MobileModel[] = MOBILE_CHAT_MODELS): MobileModel[] {
  return listsUnfiltered(policy) ? [...models] : models.filter((m) => !m.uncensored)
}

/**
 * The starter list of the onboarding as this build may show it. Without the
 * unfiltered catalogue there is one kind only, whatever was asked for: the
 * proposal is the one with `unfiltered: false`.
 */
export function startersFor(policy: StorePolicy, device: FitDevice | null, wantUnfiltered: boolean): StarterList {
  return starterModels(device, listsUnfiltered(policy) && wantUnfiltered, offeredCatalog(policy))
}

/** May this catalogue model be offered for download. */
export function catalogModelOffered(policy: StorePolicy, model: Pick<MobileModel, 'uncensored'>): boolean {
  return listsUnfiltered(policy) || !model.uncensored
}

/**
 * The catalogue model a file is another build of, for the lines of the detail
 * page that belong to the model and not to one file of it: where it comes
 * from and its license. The catalogue takes both from the model card of the
 * repository, and every quantization of the model lives in that repository.
 *
 * Nothing for the listed file itself (`listed` set: the page has the entry),
 * for a file the catalogue does not know, and for a model the store policy
 * does not offer.
 */
export function modelBehindFile<M extends Pick<MobileModel, 'uncensored'>>(policy: StorePolicy, listed: M | undefined, family: M | undefined): M | undefined {
  if (listed || !family) return undefined
  return catalogModelOffered(policy, family) ? family : undefined
}

/**
 * Is the open search at the model hub part of this build: the field on the
 * page Models and what it finds. Never without foreign files.
 */
export function hubSearchOffered(policy: StorePolicy): boolean {
  return policy.customModelUrl && policy.hubSearch
}

/** Is this the repository of a catalogue model this build offers. */
function listedRepo(policy: StorePolicy, repo: string): boolean {
  const wanted = repo.toLowerCase()
  return offeredCatalog(policy).some((m) => m.repo.toLowerCase() === wanted)
}

/** The repository at the hub an address fetches from, or null. */
function repoOfUrl(url: string): string | null {
  return /^https:\/\/huggingface\.co\/([\w.-]+\/[\w.-]+)\/resolve\//.exec(url)?.[1] ?? null
}

/**
 * May a repository at the hub be offered: as a search hit and as a page of
 * its own. Without the open search only a repository the catalogue lists,
 * which is where the other quantizations of a catalogue model live.
 */
export function repoOffered(policy: StorePolicy, repo: string): boolean {
  if (!policy.customModelUrl) return false
  if (!hubSearchOffered(policy) && !listedRepo(policy, repo)) return false
  return listsUnfiltered(policy) || !isUnfilteredName(repo)
}

export type DownloadVerdict = 'ok' | 'unfiltered' | 'custom'

/**
 * The last gate before a download starts, whatever screen asked: every file
 * must be allowed. Catalogue files by their mark, everything else only when
 * foreign files are allowed, without the open search only from a repository
 * of the catalogue, and then by its name.
 */
export function downloadVerdict(policy: StorePolicy, files: ReadonlyArray<{ filename: string; url: string }>): DownloadVerdict {
  for (const file of files) {
    if (file.filename === MOBILE_EMBED_MODEL.filename && file.url === MOBILE_EMBED_MODEL.downloadUrl) continue
    const known = catalogEntry(file.filename)
    if (known && known.downloadUrl === file.url) {
      if (!catalogModelOffered(policy, known)) return 'unfiltered'
      continue
    }
    if (!policy.customModelUrl) return 'custom'
    // Without the open search a foreign file comes from a repository of the catalogue, or it does not come.
    if (!hubSearchOffered(policy)) {
      const repo = repoOfUrl(file.url)
      if (!repo || !listedRepo(policy, repo)) return 'custom'
    }
    if (!listsUnfiltered(policy) && (isUnfilteredName(file.filename) || isUnfilteredName(file.url))) return 'unfiltered'
  }
  return 'ok'
}
