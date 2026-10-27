/**
 * The first question of a new chat is on the disk before the app shows it as sent.
 *
 * Finding F2 of the check on Android with 4 GB: a new chat, the app killed in
 * the first 150 ms after the tap on Send, and chat and question were gone
 * (one of three). The wait of the sending hooks (stores/chatStore.ts,
 * `questionOnDisk`) did not cover it, and could not: it starts when the hook
 * puts the question into the chat, and for a NEW chat that is late. The tap
 * creates the chat, hands the text to a map in memory, swaps the page, and
 * only the swapped page sends, after it has rendered. Until then the chat
 * was in the store but not written (its write waits for the quiet window of
 * lib/coalescedStorage.ts), and the question was nowhere but in memory, while
 * the composer was already empty.
 *
 * So the tap writes one small record first: which chat, which text, which
 * model. Only when that write has landed is the draft cleared and the page
 * swapped (`handOverFirstQuestion`). A kill before that leaves the app as the
 * user saw it, with the text still in the field. A kill after it finds the
 * record at the next start and puts chat and question back
 * (`restoreFirstQuestion`). The record is removed once the chat store has
 * written the question itself (`releaseFirstQuestion`).
 *
 * The write has a short cap. A storage that hangs never holds a send back.
 *
 * Attachments are not in the record: a photo is megabytes and a file is a
 * handle that does not survive. The record counts them, the question comes
 * back as its text, and a message without any text does not come back.
 *
 * Round 21, the rest of F2: a question into a chat that is already there
 * goes the same way (`existing`). There the tap put the question into the
 * chat at once, and its write landed milliseconds later, while the draft was
 * already cleared in memory. A kill in those milliseconds could take both.
 * Now the record lands first here too, then the field is emptied and the
 * question sent.
 */
import { v4 as uuid } from 'uuid'
import { dropPendingStorageWrite, idbStorage } from '../../lib/idbStorage'
import { INTERRUPTED_EMPTY_TEXT, INTERRUPTED_FINISH_REASON } from '../../lib/interrupted-runs'
import { log } from '../../lib/logger'
import { QUESTION_WRITE_MAX_MS, flushChatPersist, useChatStore } from '../../stores/chatStore'

export const FIRST_QUESTION_KEY = 'lu-mobile-first-question'

export interface FirstQuestion {
  chatId: string
  text: string
  model: string
  systemPrompt: string
  /** Images and files that went with it and are not kept. */
  attachments: number
  at: number
  /**
   * The chat was there before this question (round 21, the rest of F2). The
   * question then counts as written only when the chat holds a message of the
   * user from `at` on: an older question is not this one.
   */
  existing?: boolean
}

/** Pure: read a record. Anything else counts as none. */
export function parseFirstQuestion(raw: string | null | undefined): FirstQuestion | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<FirstQuestion> | null
    if (!v || typeof v !== 'object') return null
    if (typeof v.chatId !== 'string' || !v.chatId || typeof v.text !== 'string' || typeof v.model !== 'string') return null
    return {
      chatId: v.chatId,
      text: v.text,
      model: v.model,
      systemPrompt: typeof v.systemPrompt === 'string' ? v.systemPrompt : '',
      attachments: typeof v.attachments === 'number' && v.attachments > 0 ? Math.floor(v.attachments) : 0,
      at: typeof v.at === 'number' ? v.at : 0,
      ...(v.existing === true ? { existing: true } : {}),
    }
  } catch {
    return null
  }
}

/**
 * Write the record, then call `shown`: the step that makes the question look
 * sent (the draft is cleared, the page is swapped). `shown` runs exactly
 * once, after the write has landed or after `maxMs`, whichever comes first.
 * Never rejects, and a write that fails does not keep the send from going on.
 */
export function handOverFirstQuestion(question: FirstQuestion, shown: () => void, maxMs: number = QUESTION_WRITE_MAX_MS): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const go = () => {
      if (done) return
      done = true
      clearTimeout(cap)
      try {
        shown()
      } finally {
        resolve()
      }
    }
    const cap = setTimeout(go, maxMs)
    let write: unknown
    try {
      write = idbStorage.setItem(FIRST_QUESTION_KEY, JSON.stringify(question))
    } catch (err) {
      log.warn('[first-question] the record could not be written', { err: String(err) })
      go()
      return
    }
    void Promise.resolve(write).then(go, go)
  })
}

/** `since`: only a message of the user from that moment on counts (a question into a chat that has older ones). */
function hasQuestion(chatId: string, since?: number): boolean {
  const chat = useChatStore.getState().conversations.find((c) => c.id === chatId)
  return !!chat && chat.messages.some((m) => m.role === 'user' && (since === undefined || (m.timestamp ?? 0) >= since))
}

/** The index of the question in its chat: the last message of the user (from `since` on), or -1. */
function questionAt(chatId: string, since?: number): number {
  const chat = useChatStore.getState().conversations.find((c) => c.id === chatId)
  if (!chat) return -1
  for (let i = chat.messages.length - 1; i >= 0; i--) {
    const m = chat.messages[i]
    if (m.role === 'user' && !m.hidden && (since === undefined || (m.timestamp ?? 0) >= since)) return i
  }
  return -1
}

