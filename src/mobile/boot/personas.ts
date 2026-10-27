/**
 * A store build never works with a persona it does not list
 * (policy/personas.ts): one that an earlier build left active, or that a
 * backup brings in, is swapped for the default persona. The list in the
 * settings store is not changed.
 *
 * The same holds for the personas of a stored group chat (`groupPersonas`,
 * one pick per model): a pick this build does not list is taken away, and
 * that model follows the persona setting of the chat again, which is what a
 * group did before the picks existed. Before round 7 nobody looked at these
 * (review of round 6, finding 8).
 */
import { useChatStore } from '../../stores/chatStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { allowedActivePersona } from '../policy/personas'
import { storePolicy } from '../policy/storePolicy'

/** Pure: the models of a group whose persona pick this build does not list. */
export function unlistedGroupPersonaPicks(picks: Readonly<Record<string, string>> | undefined): string[] {
  if (!picks) return []
  return Object.keys(picks).filter((model) => allowedActivePersona(picks[model]) !== picks[model])
}

/** The picks of all chats as one string: cheap to compare, changes only when a pick does. */
function pickKey(): string {
  let key = ''
  for (const c of useChatStore.getState().conversations) {
    if (c.groupPersonas) key += `${c.id}:${JSON.stringify(c.groupPersonas)};`
  }
  return key
}

let enforcing = false

export function enforcePersonaPolicy(): void {
  // Nothing to hold where the build lists every built in persona.
  const policy = storePolicy()
  if (policy.unfilteredPersonas && policy.realPersonPersonas) return
  const check = () => {
    if (enforcing) return
    enforcing = true
    try {
      const state = useSettingsStore.getState()
      const allowed = allowedActivePersona(state.activePersonaId)
      if (allowed !== state.activePersonaId) state.setActivePersona(allowed)

      const chats = useChatStore.getState()
      for (const conversation of chats.conversations) {
        for (const model of unlistedGroupPersonaPicks(conversation.groupPersonas)) {
          chats.setGroupPersona(conversation.id, model, null)
        }
      }
    } finally {
      enforcing = false
    }
  }
  check()
  useSettingsStore.subscribe(check)
  // A chat store writes with every token of an answer. Only a change of a
  // pick can matter here, so nothing else is looked at.
  let picks = pickKey()
  useChatStore.subscribe(() => {
    const now = pickKey()
    if (now === picks) return
    picks = now
    check()
    picks = pickKey()
  })
}
