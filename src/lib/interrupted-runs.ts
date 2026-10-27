// What a run leaves behind when the system kills the app in the middle of it,
// and the sweep that labels it on the next start.
//
// The desktop does not need this: its process ends through pagehide, where
// every run is stopped and gets its stop mark. A phone is killed in the
// background without any event. The assistant message of that run then sits
// in the chat half written or empty, and nothing says why. Because the
// "running" flags are not persisted the app also does not know, after the
// restart, that there ever was a run.
//
// So a phone keeps a tiny ledger in localStorage: which conversations have a
// run open. It is written when a run starts and cleared when the run ends on
// its own terms. Whatever is still in it at the next start was killed, and the
// last assistant message of that conversation is marked as interrupted.
//
// localStorage and not IndexedDB on purpose: the write has to be made the
// moment the run starts, synchronously, and it is a few dozen bytes.
//
// It is not the whole truth, though. A WebView has a write to localStorage on
// the disk 0.3 to 2 seconds later, so a kill right after a run ENDED left the
// run in the ledger, and its finished answer was labelled "interrupted" (the
// agent sets no finish reason). And a kill in the first seconds of a run lost
// the entry, and the half answer got no label at all (review of round 6,
// finding 7). So beginning and end of every run are written a second time,
// through the door that waits for the disk (RunMark in
// lib/partial-answer-checkpoint.ts), and the sweep reads both:
//   - a run whose end is on the disk was not killed, whatever the ledger says,
//   - a run whose beginning is on the disk and whose end is not was killed,
//     also when the ledger lost it.

import { v4 as uuid } from 'uuid'
import { useChatStore, flushChatPersist } from '../stores/chatStore'
import { useGenerationStore } from '../stores/generationStore'
import { isMobile } from './device-kind'
import { log } from './logger'
import { onAppBackground } from './app-lifecycle'
import type { Message } from '../types/chat'
import {
  clearAllCheckpoints, createCheckpointer, diskRunMarks, openAnswerOf, readCheckpoints, repairFromCheckpoint,
  type RunMark, type RunMarkStore,
} from './partial-answer-checkpoint'

export const OPEN_RUNS_KEY = 'lu-open-runs'

/** `Message.finishReason` of a reply that a kill cut short. The shell shows
 *  its own badge for it; the desktop bubble knows only 'length' and
 *  'disconnect' and shows nothing for this value. */
export const INTERRUPTED_FINISH_REASON = 'interrupted'

/** What stands in an assistant message that was still empty when the app was
 *  killed. English, no dashes, names the next step. */
export const INTERRUPTED_EMPTY_TEXT =
  'This reply was interrupted because the app was closed before it arrived. Send your message again to get an answer.'

/** The line for a reply that has text but was cut short. The message keeps its
 *  text; the shell shows this next to the badge. */
export const INTERRUPTED_PARTIAL_NOTE =
  'This reply is incomplete because the app was closed while it was being written. Send your message again to get the full answer.'

type Ledger = Record<string, number>

function readLedger(): Ledger {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(OPEN_RUNS_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Ledger = {}
    for (const [id, at] of Object.entries(parsed)) {
      if (typeof at === 'number') out[id] = at
    }
    return out
  } catch {
    return {}
  }
}

function writeLedger(ledger: Ledger): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (Object.keys(ledger).length === 0) localStorage.removeItem(OPEN_RUNS_KEY)
    else localStorage.setItem(OPEN_RUNS_KEY, JSON.stringify(ledger))
  } catch {
    // A full localStorage costs the label after a kill, never the run.
  }
}

/** The conversations with a run open, by start time. */
export function openRunLedger(): Ledger {
  return readLedger()
}

export function noteRunOpen(conversationId: string, at: number = Date.now()): void {
  const ledger = readLedger()
  if (ledger[conversationId]) return
  ledger[conversationId] = at
  writeLedger(ledger)
}

export function noteRunClosed(conversationId: string): void {
  const ledger = readLedger()
  if (!(conversationId in ledger)) return
  delete ledger[conversationId]
  writeLedger(ledger)
}

let runMarks: RunMarkStore = diskRunMarks

/** When each run of this session began, so its end is written against the same beginning. */
const openedAt = new Map<string, number>()

