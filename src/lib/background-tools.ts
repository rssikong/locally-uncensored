/**
 * Long generations from the chat go on in the background (3.0.8, A2).
 *
 * .molot (Discord, 20.10.2026): when the model starts a video, the chat is
 * blocked until the video is done. A local video takes minutes, on a slow card
 * half an hour, and the whole time the turn waited inside the tool call.
 *
 * What happens now, for image_generate and video_generate:
 *
 *  1. The call starts as before and the turn waits for it, but only
 *     `BACKGROUND_GRACE_MS`. A quick picture, a cached result, an error, a
 *     model pick that is answered at once: all of that comes back inside the
 *     window and the turn goes on exactly as before 3.0.8, the vision feedback
 *     of a picture included.
 *  2. Still running after the window: the call is handed to the job list
 *     (stores/backgroundJobStore.ts) and the model gets `startedResult()` as
 *     the call's result: a job id and the instruction to say in one sentence
 *     that it is rendering. The turn ends, the chat is free.
 *  3. When the job is done, two things happen:
 *     - the call's own block in the message that started it gets the result,
 *       so the picture or video appears where the call is, however far the
 *       chat has moved on (`patchToolCallInMessages`),
 *     - a hidden note goes to the end of the conversation
 *       (`finishedNote()`), so the model knows on the next turn that it is
 *       done and what the file is called (for "now animate it").
 *
 * What happens to the result in the history, the question of the order: the
 * call's tool message keeps saying "started in the background". It is never
 * rewritten. A rewrite in the middle of the history would cost every local
 * model its prompt cache from that point on, and an upstream with strict
 * caching the same. The finish is an event of its own, appended where the
 * conversation stands when it lands, as hidden user material (the only role
 * every template and every provider takes there, lib/agent-task-report.ts has
 * the reasons). The model reads it with the next message the user writes.
 *
 * The turn's Stop still cancels the call while the turn waits for it. Once it
 * runs in the background it has its own Stop, on its block; a Stop of a LATER
 * turn in the same chat must not reach it (the generation is owned by the job,
 * not by the conversation, see `generationOwnerFor`).
 */

import type { AgentBlock, AgentToolCall, BackgroundToolState } from '../types/agent-mode'

/** The tools whose calls may go on in the background. */
export const BACKGROUND_TOOLS: ReadonlySet<string> = new Set(['image_generate', 'video_generate'])

/**
 * How long a turn waits for a generation before it lets it go on in the
 * background. Long enough for a turbo picture and for every early error
 * (no model installed, ComfyUI down), short enough that a video never holds
 * the chat for long.
 */
export const BACKGROUND_GRACE_MS = 20_000

let graceOverride: number | null = null

/** The window in force: BACKGROUND_GRACE_MS, or what a test set. */
export function backgroundGraceMs(): number {
  return graceOverride ?? BACKGROUND_GRACE_MS
}

/** Test-only: a shorter window, so a test does not wait 20 s. null resets. */
export function __setBackgroundGraceMsForTests(ms: number | null): void {
  graceOverride = ms
}

/** First line of the result the model gets for a call that went on in the background. */
export const BACKGROUND_STARTED_PREFIX = '[Background job '

/** First line of the hidden note that tells the model a job is done. */
export const BACKGROUND_FINISHED_PREFIX = '[Background job finished]'

export function mayRunInBackground(toolName: string, settings: { backgroundMediaTools?: boolean } | null | undefined): boolean {
  return settings?.backgroundMediaTools !== false && BACKGROUND_TOOLS.has(toolName)
}

/** Short job id, readable in a sentence. */
export function newJobId(): string {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `bg-${rnd}`
}

/**
 * Who owns the generation in vram-handoff while it runs. Not the conversation:
 * a Stop in that conversation cancels every generation the conversation owns,
 * and a call that went on in the background is no longer the turn's.
 */
export function generationOwnerFor(toolCallId: string): string {
  return `bg:${toolCallId}`
}

function kindOf(toolName: string): 'video' | 'image' {
  return toolName === 'video_generate' ? 'video' : 'image'
}

/** The call's result for the model, the moment it goes on in the background. */
export function startedResult(toolName: string, jobId: string): string {
  const kind = kindOf(toolName)
  return `${BACKGROUND_STARTED_PREFIX}${jobId} started] The ${kind} is still rendering and now continues in the background. `
    + `It will appear by itself in this message when it is done, and you will get a note then. `
    + `Tell the user in one short sentence, in their language, that the ${kind} is rendering and that they can keep chatting meanwhile. `
    + `Do not call ${toolName} again for it, do not wait for it, and do not say it is finished.`
}

export function isStartedResult(result: string | undefined | null): boolean {
  return typeof result === 'string' && result.startsWith(BACKGROUND_STARTED_PREFIX) && !result.startsWith(BACKGROUND_FINISHED_PREFIX)
}

/** The job id inside a started result, or null. */
export function jobIdOfStartedResult(result: string | undefined | null): string | null {
  if (!isStartedResult(result)) return null
  const m = /^\[Background job (\S+) started\]/.exec(result as string)
  return m ? m[1] : null
}

export type FinishedState = Exclude<BackgroundToolState['state'], 'running'>

