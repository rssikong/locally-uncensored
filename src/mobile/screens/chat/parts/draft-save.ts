/**
 * What waits in the composer survives the end of the app.
 *
 * A phone ends an app in the background without asking. Until round 2 the
 * draft lived in memory only (parts/logic/drafts.ts), so a half written
 * message and the photo next to it were gone after that.
 *
 *   text         one small record per chat in the storage of the WebView that
 *                is written at once (localStorage): the typed text and, while
 *                a message is being changed, which one and what stood in the
 *                field before. Written a moment after the last key, and at
 *                once when the app leaves the screen.
 *   attachments  images and files that are not sent yet, in a database of
 *                their own (IndexedDB keeps a File as it is). They come back
 *                a moment after the text, and only into a draft that has no
 *                attachment by then.
 *
 * A draft that is emptied is written at once, not a moment later. Sending
 * empties it, and a phone that ended the app 0.2 to 0.4 s after the tap kept
 * the question in the chat AND in the field, where the next message was typed
 * into the middle of it (short check on the iPhone, package 8, F1). And at
 * the start a draft that says what the chat already asked without an answer
 * is dropped (`dropDraftsAlreadyAsked`).
 *
 * A draft goes with its chat: deleting the chat, by any way, removes both.
 * Storage that is missing or full never breaks typing: the draft then lives
 * in memory as before.
 */
import { onAppBackground } from '../../../../lib/app-lifecycle'
import { INTERRUPTED_FINISH_REASON } from '../../../../lib/interrupted-runs'
import type { ChatFileInput } from '../../../../lib/chat-files'
import { useChatStore } from '../../../../stores/chatStore'
import type { ImageAttachment } from '../../../../types/chat'
import { EMPTY_DRAFT, useDraftStore, type Draft } from './logic/drafts'

export const DRAFT_TEXT_KEY = 'lu-mobile-chat-drafts'
export const DRAFT_DB = 'lu-mobile-chat-drafts'
const DRAFT_STORE = 'attachments'
/** How long after the last change the draft is written. */
export const DRAFT_SAVE_MS = 400
/** A text longer than this is not kept: the storage of the WebView is small. */
export const DRAFT_TEXT_MAX = 200_000

interface SavedText {
  text: string
  editing: string | null
  textBeforeEdit: string
}

interface SavedAttachments {
  images: ImageAttachment[]
  files: ChatFileInput[]
}

/** Pure: what is written for the texts. Chats with nothing typed are left out. */
export function textRecords(drafts: Record<string, Draft>): Record<string, SavedText> {
  const out: Record<string, SavedText> = {}
  for (const [chat, draft] of Object.entries(drafts)) {
    if (!draft.text && !draft.editing && !draft.textBeforeEdit) continue
    if (draft.text.length > DRAFT_TEXT_MAX || draft.textBeforeEdit.length > DRAFT_TEXT_MAX) continue
    out[chat] = { text: draft.text, editing: draft.editing, textBeforeEdit: draft.textBeforeEdit }
  }
  return out
}

/** Pure: read what was written. Anything that is not a record of texts counts as nothing. */
export function parseTextRecords(raw: string | null | undefined): Record<string, SavedText> {
  if (!raw) return {}
  try {
    const data: unknown = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const out: Record<string, SavedText> = {}
    for (const [chat, value] of Object.entries(data as Record<string, unknown>)) {
      if (!value || typeof value !== 'object') continue
      const v = value as Partial<SavedText>
      if (typeof v.text !== 'string') continue
      out[chat] = { text: v.text, editing: typeof v.editing === 'string' ? v.editing : null, textBeforeEdit: typeof v.textBeforeEdit === 'string' ? v.textBeforeEdit : '' }
    }
    return out
  } catch {
    return {}
  }
}

/* ---------- the two storages ---------- */

function readTexts(): Record<string, SavedText> {
  try {
    return typeof localStorage === 'undefined' ? {} : parseTextRecords(localStorage.getItem(DRAFT_TEXT_KEY))
  } catch {
    return {}
  }
}

function writeTexts(records: Record<string, SavedText>): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (Object.keys(records).length === 0) localStorage.removeItem(DRAFT_TEXT_KEY)
    else localStorage.setItem(DRAFT_TEXT_KEY, JSON.stringify(records))
  } catch {
    /* full or forbidden: the draft stays in memory */
  }
}

let db: Promise<IDBDatabase | null> | null = null
function openDb(): Promise<IDBDatabase | null> {
  if (db) return db
  db = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === 'undefined' || indexedDB === null) return resolve(null)
      const request = indexedDB.open(DRAFT_DB, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(DRAFT_STORE)) request.result.createObjectStore(DRAFT_STORE)
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => resolve(null)
      request.onblocked = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
  return db
}

