/**
 * What waits in the composer of a chat: the typed text, the attachments and
 * a message that is being edited. Kept outside the page, because the attach
 * sheet and the message sheet write into it from outside, and because a text
 * must survive leaving the chat and coming back.
 */
import { create } from 'zustand'
import type { ImageAttachment } from '../../../../../types/chat'
import type { ChatFileInput } from '../../../../../lib/chat-files'
import { MAX_CHAT_FILES } from '../../../../../lib/chat-files'
import { MAX_CHAT_IMAGES } from '../../../../../lib/chat-image-input'

export interface Draft {
  text: string
  images: ImageAttachment[]
  files: ChatFileInput[]
  /** Id of the user message that is being changed (C6.4), or null. */
  editing: string | null
  /** The text before the edit began, to put back on cancel. */
  textBeforeEdit: string
}

export const EMPTY_DRAFT: Draft = { text: '', images: [], files: [], editing: null, textBeforeEdit: '' }

/** The key of the draft of a chat that has no id yet. */
export const NEW_CHAT_KEY = 'new'

interface DraftState {
  drafts: Record<string, Draft>
  setText: (chat: string, text: string) => void
  addImages: (chat: string, images: ImageAttachment[]) => number
  addFiles: (chat: string, files: ChatFileInput[]) => number
  removeImage: (chat: string, index: number) => void
  removeFile: (chat: string, index: number) => void
  beginEdit: (chat: string, messageId: string, text: string) => void
  cancelEdit: (chat: string) => void
  clear: (chat: string) => void
  move: (from: string, to: string) => void
}

/** Pure: how many of `incoming` still fit under `max` next to `have`. */
export function roomFor(have: number, incoming: number, max: number): number {
  return Math.max(0, Math.min(incoming, max - have))
}

function patch(state: DraftState, chat: string, change: Partial<Draft>): Pick<DraftState, 'drafts'> {
  return { drafts: { ...state.drafts, [chat]: { ...(state.drafts[chat] ?? EMPTY_DRAFT), ...change } } }
}

export const useDraftStore = create<DraftState>((set, get) => ({
  drafts: {},
  setText: (chat, text) => set((s) => patch(s, chat, { text })),
  addImages: (chat, images) => {
    const have = get().drafts[chat]?.images ?? []
    const room = roomFor(have.length, images.length, MAX_CHAT_IMAGES)
    if (room > 0) set((s) => patch(s, chat, { images: [...have, ...images.slice(0, room)] }))
    return room
  },
  addFiles: (chat, files) => {
    const have = get().drafts[chat]?.files ?? []
    const room = roomFor(have.length, files.length, MAX_CHAT_FILES)
    if (room > 0) set((s) => patch(s, chat, { files: [...have, ...files.slice(0, room)] }))
    return room
  },
  removeImage: (chat, index) => set((s) => patch(s, chat, { images: (s.drafts[chat]?.images ?? []).filter((_, i) => i !== index) })),
  removeFile: (chat, index) => set((s) => patch(s, chat, { files: (s.drafts[chat]?.files ?? []).filter((_, i) => i !== index) })),
  beginEdit: (chat, messageId, text) =>
    set((s) => {
      const current = s.drafts[chat] ?? EMPTY_DRAFT
      return patch(s, chat, { editing: messageId, text, textBeforeEdit: current.editing ? current.textBeforeEdit : current.text })
    }),
  cancelEdit: (chat) =>
    set((s) => {
      const current = s.drafts[chat] ?? EMPTY_DRAFT
      return patch(s, chat, { editing: null, text: current.textBeforeEdit, textBeforeEdit: '' })
    }),
  clear: (chat) =>
    set((s) => {
      if (!s.drafts[chat]) return s
      const next = { ...s.drafts }
      delete next[chat]
      return { drafts: next }
    }),
  move: (from, to) =>
    set((s) => {
      const draft = s.drafts[from]
      if (!draft) return s
      const next = { ...s.drafts, [to]: draft }
      delete next[from]
      return { drafts: next }
    }),
}))

export function useDraft(chat: string): Draft {
  return useDraftStore((s) => s.drafts[chat]) ?? EMPTY_DRAFT
}

/* ---------- a send that waits for its chat page ---------- */

export interface PendingSend {
  text: string
  images?: ImageAttachment[]
  files?: ChatFileInput[]
}

/**
 * A new chat gets its id with the first send. The page is then swapped for
 * /chat/<id>, and the swapped page sends what waits here. A module map and
 * not router state: files do not survive being written to storage.
 */
const pendingSends = new Map<string, PendingSend>()

export function setPendingSend(chatId: string, send: PendingSend): void {
  pendingSends.set(chatId, send)
}

export function takePendingSend(chatId: string): PendingSend | null {
  const send = pendingSends.get(chatId) ?? null
  pendingSends.delete(chatId)
  return send
}