/** The hidden note for the model when a job is over. */
export function finishedNote(toolName: string, jobId: string, state: FinishedState, result: string): string {
  const kind = kindOf(toolName)
  const head = `${BACKGROUND_FINISHED_PREFIX} Job ${jobId} (${toolName})`
  if (state === 'done') {
    return `${head} is done. The ${kind} now shows in the message where you started it, the user can see it. Result:\n${result}\n`
      + `Do not generate it again. If the user asks about it, it is this file.`
  }
  if (state === 'cancelled') {
    return `${head} was stopped by the user. Nothing was delivered. Start it again only if the user asks.`
  }
  if (state === 'interrupted') {
    return `${head} did not finish: the app was closed while it rendered. Nothing was delivered. Start it again only if the user asks.`
  }
  return `${head} failed. Nothing was delivered. What it reported:\n${result}\nStart it again only if the user asks.`
}

/** The line in the block while a job runs. */
export function backgroundLabel(toolName: string): string {
  return `Rendering in the background: ${toolName}`
}

/** Whether a block holds the call. */
function blockHasCall(block: AgentBlock, toolCallId: string): boolean {
  if (block.toolCall?.id === toolCallId) return true
  return (block.toolCalls ?? []).some((c) => c.id === toolCallId)
}

/**
 * The messages with the call patched, or null when no message holds it (the
 * chat was deleted, or the message edited away). Both shapes of the block are
 * written: after a persist round-trip they are separate objects, and the chat
 * draws the legacy one (chatStore's migration has the details).
 */
export function patchToolCallInMessages<M extends { agentBlocks?: AgentBlock[] }>(
  messages: readonly M[],
  toolCallId: string,
  patch: (call: AgentToolCall) => AgentToolCall,
  content?: string,
): M[] | null {
  let found = false
  const next = messages.map((m) => {
    if (!m.agentBlocks?.some((b) => blockHasCall(b, toolCallId))) return m
    found = true
    return {
      ...m,
      agentBlocks: m.agentBlocks.map((b) => {
        if (!blockHasCall(b, toolCallId)) return b
        const one = b.toolCall?.id === toolCallId ? patch(b.toolCall) : b.toolCall
        const many = b.toolCalls?.map((c) => (c.id === toolCallId ? patch(c) : c))
        return {
          ...b,
          ...(one ? { toolCall: one } : {}),
          ...(many ? { toolCalls: many } : {}),
          ...(content !== undefined ? { content } : {}),
        }
      }),
    }
  })
  return found ? next : null
}

/**
 * A block persisted while its job was running. The job lived in this window
 * only, so after a restart nobody is going to finish it: say so on the block
 * instead of a spinner that turns forever. Mutates in place (persist migration).
 * Returns true when it changed something.
 */
export function markStaleBackgroundCallOnBlock(block: AgentBlock): boolean {
  let changed = false
  const fix = (c: AgentToolCall | undefined) => {
    if (!c?.background || c.background.state !== 'running') return
    c.background = { ...c.background, state: 'interrupted' }
    c.status = 'failed'
    c.error = INTERRUPTED_LINE
    changed = true
  }
  fix(block.toolCall)
  for (const c of block.toolCalls ?? []) fix(c)
  if (changed) block.content = `Failed: ${block.toolCall?.toolName ?? block.toolCalls?.[0]?.toolName ?? 'tool'}`
  return changed
}

export const INTERRUPTED_LINE = 'The app was closed while this rendered in the background, so it was not finished here.'

const GRACE_OVER = Symbol('grace-over')

export interface GraceRun {
  graceMs: number
  /** The turn's Stop. Reaches the call only while the turn waits for it. */
  turnSignal?: AbortSignal
  /** Starts the call under the job's own signal. */
  start: (jobSignal: AbortSignal) => Promise<string>
  /** Cancels the generation in vram-handoff (by its own owner). */
  cancelGeneration: () => void
  /**
   * The call is still running when the window closes: hand it over and give
   * back what the model reads as the call's result.
   */
  onDetach: (work: Promise<string>, stop: () => void) => string
}

/**
 * Wait for the call up to `graceMs`; what comes back in time is the call's
 * result, as before. After that, the call is handed over (`onDetach`) and the
 * turn gets the started result. A rejection inside the window rejects as it
 * always did; after the hand-over it is the job's to report.
 */
export async function runWithBackgroundGrace(opts: GraceRun): Promise<string> {
  const job = new AbortController()
  const stop = () => {
    if (!job.signal.aborted) job.abort()
    opts.cancelGeneration()
  }
  const onTurnAbort = () => stop()
  if (opts.turnSignal?.aborted) stop()
  else opts.turnSignal?.addEventListener('abort', onTurnAbort, { once: true })
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const work = opts.start(job.signal)
    const grace = new Promise<typeof GRACE_OVER>((resolve) => { timer = setTimeout(() => resolve(GRACE_OVER), opts.graceMs) })
    const first = await Promise.race([work, grace])
    if (first !== GRACE_OVER) return first
    // A Stop that arrived in the very same tick as the window closing still
    // counts as the turn's: nothing is handed over that was just cancelled.
    if (opts.turnSignal?.aborted) return work
    opts.turnSignal?.removeEventListener('abort', onTurnAbort)
    return opts.onDetach(work, stop)
  } finally {
    clearTimeout(timer)
    opts.turnSignal?.removeEventListener('abort', onTurnAbort)
  }
}