function inStore<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | null): Promise<T | null> {
  return openDb().then(
    (database) =>
      new Promise<T | null>((resolve) => {
        if (!database) return resolve(null)
        try {
          const tx = database.transaction(DRAFT_STORE, mode)
          const request = work(tx.objectStore(DRAFT_STORE))
          tx.oncomplete = () => resolve(request ? (request.result ?? null) : null)
          tx.onerror = () => resolve(null)
          tx.onabort = () => resolve(null)
        } catch {
          resolve(null)
        }
      }),
  )
}

async function readAttachments(): Promise<Record<string, SavedAttachments>> {
  const keys = await inStore<IDBValidKey[]>('readonly', (store) => store.getAllKeys())
  const values = await inStore<unknown[]>('readonly', (store) => store.getAll())
  const out: Record<string, SavedAttachments> = {}
  if (!keys || !values || keys.length !== values.length) return out
  keys.forEach((key, i) => {
    const value = values[i] as Partial<SavedAttachments> | null
    if (typeof key !== 'string' || !value) return
    const images = Array.isArray(value.images) ? value.images.filter((image) => image && typeof image.data === 'string' && typeof image.mimeType === 'string') : []
    const files = Array.isArray(value.files) ? value.files.filter((file) => file && !!file.attachment && typeof file.attachment.name === 'string') : []
    if (images.length > 0 || files.length > 0) out[key] = { images, files }
  })
  return out
}

function writeAttachments(chat: string, draft: Draft | undefined): void {
  const images = draft?.images ?? []
  const files = draft?.files ?? []
  void inStore<unknown>('readwrite', (store) => {
    if (images.length === 0 && files.length === 0) store.delete(chat)
    else store.put({ images, files }, chat)
    return null
  })
}

/* ---------- saving ---------- */

let timer: ReturnType<typeof setTimeout> | null = null
let dirtyText = false
const dirtyAttachments = new Set<string>()

/** Write now what waits to be written. Called by the timer and when the app leaves the screen. */
export function flushDrafts(): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const drafts = useDraftStore.getState().drafts
  if (dirtyText) {
    dirtyText = false
    writeTexts(textRecords(drafts))
  }
  for (const chat of dirtyAttachments) writeAttachments(chat, drafts[chat])
  dirtyAttachments.clear()
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(flushDrafts, DRAFT_SAVE_MS)
}

/** Pure: did a draft that had a text lose all of it (sent, cleared, moved away). Typing never does that in one step worth waiting for. */
export function draftWasEmptied(now: Record<string, Draft>, before: Record<string, Draft>): boolean {
  for (const [chat, was] of Object.entries(before)) {
    if (was.text && !now[chat]?.text) return true
  }
  return false
}

function noteChange(now: Record<string, Draft>, before: Record<string, Draft>): void {
  for (const chat of new Set([...Object.keys(now), ...Object.keys(before)])) {
    const a = now[chat] ?? EMPTY_DRAFT
    const b = before[chat] ?? EMPTY_DRAFT
    if (a.text !== b.text || a.editing !== b.editing || a.textBeforeEdit !== b.textBeforeEdit) dirtyText = true
    if (a.images !== b.images || a.files !== b.files) dirtyAttachments.add(chat)
  }
  if (!dirtyText && dirtyAttachments.size === 0) return
  // A sent question must not wait in the storage as a draft: the app may be ended before the timer runs.
  if (draftWasEmptied(now, before)) flushDrafts()
  else schedule()
}

/**
 * Pure: the drafts that repeat what their chat already asked and got no
 * answer to. `chats` are the chats as the store holds them. The draft of a
 * chat is compared with that chat, the draft of "New chat" with every chat.
 * Only a question nothing came back to counts (it is the last message, or the
 * answer behind it is marked as cut or is empty): whoever types the same
 * words again under a finished answer means them.
 */
export function draftsAlreadyAsked(
  drafts: Record<string, Draft>,
  chats: ReadonlyArray<{ id: string; messages: ReadonlyArray<{ role: string; content: string; hidden?: boolean; finishReason?: string }> }>,
): string[] {
  const asked = (chat: (typeof chats)[number], text: string): boolean => {
    let at = -1
    for (let i = chat.messages.length - 1; i >= 0; i--) {
      if (chat.messages[i].role === 'user' && !chat.messages[i].hidden) {
        at = i
        break
      }
    }
    if (at < 0 || chat.messages[at].content.trim() !== text) return false
    const rest = chat.messages.slice(at + 1)
    if (rest.length === 0) return true
    return rest.length === 1 && rest[0].role === 'assistant' && (rest[0].finishReason === INTERRUPTED_FINISH_REASON || !rest[0].content.trim())
  }
  const out: string[] = []
  for (const [key, draft] of Object.entries(drafts)) {
    const text = draft.text.trim()
    if (!text || draft.editing) continue
    const own = chats.find((c) => c.id === key)
    if (own ? asked(own, text) : chats.some((c) => asked(c, text))) out.push(key)
  }
  return out
}