/** The end of the last run mark that was handed to the disk. For tests and for the way out. */
let lastMarkWrite: Promise<void> = Promise.resolve()

function markOpen(conversationId: string, at: number): void {
  openedAt.set(conversationId, at)
  lastMarkWrite = runMarks.write(conversationId, { openedAt: at }).catch(() => undefined)
}

/** The run ended on its own terms. Written at once: this is the fact a kill must not take. */
function markClosed(conversationId: string, at: number): void {
  const began = openedAt.get(conversationId) ?? at
  openedAt.delete(conversationId)
  lastMarkWrite = runMarks.write(conversationId, { openedAt: began, closedAt: at }).catch(() => undefined)
}

/**
 * Pure: the conversations whose run a kill ended. The ledger, less the runs
 * whose end is on the disk, plus the runs whose beginning is on the disk and
 * that the ledger lost.
 */
export function killedRuns(ledger: Readonly<Record<string, number>>, marks: Readonly<Record<string, RunMark>>): string[] {
  return [
    ...Object.keys(ledger).filter((id) => !endedOnDisk(ledger[id], marks[id])),
    ...Object.keys(marks).filter((id) => !(id in ledger) && typeof marks[id].closedAt !== 'number'),
  ]
}

/**
 * Read only: the conversations a kill left with an open run, the one that
 * began last first. Changes nothing, so it may be asked before
 * `recoverInterruptedRuns` has labelled anything: the phone shell asks it at
 * start to open the chat where it happened. A kill in the first second also
 * loses the saved page of that chat (the same late write to localStorage),
 * and the app then opened an empty new chat (second check on Android, F9).
 */
export async function chatsCutByKill(): Promise<string[]> {
  const ledger = readLedger()
  const marks = await runMarks.read().catch(() => ({} as Record<string, RunMark>))
  const began = (id: string) => Math.max(ledger[id] ?? 0, marks[id]?.openedAt ?? 0)
  return killedRuns(ledger, marks).sort((a, b) => began(b) - began(a))
}

/**
 * Pure: did the run of this ledger entry end before the app died? True when
 * an end is on the disk that is not older than the beginning the ledger
 * knows. An end from an EARLIER run of the same chat says nothing about a
 * later one.
 */
export function endedOnDisk(ledgerOpenedAt: number | undefined, mark: RunMark | undefined): boolean {
  if (!mark || typeof mark.closedAt !== 'number') return false
  if (typeof ledgerOpenedAt !== 'number') return true
  return mark.closedAt >= ledgerOpenedAt
}

let untrack: (() => void) | null = null

/**
 * Keep the ledger in step with the runs. Phone only, idempotent.
 *
 * It hangs on generationStore.generating, the one flag every sending path sets
 * while a stream draws tokens (chat, agent, sub agent host), so no hook has to
 * know about the ledger.
 */
export function trackOpenRuns(): () => void {
  if (untrack) return untrack
  if (!isMobile()) return () => {}
  // The text of every running answer goes to the disk in a way that survives a hard kill
  // (lib/partial-answer-checkpoint.ts). It hangs on the same flag as the ledger.
  const checkpoints = createCheckpointer((id) => {
    const conv = useChatStore.getState().conversations.find((c) => c.id === id)
    return conv ? openAnswerOf(id, conv.messages) : null
  })
  const opened = (id: string) => {
    const at = Date.now()
    noteRunOpen(id, at)
    markOpen(id, at)
    checkpoints.open(id)
  }
  const closed = (id: string) => {
    noteRunClosed(id)
    markClosed(id, Date.now())
    checkpoints.close(id)
  }
  let seen = new Set(Object.keys(useGenerationStore.getState().generating))
  for (const id of seen) opened(id)
  const off = useGenerationStore.subscribe((state) => {
    const now = new Set(Object.keys(state.generating))
    for (const id of now) if (!seen.has(id)) opened(id)
    for (const id of seen) if (!now.has(id)) closed(id)
    seen = now
  })
  const offBackground = onAppBackground(() => { void checkpoints.saveAll() })
  untrack = () => { off(); offBackground(); checkpoints.stop(); untrack = null }
  return untrack
}

type Sweepable = { id: string; messages: ReadonlyArray<Pick<Message, 'id' | 'role' | 'content' | 'hidden' | 'timestamp' | 'finishReason' | 'error' | 'thinking' | 'agentBlocks' | 'artifacts'>> }

