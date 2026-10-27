// The card in front of every change of an app setting from the chat (A11).
//
// Same promise bridge as codexConfirmStore: set_setting awaits a boolean, the
// store parks the resolver, the card in the tool call resolves it on click.
// Several changes wait in line, each with its own card. Stop or abort answers
// "no" and takes the card down. There is no "don't ask again": the card comes
// in Bypass too, Bypass is about files and the shell, not the app itself.

import { create } from 'zustand'

export interface SettingChangeRequest {
  id: string
  /** The tool call that waits; its card shows the question. */
  toolCallId?: string
  conversationId: string | null
  key: string
  label: string
  from: string
  to: string
  /** A side note for the card, e.g. "applies on the next engine start". */
  note?: string
}

interface Waiting {
  req: SettingChangeRequest
  resolve: (allow: boolean) => void
}

interface SettingsConfirmState {
  queue: Waiting[]
  ask: (req: SettingChangeRequest, signal?: AbortSignal) => Promise<boolean>
  answer: (id: string, allow: boolean) => void
}

export const useSettingsConfirmStore = create<SettingsConfirmState>((set, get) => ({
  queue: [],

  ask: (req, signal) =>
    new Promise<boolean>((resolve) => {
      if (signal?.aborted) {
        resolve(false)
        return
      }
      const entry: Waiting = { req, resolve }
      set({ queue: [...get().queue, entry] })
      signal?.addEventListener(
        'abort',
        () => {
          if (!get().queue.includes(entry)) return
          set({ queue: get().queue.filter((w) => w !== entry) })
          resolve(false)
        },
        { once: true },
      )
    }),

  answer: (id, allow) => {
    const entry = get().queue.find((w) => w.req.id === id)
    if (!entry) return
    set({ queue: get().queue.filter((w) => w !== entry) })
    entry.resolve(allow)
  },
}))

/** The request a tool call's card shows: its own by id, else the oldest one
 *  that names no call (a surface that does not thread the call id). */
export function pendingForCall(
  queue: readonly { req: SettingChangeRequest }[],
  toolCallId: string,
): SettingChangeRequest | null {
  return (queue.find((w) => w.req.toolCallId === toolCallId) ?? queue.find((w) => !w.req.toolCallId))?.req ?? null
}
