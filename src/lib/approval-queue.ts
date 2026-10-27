// Pending tool approvals, per conversation, at MODULE scope (G29b).
//
// Same lesson as agentLoopTimer in useAgentChat (audit A3): the chat view
// unmounts on a view switch, so anything the run needs after that point cannot
// live in a hook ref. The approval queue did, so a run that asked for approval
// after the switch pushed into the queue of the DEAD instance and told a
// component that no longer exists to show it. The remounted hook started with
// an empty queue, the user saw nothing to approve, and the run waited forever.
// G29 gave that user a Stop button back; this gives them the actual choice.
//
// Keyed by conversation because the queue outlives the view: a run continuing
// in one chat must never surface its approval in another chat the user has
// since opened.
//
// The FIFO itself is the older fix that must survive (Phase 5): parallel tool
// execution means several tools can ask in the same batch, and a single slot
// would be overwritten by the second asker, deadlocking the first.

import type { AgentToolCall } from '../types/agent-mode'

export interface ApprovalEntry {
  toolCall: AgentToolCall
  resolve: (approved: boolean) => void
  /** The run that asked, as its abort signal. A run's end drains only its own
   *  entries: a background sub-agent shares the conversation's queue but
   *  outlives the turn that started it. */
  owner?: AbortSignal
}

const queues = new Map<string, ApprovalEntry[]>()
const listeners = new Set<() => void>()

function notify() {
  for (const fn of listeners) fn()
}

/** Subscribe to every queue change; returns the unsubscribe function. */
export function subscribeApprovals(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** The approval a conversation is currently waiting on, if any. */
export function headApproval(convId: string | null | undefined): AgentToolCall | null {
  if (!convId) return null
  return queues.get(convId)?.[0]?.toolCall ?? null
}

/** Who answered an approval: a click at the desktop or the paired phone
 *  (shared chats, lib/remote-chats-bridge). */
export type ApprovalAnswerer = 'desktop' | 'phone'
type AnswerListener = (convId: string, toolCallId: string, approved: boolean, by: ApprovalAnswerer) => void
const answerListeners = new Set<AnswerListener>()
let answering: ApprovalAnswerer = 'desktop'

/** Hear every answer, whoever gave it; returns the unsubscribe function. */
export function subscribeApprovalAnswers(fn: AnswerListener): () => void {
  answerListeners.add(fn)
  return () => { answerListeners.delete(fn) }
}

/** The approvals a conversation waits on, oldest first. */
export function listApprovals(convId: string | null | undefined): AgentToolCall[] {
  if (!convId) return []
  return (queues.get(convId) ?? []).map((e) => e.toolCall)
}

/** The phone answers one approval by its tool call id, wherever it is in the
 *  queue. False when it is no longer waiting (the desktop was first). */
export function answerApproval(convId: string, toolCallId: string, approved: boolean, by: ApprovalAnswerer = 'phone'): boolean {
  const q = queues.get(convId)
  const entry = q?.find((e) => e.toolCall.id === toolCallId)
  if (!q || !entry) return false
  q.splice(q.indexOf(entry), 1)
  if (!q.length) queues.delete(convId)
  notify()
  const before = answering
  answering = by
  try { entry.resolve(approved) } finally { answering = before }
  return true
}

export function enqueueApproval(convId: string, entry: ApprovalEntry): void {
  // Every answer is heard once, a click or the phone's.
  const original = entry.resolve
  let answered = false
  entry.resolve = (approved: boolean) => {
    if (answered) return
    answered = true
    original(approved)
    for (const fn of answerListeners) {
      try { fn(convId, entry.toolCall.id, approved, answering) } catch { /* a listener never stops the run */ }
    }
  }
  const q = queues.get(convId)
  if (q) q.push(entry)
  else queues.set(convId, [entry])
  notify()
}

/** Take the head off and hand it back, so the caller can answer it. */
export function dequeueApproval(convId: string | null | undefined): ApprovalEntry | undefined {
  if (!convId) return undefined
  const q = queues.get(convId)
  if (!q?.length) return undefined
  const entry = q.shift()
  if (!q.length) queues.delete(convId)
  notify()
  return entry
}

/**
 * Drop one specific entry, used when its run aborts. Returns true when the
 * entry was still queued, false when a click already answered it.
 */
export function removeApproval(convId: string, entry: ApprovalEntry): boolean {
  const q = queues.get(convId)
  if (!q) return false
  const idx = q.indexOf(entry)
  if (idx < 0) return false
  q.splice(idx, 1)
  if (!q.length) queues.delete(convId)
  notify()
  return true
}

/**
 * Answer waiting tools with "no". With `owner`, only that run's entries (turn
 * end); without, the whole conversation's queue (Stop).
 *
 * The turn end used to empty the whole queue (bug hunt 01.10.2026, A8), so a
 * background sub-agent still at work was told "User rejected tool call" for a
 * question the user never saw.
 */
export function drainApprovals(convId: string | null | undefined, owner?: AbortSignal): void {
  if (!convId) return
  const q = queues.get(convId)
  if (!q) return
  const drained = owner ? q.filter((e) => e.owner === owner) : q
  const kept = owner ? q.filter((e) => e.owner !== owner) : []
  if (kept.length) queues.set(convId, kept)
  else queues.delete(convId)
  for (const entry of drained) entry.resolve(false)
  notify()
}

/** Test seam only. */
export function resetApprovals(): void {
  queues.clear()
  listeners.clear()
  answerListeners.clear()
}