/**
 * Pure: the answer of the chat that was used last, when it was never begun
 * and never ended: an assistant message without a word, a thought, a step, a
 * finish reason or an error. Null when there is none.
 *
 * The chat hook puts the empty answer into the chat first and raises the
 * "running" flag after the model is ready, so a kill in between leaves this
 * message and no entry in the ledger or on the disk. The chat then said "The
 * model returned nothing", which is wrong: the app was closed (check on
 * Android with 4 GB, F2). Only the chat that was used last is looked at, a
 * kill hits what was just sent. A run of that chat whose end is on the disk
 * and is not older than the message ended on its own terms (a stop), and the
 * message is left alone.
 */
export function answerNeverBegun(conversations: readonly Sweepable[], marks: Readonly<Record<string, RunMark>>): { conversationId: string; messageId: string } | null {
  let newest: { conversationId: string; last: Sweepable['messages'][number] } | null = null
  for (const conversation of conversations) {
    const visible = conversation.messages.filter((m) => !m.hidden)
    const last = visible[visible.length - 1]
    if (!last) continue
    if (!newest || (last.timestamp ?? 0) > (newest.last.timestamp ?? 0)) newest = { conversationId: conversation.id, last }
  }
  if (!newest) return null
  const { last, conversationId } = newest
  if (last.role !== 'assistant' || last.finishReason || last.error) return null
  if (last.content.trim() !== '' || (last.thinking ?? '').trim() !== '') return null
  if ((last.agentBlocks?.length ?? 0) > 0 || (last.artifacts?.length ?? 0) > 0) return null
  const ended = marks[conversationId]?.closedAt
  if (typeof ended === 'number' && ended >= (last.timestamp ?? 0)) return null
  return { conversationId, messageId: last.id }
}

function chatStoreHydrated(): Promise<void> {
  return new Promise((resolve) => {
    try {
      if (useChatStore.persist.hasHydrated()) { resolve(); return }
      useChatStore.persist.onFinishHydration(() => resolve())
    } catch {
      resolve()
    }
  })
}

/**
 * Label what a kill left behind. Run once at start, before any new run.
 *
 * For every conversation in the ledger: when its last visible message is an
 * assistant message without a finish reason, that message was being written
 * when the app died. An empty one gets a sentence, a half written one keeps
 * its text, both get finishReason 'interrupted'. A conversation whose last
 * message is the user's gets an interrupted answer as well: the run was open
 * and the kill came before the answer had its place in the chat. Left alone,
 * the question stood there with nothing under it and nothing that said why
 * (check on Android with 4 GB, F2).
 *
 * On a phone the chat that was used last is looked at once more, for an
 * answer that was put into the chat and never begun (`answerNeverBegun`).
 *
 * Returns the ids of the messages it marked. Empty on a desktop, where the
 * ledger is never written.
 */
