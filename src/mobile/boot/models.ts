/**
 * A store build never keeps working with a model it does not list: a marked
 * one without the unfiltered catalogue, and one whose name carries the word
 * while the build may not show the words (policy/unfiltered.ts). The pickers
 * already leave these models out (chat: storeCloudModels, Create:
 * offeredCreateModels). This file handles
 * the choice that was made before: by an earlier build, or brought in by a
 * backup or a draft.
 *
 *  - Chat: a marked LU Cloud model that is the active one is
 *    put down, and it is no longer the remembered Cloud choice. Nothing is
 *    chosen in its place: in Cloud the app never picks a chat model by
 *    itself (lib/active-model-mode.ts), the chat asks the user to choose.
 *  - Create: a chosen image or video model marked as adult falls back to the
 *    standard model of its kind. The picks of the other tools are not saved
 *    and start empty with every launch.
 *
 *  - Group chat: a stored group chat sends to the models that hang on the
 *    chat itself (`groupModels`), not to the active one. An unlisted model
 *    among them is taken out of the group, the same way the single chat
 *    loses it. A group that is left with one model is a normal chat again
 *    (fewer than two entries, types/chat.ts). Before round 7 nobody looked
 *    at these, and a group chat from an earlier build or from a backup went
 *    on answering with the unlisted model (review of round 6, finding 8).
 *
 * All of it runs at the start and again whenever a choice, a list or a chat
 * changes, the same way boot/providers.ts keeps foreign provider slots off.
 */
import type { RenderKind } from '../../lib/render/cloud-jobs'
import { useChatStore } from '../../stores/chatStore'
import { cloudModelById, cloudModelsFor, defaultCloudModel, useCloudCatalogStore } from '../../stores/cloudCatalogStore'
import { useCreateStore } from '../../stores/createStore'
import { useModelStore } from '../../stores/modelStore'
import { storePolicy } from '../policy/storePolicy'
import { cloudModelListed, unfilteredWordsShown, type UnfilteredSwitches } from '../policy/unfiltered'

interface ChatRow {
  name: string
  provider?: string
  displayName?: string
  catalogName?: string
  unfiltered?: unknown
  /** The second mark of the catalogue (lib/unfiltered-mark.ts, "statement"). */
  unrestricted?: unknown
}

/** Pure: is this the name of a LU Cloud chat model the build does not list. Unknown names are left alone: the list may not be there yet. */
export function unlistedChatModel(name: string | null, models: readonly ChatRow[], policy: UnfilteredSwitches = { unfilteredCatalog: false, unfilteredMarketing: false, unfilteredWords: false }): boolean {
  if (!name) return false
  const row = models.find((m) => m.name === name)
  if (!row || row.provider !== 'lu-cloud') return false
  // Without the catalogue every mark of the server counts, also a partial one, as before.
  if (!policy.unfilteredCatalog && (!!row.unfiltered || row.unrestricted === true)) return true
  return !cloudModelListed(row, policy)
}

/**
 * Pure: the models of a group chat this build may send to, or null when the
 * group may stay as it is. Unknown names are left alone, as above.
 */
export function listedGroupModels(group: readonly string[] | undefined, models: readonly ChatRow[], policy?: UnfilteredSwitches): string[] | null {
  if (!group || group.length === 0) return null
  const listed = group.filter((name) => !unlistedChatModel(name, models, policy))
  return listed.length === group.length ? null : listed
}

interface CreateRow {
  id: string
  adult?: boolean
}

/**
 * Pure: what a Create pick becomes in a build without adult models.
 * `picked` is the stored id, '' for "the standard model". Returns the id to
 * store, which is `picked` itself when nothing has to change.
 */
export function listedCreatePick(picked: string, standard: CreateRow | undefined, offered: readonly CreateRow[], byId: (id: string) => CreateRow | undefined): string {
  const firstListed = () => offered.find((m) => m.adult !== true)?.id ?? ''
  if (picked === '') return standard?.adult === true ? firstListed() : ''
  if (byId(picked)?.adult !== true) return picked
  return standard && standard.adult !== true ? '' : firstListed()
}

let enforcing = false

/** The groups of all chats as one string: cheap to compare, changes only when a group does. */
function groupKey(): string {
  let key = ''
  for (const c of useChatStore.getState().conversations) {
    if (c.groupModels && c.groupModels.length > 0) key += `${c.id}:${c.groupModels.join(',')};`
  }
  return key
}

export function enforceModelPolicy(): void {
  const policy = storePolicy()
  // A build that lists everything has nothing to put down.
  if (unfilteredWordsShown(policy)) return
  const check = () => {
    if (enforcing) return
    enforcing = true
    try {
      const chat = useModelStore.getState()
      if (unlistedChatModel(chat.lastCloudModel, chat.models, policy)) useModelStore.setState({ lastCloudModel: null })
      if (unlistedChatModel(chat.activeModel, chat.models, policy)) chat.setActiveModel(null)

      const chats = useChatStore.getState()
      for (const conversation of chats.conversations) {
        const listed = listedGroupModels(conversation.groupModels, chat.models, policy)
        if (listed) chats.setGroupModels(conversation.id, listed)
      }

      // Create: only a build without the unfiltered catalogue puts an adult model down. A build that only
      // shows no marks keeps listing it, without its tag.
      if (policy.unfilteredCatalog) return
      const create = useCreateStore.getState()
      const pick = (kind: RenderKind, picked: string) => listedCreatePick(picked, defaultCloudModel(kind), cloudModelsFor(kind), cloudModelById)
      const image = pick('image', create.cloudImageModel)
      if (image !== create.cloudImageModel) create.setCloudImageModel(image)
      const video = pick('video', create.cloudVideoModel)
      if (video !== create.cloudVideoModel) create.setCloudVideoModel(video)
    } finally {
      enforcing = false
    }
  }
  check()
  useModelStore.subscribe(check)
  // A chat store writes with every token of an answer. Only a change of the
  // list of chats or of a group can matter here, so nothing else is looked at.
  let groups = groupKey()
  useChatStore.subscribe(() => {
    const now = groupKey()
    if (now === groups) return
    groups = now
    check()
    groups = groupKey()
  })
  useCreateStore.subscribe(check)
  useCloudCatalogStore.subscribe(check)
}
