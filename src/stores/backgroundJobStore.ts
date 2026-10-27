import { create } from 'zustand'
import { v4 as uuid } from 'uuid'
import { useChatStore } from './chatStore'
import { mediaCallSucceeded } from '../lib/media-result'
import {
  backgroundLabel,
  finishedNote,
  patchToolCallInMessages,
  type FinishedState,
} from '../lib/background-tools'
import { log } from '../lib/logger'
import {
  registerBackgroundCancel,
  forgetBackgroundCancel,
  cancelBackgroundJob,
  __resetBackgroundCancelsForTests,
} from '../lib/background-cancels'
import type { AgentToolCall } from '../types/agent-mode'

/**
 * Generations that went on in the background (3.0.8, A2). The rules are in
 * lib/background-tools.ts; this is the live half: which job runs, its Stop,
 * and what happens when it is done.
 *
 * NOT PERSISTED, for the reason agentTaskStore gives: a running job is a live
 * promise in this window. After a restart nobody finishes it, and the block
 * says so (chatStore's migration, markStaleBackgroundCallOnBlock).
 */

export interface BackgroundJob {
  jobId: string
  toolCallId: string
  toolName: string
  convId: string
  /** The assistant message whose block holds the call. */
  messageId: string
  startedAt: number
  state: 'running' | FinishedState
}

interface BackgroundJobState {
  jobs: Record<string, BackgroundJob>
  /** Jobs of one conversation that are still running. */
  runningFor: (convId: string) => BackgroundJob[]
  cancel: (jobId: string) => boolean
}

export const useBackgroundJobStore = create<BackgroundJobState>()((_set, get) => ({
  jobs: {},
  runningFor: (convId) => Object.values(get().jobs).filter((j) => j.convId === convId && j.state === 'running'),
  cancel: (jobId) => {
    const job = get().jobs[jobId]
    if (!job || job.state !== 'running') return false
    return cancelBackgroundJob(jobId)
  },
}))

// ── The message whose run is still writing ───────────────────────────
//
// A run writes its WHOLE block list into its message on every update
// (useAgentChat's addBlock/updateBlockById). A job that ends while that run is
// still going (the turn has a slow call next to it, or the model is still
// writing its sentence) would be patched in and then written over by the
// run's own copy. So the finish waits for the run: the loop says when its
// message is live and when it is done, and a finish that lands meanwhile is
// applied right after.

const liveMessages = new Set<string>()
const deferred = new Map<string, (() => void)[]>()

export function runMessageStarted(messageId: string): void {
  liveMessages.add(messageId)
}

export function runMessageEnded(messageId: string): void {
  liveMessages.delete(messageId)
  const todo = deferred.get(messageId)
  deferred.delete(messageId)
  for (const fn of todo ?? []) {
    try { fn() } catch (e) { log.warn('background_job.deferred_failed', { err: String(e) }) }
  }
}

function whenMessageIdle(messageId: string, fn: () => void): void {
  if (!liveMessages.has(messageId)) { fn(); return }
  const list = deferred.get(messageId) ?? []
  list.push(fn)
  deferred.set(messageId, list)
}

/** Test-only. */
export function __resetBackgroundJobsForTests(): void {
  __resetBackgroundCancelsForTests()
  liveMessages.clear()
  deferred.clear()
  useBackgroundJobStore.setState({ jobs: {} })
}

const CANCELLED_RE = /generation cancelled\.?\s*$/i

function stateOf(toolName: string, result: string, cancelled: boolean): FinishedState {
  if (cancelled || CANCELLED_RE.test(result)) return 'cancelled'
  return mediaCallSucceeded(toolName, result) ? 'done' : 'failed'
}

export interface DetachInput {
  jobId: string
  toolCallId: string
  toolName: string
  convId: string
  messageId: string
  startedAt: number
  /** The generation, already running. Resolves to the tool's result string. */
  work: Promise<string>
  /** Stops it: the job's own signal and the generation's owner in vram-handoff. */
  stop: () => void
}

/**
 * Hand a running call over to the job list. Returns at once; the finish
 * lands on the call's block and as a hidden note for the model.
 */
export function detachToolCall(input: DetachInput): void {
  const job: BackgroundJob = {
    jobId: input.jobId,
    toolCallId: input.toolCallId,
    toolName: input.toolName,
    convId: input.convId,
    messageId: input.messageId,
    startedAt: input.startedAt,
    state: 'running',
  }
  let cancelled = false
  registerBackgroundCancel(job.jobId, job.convId, () => {
    cancelled = true
    input.stop()
  })
  useBackgroundJobStore.setState((s) => ({ jobs: { ...s.jobs, [job.jobId]: job } }))
  log.info('background_job.started', { jobId: job.jobId, tool: job.toolName, conv: job.convId })

  input.work
    .catch((e) => `Error: ${e instanceof Error ? e.message : String(e)}`)
    .then((result) => {
      const state = stateOf(job.toolName, result, cancelled)
      forgetBackgroundCancel(job.jobId)
      useBackgroundJobStore.setState((s) => ({ jobs: { ...s.jobs, [job.jobId]: { ...job, state } } }))
      log.info('background_job.finished', { jobId: job.jobId, tool: job.toolName, state, ms: Date.now() - job.startedAt })
      whenMessageIdle(job.messageId, () => deliver(job, state, result))
    })
}

/** The finish: the block gets the result, the model gets a note. */
function deliver(job: BackgroundJob, state: FinishedState, result: string): void {
  const finishedAt = Date.now()
  if (!useChatStore.getState().conversations.some((c) => c.id === job.convId)) return // the chat was deleted meanwhile
  const ok = state === 'done'
  const label = ok
    ? `Completed: ${job.toolName}`
    : state === 'cancelled'
      ? `Stopped: ${job.toolName}`
      : `Failed: ${job.toolName}`
  const patch = (call: AgentToolCall): AgentToolCall => ({
    ...call,
    status: ok ? 'completed' : 'failed',
    result,
    ...(ok ? {} : { error: state === 'cancelled' ? 'Stopped while it rendered in the background.' : result.split('\n')[0].slice(0, 300) }),
    completedAt: finishedAt,
    duration: finishedAt - (call.startedAt ?? job.startedAt),
    background: { jobId: job.jobId, startedAt: job.startedAt, state, finishedAt },
  })
  // Read inside the update, not before it: the conversation may have moved on
  // between the job's end and now.
  useChatStore.setState((s) => ({
    conversations: s.conversations.map((c) => {
      if (c.id !== job.convId) return c
      const messages = patchToolCallInMessages(c.messages, job.toolCallId, patch, label) ?? c.messages
      return {
        ...c,
        messages: [
          ...messages,
          {
            id: uuid(),
            role: 'user' as const,
            content: finishedNote(job.toolName, job.jobId, state, result),
            hidden: true,
            timestamp: finishedAt,
          },
        ],
        updatedAt: finishedAt,
      }
    }),
  }))
}

/** The block's line while the job runs, re-exported for the loop. */
export { backgroundLabel }