export async function recoverInterruptedRuns(): Promise<string[]> {
  const ledger = readLedger()
  const marks = await runMarks.read().catch(() => ({} as Record<string, RunMark>))
  const ids = killedRuns(ledger, marks)
  // Phone only: a record of a half written answer whose run left no other
  // trace, neither in the ledger nor as a mark. That is what a package from
  // before the run marks leaves behind when it is killed and then updated: its
  // ledger lives in localStorage and may not have reached the disk, and it
  // wrote no mark at all. Without this the record was thrown away unread at
  // the first start of the new version and the half answer was gone
  // (acceptance row 6.8). A run of this version always has a mark, written
  // before its first record, so nothing of today is picked up here.
  const records = isMobile() ? await readCheckpoints() : null
  for (const id of Object.keys(records ?? {})) {
    if (!(id in ledger) && !(id in marks) && !ids.includes(id)) ids.push(id)
  }
  const forget = () => {
    // Cleared either way: a ledger that could not be applied once will not be
    // applicable the next time, and it must never mark a later, healthy reply.
    const running = useGenerationStore.getState().generating
    const rest = readLedger()
    for (const id of Object.keys(ledger)) {
      if (!running[id]) delete rest[id]
    }
    writeLedger(rest)
    void runMarks.clear(Object.keys(running).filter((id) => running[id])).catch(() => {})
    // The records have done their work, or belong to chats that are gone.
    // Also when nothing was in the ledger: a record of a run the ledger lost
    // would otherwise stay for good.
    void clearAllCheckpoints()
  }
  // A desktop keeps no ledger and no marks, and is done here as it always was.
  if (ids.length === 0 && !isMobile()) {
    forget()
    return []
  }
  await chatStoreHydrated()
  const marked: string[] = []
  try {
    // The answer that was never begun, in the chat that was used last (see `answerNeverBegun`).
    if (isMobile()) {
      const running = useGenerationStore.getState().generating
      const open = answerNeverBegun(useChatStore.getState().conversations, marks)
      if (open && !running[open.conversationId] && !ids.includes(open.conversationId)) {
        useChatStore.getState().updateMessageContent(open.conversationId, open.messageId, INTERRUPTED_EMPTY_TEXT)
        useChatStore.getState().updateMessageFinishReason(open.conversationId, open.messageId, INTERRUPTED_FINISH_REASON)
        marked.push(open.messageId)
      }
    }
    if (ids.length === 0) {
      forget()
      if (marked.length > 0) void flushChatPersist().catch(() => {})
      return marked
    }
    // What was written of each answer, kept so that a hard kill could not take it
    // (lib/partial-answer-checkpoint.ts). Put back before anything is labelled.
    const checkpoints = records ?? (await readCheckpoints())
    for (const convId of ids) {
      // A run that is open right now in this very session is not a casualty.
      if (useGenerationStore.getState().generating[convId]) continue
      const before = useChatStore.getState().conversations.find((c) => c.id === convId)
      if (before) {
        const repair = repairFromCheckpoint(before.messages, checkpoints[convId])
        if (repair.kind === 'longer') {
          useChatStore.getState().updateMessageContent(convId, repair.messageId, repair.content)
          if (repair.thinking) useChatStore.getState().updateMessageThinking(convId, repair.messageId, repair.thinking)
        } else if (repair.kind === 'missing') {
          const cp = repair.checkpoint
          useChatStore.getState().addMessage(convId, {
            id: cp.messageId,
            role: 'assistant',
            content: cp.content,
            ...(cp.thinking ? { thinking: cp.thinking } : {}),
            ...(cp.modelId ? { modelId: cp.modelId } : {}),
            timestamp: cp.timestamp,
          })
        }
      }
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId)
      if (!conv) continue
      const visible = conv.messages.filter((m) => !m.hidden)
      const last = visible[visible.length - 1]
      if (last && last.role === 'user') {
        // The question was sent, the run was open, and the answer had no message yet.
        const id = uuid()
        useChatStore.getState().addMessage(convId, {
          id, role: 'assistant', content: INTERRUPTED_EMPTY_TEXT, timestamp: Date.now(), finishReason: INTERRUPTED_FINISH_REASON,
          ...(conv.model ? { modelId: conv.model } : {}),
        })
        marked.push(id)
        continue
      }
      if (!last || last.role !== 'assistant' || last.finishReason) continue
      const hasBody = last.content.trim() !== ''
        || (last.agentBlocks?.length ?? 0) > 0
        || (last.artifacts?.length ?? 0) > 0
      if (!hasBody) useChatStore.getState().updateMessageContent(convId, last.id, INTERRUPTED_EMPTY_TEXT)
      useChatStore.getState().updateMessageFinishReason(convId, last.id, INTERRUPTED_FINISH_REASON)
      marked.push(last.id)
    }
  } catch (err) {
    log.warn('[interrupted-runs] could not label the runs a kill left behind', { err: String(err) })
  }
  forget()
  if (marked.length > 0) void flushChatPersist().catch(() => {})
  return marked
}

/** Test-only. */
export function __resetInterruptedRunsForTests(): void {
  untrack?.()
  runMarks = diskRunMarks
  openedAt.clear()
  lastMarkWrite = Promise.resolve()
}

/** Test-only: where the run marks go, and when the last one was handed over. */
export function __setRunMarkStoreForTests(store: RunMarkStore | null): void {
  runMarks = store ?? diskRunMarks
}

/** Test-only. */
export function __runMarksSettled(): Promise<void> {
  return lastMarkWrite
}