/**
 * Drop the drafts the chats already hold as a question without an answer.
 * Called once the chats are read at the start, and again after a question of
 * the last session was put back (lib/first-question.ts).
 */
export function dropDraftsAlreadyAsked(): string[] {
  installDraftSaving()
  const dropped = draftsAlreadyAsked(useDraftStore.getState().drafts, useChatStore.getState().conversations)
  for (const key of dropped) useDraftStore.getState().clear(key)
  if (dropped.length > 0) {
    // Whether or not the listener is up yet: this goes to the storage now.
    dirtyText = true
    for (const key of dropped) dirtyAttachments.add(key)
    flushDrafts()
  }
  return dropped
}

let installed = false
let restored: Promise<void> = Promise.resolve()

/**
 * Bring the drafts back and keep them from now on. The texts are back when
 * this returns, the attachments a moment later (`draftsRestored`). A second
 * call does nothing.
 */
export function installDraftSaving(): void {
  if (installed) return
  installed = true

  const texts = readTexts()
  if (Object.keys(texts).length > 0) {
    const current = useDraftStore.getState().drafts
    const next = { ...current }
    for (const [chat, saved] of Object.entries(texts)) {
      // What is in memory already is newer than what was written.
      if (current[chat]) continue
      next[chat] = { ...EMPTY_DRAFT, ...saved }
    }
    useDraftStore.setState({ drafts: next })
  }

  restored = readAttachments()
    .then((saved) => {
      const current = useDraftStore.getState().drafts
      const next = { ...current }
      let changed = false
      for (const [chat, attachments] of Object.entries(saved)) {
        const draft = current[chat] ?? EMPTY_DRAFT
        if (draft.images.length > 0 || draft.files.length > 0) continue
        next[chat] = { ...draft, images: attachments.images, files: attachments.files }
        changed = true
      }
      if (changed) useDraftStore.setState({ drafts: next })
    })
    .catch(() => {
      /* nothing to bring back */
    })
    .finally(() => {
      // Only now: what was just put back must not be written again as a change.
      useDraftStore.subscribe((state, before) => {
        if (state.drafts !== before.drafts) noteChange(state.drafts, before.drafts)
      })
    })

  // The text is noted from the first key on, also while the attachments are still being read.
  const offEarly = useDraftStore.subscribe((state, before) => {
    if (state.drafts === before.drafts) return
    dirtyText = true
    if (draftWasEmptied(state.drafts, before.drafts)) {
      // Only the text: the attachments of the last run are still being read, and what is written now would be less than they are.
      dirtyText = false
      writeTexts(textRecords(state.drafts))
    } else schedule()
  })
  void restored.then(offEarly)

  // The chats of the last run are read: a draft that repeats a question one of them already holds goes.
  const whenChatsAreRead = () => {
    dropDraftsAlreadyAsked()
  }
  try {
    if (useChatStore.persist.hasHydrated()) whenChatsAreRead()
    else useChatStore.persist.onFinishHydration(whenChatsAreRead)
  } catch {
    /* a store without storage (tests): nothing was read, nothing to compare */
  }

  // A chat that is deleted, by any way, takes its draft with it.
  useChatStore.subscribe((state, before) => {
    if (state.conversations === before.conversations) return
    const alive = new Set(state.conversations.map((c) => c.id))
    for (const chat of before.conversations) {
      if (!alive.has(chat.id) && useDraftStore.getState().drafts[chat.id]) useDraftStore.getState().clear(chat.id)
    }
  })

  // The system may end the app right after it left the screen: write at once.
  onAppBackground(flushDrafts)
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flushDrafts)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushDrafts()
    })
  }
}

/** Resolves when the attachments of the last run are back in their drafts. */
export function draftsRestored(): Promise<void> {
  return restored
}

/** Only for tests. */
export function __resetDraftSavingForTests(): void {
  installed = false
  if (timer) clearTimeout(timer)
  timer = null
  dirtyText = false
  dirtyAttachments.clear()
  restored = Promise.resolve()
  db = null
}
