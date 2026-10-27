/**
 * An answer that stopped because the user chose another model.
 *
 * A phone runs one model. Choosing another one while an answer is being
 * written takes the engine away under it, and the stream breaks. The chat
 * then said "The model on this phone was interrupted", which sounds like a
 * fault, although the user did it (short check on the iPhone, package 8, B2).
 *
 * So the moment the chosen model changes, the answers a model on this phone
 * is writing right then are noted here, and the chat says for them what
 * happened: stopped because you switched models. Kept in the storage that is
 * written at once, so the sentence is the same after the app was closed.
 */
import { useChatStore } from '../../../../stores/chatStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { useModelStore } from '../../../../stores/modelStore'
import { isDeviceModel } from '../../../lib/model-place'

export const SWITCHED_KEY = 'lu-mobile-switched-under-answer'
/** Older notes go: a chat shows the sentence for its latest answers, not for ever. */
export const SWITCHED_MAX = 40

let known: string[] | null = null

function read(): string[] {
  if (known) return known
  try {
    const data: unknown = typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem(SWITCHED_KEY) ?? 'null')
    known = Array.isArray(data) ? data.filter((id): id is string => typeof id === 'string').slice(-SWITCHED_MAX) : []
  } catch {
    known = []
  }
  return known
}

const listeners = new Set<() => void>()
let version = 0

/** For useSyncExternalStore: the bubble of an answer that ended before the note was written must draw again. */
export function subscribeSwitchNote(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function switchNoteVersion(): number {
  return version
}

function write(ids: string[]): void {
  known = ids.slice(-SWITCHED_MAX)
  version += 1
  for (const listener of [...listeners]) listener()
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(SWITCHED_KEY, JSON.stringify(known))
  } catch {
    /* full or forbidden: the note lives as long as the app does */
  }
}

/** Pure: the answers a model on this phone is writing right now. */
export function deviceAnswersInProgress(
  generating: Record<string, boolean>,
  chats: ReadonlyArray<{ id: string; messages: ReadonlyArray<{ id: string; role: string; modelId?: string }> }>,
  onDevice: (model: string | undefined) => boolean,
): string[] {
  const out: string[] = []
  for (const chat of chats) {
    if (!generating[chat.id]) continue
    const last = chat.messages.at(-1)
    if (last && last.role === 'assistant' && onDevice(last.modelId)) out.push(last.id)
  }
  return out
}

/** Note what is being written on this phone right now as stopped by a change of model. Returns the ids. */
export function noteModelSwitch(): string[] {
  const ids = deviceAnswersInProgress(useGenerationStore.getState().generating, useChatStore.getState().conversations, (model) => isDeviceModel(model))
  if (ids.length > 0) write([...read().filter((id) => !ids.includes(id)), ...ids])
  return ids
}

/** Did this answer stop because the user chose another model. */
export function stoppedBySwitch(messageId: string): boolean {
  return read().includes(messageId)
}

/** How long apart the choice of a model and the break of the stream may come, in either order. */
export const SWITCH_WINDOW_MS = 6_000

let installed = false
let switchedAt = 0
/** Answers a model on this phone dropped just now: id -> time. Whether the user did it is told by the model change next to it. */
const recentCuts = new Map<string, number>()
const seenChats = new WeakSet<object>()

/** Pure: the ids among `cuts` that ended within the window around `at`. */
export function cutsNear(cuts: ReadonlyMap<string, number>, at: number, windowMs = SWITCH_WINDOW_MS): string[] {
  return [...cuts].filter(([, when]) => Math.abs(when - at) <= windowMs).map(([id]) => id)
}

/** Watch the chosen model from now on. A second call does nothing. */
export function installSwitchNote(): void {
  if (installed) return
  installed = true
  useModelStore.subscribe((state, before) => {
    if (state.activeModel === before.activeModel || !before.activeModel) return
    switchedAt = Date.now()
    noteModelSwitch()
    // The stream can break a moment before the choice reaches the store: that answer is already over.
    const late = cutsNear(recentCuts, switchedAt).filter((id) => !read().includes(id))
    if (late.length > 0) write([...read(), ...late])
  })
  // The other order: the answer ended on a dropped stream, and the model change follows within moments.
  useChatStore.subscribe((state, before) => {
    if (state.conversations === before.conversations) return
    for (const chat of state.conversations) {
      if (seenChats.has(chat)) continue
      seenChats.add(chat)
      const last = chat.messages.at(-1)
      if (!last || last.role !== 'assistant' || last.finishReason !== 'disconnect' || !isDeviceModel(last.modelId)) continue
      const now = Date.now()
      if (recentCuts.has(last.id)) continue
      recentCuts.set(last.id, now)
      for (const [id, when] of recentCuts) if (now - when > SWITCH_WINDOW_MS) recentCuts.delete(id)
      if (switchedAt > 0 && now - switchedAt <= SWITCH_WINDOW_MS && !read().includes(last.id)) write([...read(), last.id])
    }
  })
  // An answer that is written on (Continue) is a new run: how it ends is said by that run.
  useGenerationStore.subscribe((state, before) => {
    if (state.generating === before.generating) return
    const started = Object.keys(state.generating).filter((chat) => state.generating[chat] && !before.generating[chat])
    if (started.length === 0 || read().length === 0) return
    const again = new Set<string>()
    for (const chat of useChatStore.getState().conversations) {
      if (!started.includes(chat.id)) continue
      const last = chat.messages.at(-1)
      if (last) again.add(last.id)
    }
    if (read().some((id) => again.has(id))) write(read().filter((id) => !again.has(id)))
  })
}

/** Only for tests. */
export function __resetSwitchNoteForTests(): void {
  known = null
  switchedAt = 0
  recentCuts.clear()
}