/**
 * Is the question in the chat WITH something behind it: the answer the run
 * writes into, a notice, anything. Only then does the chat on the disk tell
 * the whole story by itself (an answer that was cut is found and marked at
 * the next start). A chat that ends with the question tells nothing: killed
 * 0.3 s after the tap, one start of five showed the question and no word
 * that no answer came (short check on Android, package 8, N2). The record
 * was already gone by then, because it went as soon as the question was
 * written.
 */
function hasQuestionWithAnswer(chatId: string, since?: number): boolean {
  const at = questionAt(chatId, since)
  if (at < 0) return false
  const chat = useChatStore.getState().conversations.find((c) => c.id === chatId)
  return !!chat && at < chat.messages.length - 1
}

/**
 * Remove the record once the chat store has written the question and the
 * place of its answer. Waits for both to be in the chat (the hook puts them
 * there), then for the write of the store, then removes. Returns a function
 * that stops waiting.
 */
export function releaseFirstQuestion(chatId: string, since?: number): () => void {
  let off: (() => void) | null = null
  let stopped = false
  const settle = (): boolean => {
    if (stopped || !hasQuestionWithAnswer(chatId, since)) return false
    stopped = true
    off?.()
    // One tick later: a listener of the store hears a change before the store has handed it to its storage.
    void Promise.resolve()
      .then(() => flushChatPersist())
      .catch(() => {})
      .then(async () => {
        // Only the record of this chat: a later new chat may have written its own by now.
        const current = parseFirstQuestion(await idbStorage.getItem(FIRST_QUESTION_KEY))
        // And only this question: the next one into the same chat may have written its own.
        const thisOne = (record: FirstQuestion | null) => !!record && record.chatId === chatId && (since === undefined || record.at === since)
        // A record that never reached the disk (the phone is full) still waits to be written. It is not wanted
        // any more either: written later, nothing would remove it, and the next start would bring the question back.
        dropPendingStorageWrite(FIRST_QUESTION_KEY, (value) => thisOne(parseFirstQuestion(value)))
        if (thisOne(current)) await idbStorage.removeItem(FIRST_QUESTION_KEY)
      })
      .catch(() => {})
    return true
  }
  if (!settle()) off = useChatStore.subscribe(() => { settle() })
  return () => {
    stopped = true
    off?.()
  }
}

function chatStoreHydrated(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (useChatStore.persist.hasHydrated()) return resolve()
      useChatStore.persist.onFinishHydration(() => resolve())
    } catch {
      resolve()
    }
  })
}

/**
 * At the start of the app: a record that is still there belongs to a send the
 * last session did not get to finish. Put the chat and its question back,
 * with the note that the answer never came. Returns the id of the chat it
 * restored, or null.
 */
export async function restoreFirstQuestion(): Promise<string | null> {
  let record: FirstQuestion | null = null
  try {
    record = parseFirstQuestion(await idbStorage.getItem(FIRST_QUESTION_KEY))
  } catch {
    return null
  }
  if (!record) return null
  await chatStoreHydrated()
  let restored: string | null = null
  try {
    const known = useChatStore.getState().conversations.some((c) => c.id === record.chatId)
    // A question into a chat that was there: the chat must still be there (deleted is deleted), and the
    // question counts as written only when it is in the chat from its own moment on.
    const missing = record.existing ? known && !hasQuestion(record.chatId, record.at) : !hasQuestion(record.chatId)
    if (missing && record.text.trim()) {
      const store = useChatStore.getState()
      const active = store.activeConversationId
      let chatId = record.chatId
      if (!store.conversations.some((c) => c.id === chatId)) {
        // The store names its chats itself. The record is the only thing that knew the old id.
        chatId = store.createConversation(record.model, record.systemPrompt)
        // The app opens where it was, the restored chat stands in the list.
        useChatStore.setState({ activeConversationId: active })
      }
      useChatStore.getState().addMessage(chatId, { id: uuid(), role: 'user', content: record.text, timestamp: record.at || Date.now() })
      useChatStore.getState().addMessage(chatId, {
        id: uuid(),
        role: 'assistant',
        // Exactly this text: the notice about cut answers tells an answer that never began by it (resilience/ResumeNotice.tsx).
        content: INTERRUPTED_EMPTY_TEXT,
        timestamp: Date.now(),
        finishReason: INTERRUPTED_FINISH_REASON,
        ...(record.model ? { modelId: record.model } : {}),
      })
      restored = chatId
    } else if (!missing && record.text.trim() && known && questionAt(record.chatId, record.existing ? record.at : undefined) >= 0 && !hasQuestionWithAnswer(record.chatId, record.existing ? record.at : undefined)) {
      // The question was written and the place of its answer was not (N2): the chat ends with the question.
      // It gets the same word as a chat that lost both.
      useChatStore.getState().addMessage(record.chatId, {
        id: uuid(),
        role: 'assistant',
        content: INTERRUPTED_EMPTY_TEXT,
        timestamp: Date.now(),
        finishReason: INTERRUPTED_FINISH_REASON,
        ...(record.model ? { modelId: record.model } : {}),
      })
      restored = record.chatId
    }
    // First the chat on the disk, then the record away: never neither.
    await flushChatPersist().catch(() => {})
    await idbStorage.removeItem(FIRST_QUESTION_KEY)
  } catch (err) {
    log.warn('[first-question] the question of the last session could not be put back', { err: String(err) })
  }
  return restored
}
