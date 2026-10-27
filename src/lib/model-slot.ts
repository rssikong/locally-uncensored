// One model slot: who may load the embedding model on a phone, and when.
//
// The desktop runs two servers side by side, the chat model on one port and
// the embedding model on another, and starts the second one whenever it can:
// on every model refresh, before every send once there are memories, at the
// end of the install. A phone has the memory for one model. An embedder that
// loads itself there takes the room the chat model needs, and the system
// kills the app.
//
// The contract on a single slot device:
//   - Nobody loads the embedder unasked. Not the model refresh, not memory,
//     not the agent's tool selection.
//   - Document Chat is the one caller that may: indexing a file the user just
//     added, and searching the documents of a chat that has them switched on.
//   - Before it loads, the fit check is asked whether the embedder has room
//     beside what is loaded. The shell injects that check from its device
//     table. Without one the answer is "unknown" and the load is tried.
//   - When it does not fit beside the chat model, the two take turns: the
//     chat model is unloaded, the embedder loads, does its work and is
//     unloaded, and the chat model is loaded again (api/rag.ts). The step is
//     published here (slotTurn) so the screen can say what is happening.
//   - When the embedder does not start even alone, the caller gets one clear
//     error (SingleSlotConflictError) instead of a transport error.
//   - After the work the embedder is unloaded again, unless the shell said
//     the device has room to keep it.
//
// On a desktop every function here answers "go ahead", so nothing changes.

import { singleModelSlot } from './capabilities'

/** Why somebody wants embeddings. Only 'document-chat' may load the embedder
 *  on a single slot device. */
export type EmbedPurpose = 'document-chat' | 'memory' | 'tool-selection' | 'background'

export type EmbedderFit = 'fits' | 'no-room' | 'unknown'

/** Thrown when a caller that is not Document Chat asks for embeddings on a
 *  single slot device. Callers with a keyword fallback catch it and use that. */
export class EmbedderNotAllowedError extends Error {
  readonly code = 'embedder_not_allowed'
  constructor(purpose: EmbedPurpose) {
    super(`The embedding model is not loaded for "${purpose}" on this device.`)
    this.name = 'EmbedderNotAllowedError'
  }
}

/** Thrown when Document Chat needs the embedder and it cannot be loaded
 *  beside the chat model, or not at all (memory, or its port taken). The
 *  message is written for the user. */
export class SingleSlotConflictError extends Error {
  readonly code = 'single_slot_conflict'
  constructor(message: string = SINGLE_SLOT_CONFLICT_MESSAGE) {
    super(message)
    this.name = 'SingleSlotConflictError'
  }
}

export const SINGLE_SLOT_CONFLICT_MESSAGE =
  'This device cannot hold the chat model and the document reader at the same time. '
  + 'Switch this chat to LU Cloud or pick a smaller chat model, then add the file or send the message again.'

/** The embedder did not start even with the chat model unloaded. Memory is
 *  the true reason, so the sentence says memory and names what helps. */
export const EMBEDDER_NO_ROOM_ALONE_MESSAGE =
  'This device does not have enough free memory to read documents right now, even with the chat model unloaded. '
  + 'Close other apps and add the file or send the message again, or switch this chat to LU Cloud.'

/** The document reader did not start because its local port is held by
 *  something else. Unloading the chat model frees no port, and closing apps
 *  is the wrong advice, so this sentence says what happened instead
 *  (iOS check of package 17, N-1). */
export const EMBEDDER_PORT_BUSY_MESSAGE =
  'LU could not start the document reader (its local port is busy). Restart LU and try again.'

/**
 * Did the document reader fail to start because its local port is held by
 * somebody else? The words come from the shell (engine.rs, engine_inproc.rs):
 * "could not open the local port 8128: address already in use (os error 48)",
 * or "could not open a local port" when every port of its walk was taken.
 */
export function isEmbedPortBusy(reason: string | null | undefined): boolean {
  return !!reason && /address already in use|could not open (?:the|a) local port|os error (?:48|98|10048)\b|AddrInUse/i.test(reason)
}

export const NO_EMBED_MODEL_MOBILE_MESSAGE =
  'The document reader is not installed yet. Open Documents in this chat and tap Download (84 MB), then add the file again.'

export function isSingleSlotConflict(err: unknown): err is SingleSlotConflictError {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'single_slot_conflict'
}

export function isEmbedderNotAllowed(err: unknown): err is EmbedderNotAllowedError {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === 'embedder_not_allowed'
}

/** May a caller with this purpose cause the embedder to load? Always on a
 *  desktop. On a single slot device only Document Chat. */
export function embedderMayLoad(purpose: EmbedPurpose): boolean {
  return !singleModelSlot() || purpose === 'document-chat'
}

type FitCheck = () => EmbedderFit | Promise<EmbedderFit>

let fitCheck: FitCheck = () => 'unknown'
let keepLoaded = false

/**
 * Seam for the mobile shell: how to tell whether the embedder fits beside the
 * chat model that is loaded right now. The shell knows the device's memory
 * and the size of the loaded model (src/mobile/lib/device-fit.ts). Pass null
 * to go back to the default, which answers 'unknown'.
 */
export function setEmbedderFitCheck(check: FitCheck | null): void {
  fitCheck = check ?? (() => 'unknown')
}

/** Ask the injected check. Never throws: a check that fails is 'unknown'. */
export async function embedderFit(): Promise<EmbedderFit> {
  try {
    return await fitCheck()
  } catch {
    return 'unknown'
  }
}

/**
 * Seam for the mobile shell: a device with room to spare may keep the
 * embedder loaded between uses. Default false, so every use gives the memory
 * back. No effect on a desktop, where the embedder always stays.
 */
export function setMobileEmbedderKeepLoaded(keep: boolean): void {
  keepLoaded = keep
}

/** Should the embedder be unloaded after this use? Never on a desktop. */
export function embedderReleasesAfterUse(): boolean {
  return singleModelSlot() && !keepLoaded
}

/**
 * How far an agent run may raise the context of the local engine on a phone.
 *
 * On a desktop the agent restarts the engine with up to 32768 tokens of
 * context when the model was trained for it (api/builtin-ensure.ts). The KV
 * cache for that is memory a phone does not have, and the restart itself
 * unloads and reloads the one model in the slot.
 *
 * 0 means "do not raise at all": the engine keeps the context it was started
 * with. That is the default until the shell knows the device.
 */
export const DEFAULT_MOBILE_CONTEXT_CAP = 0

let mobileContextCap = DEFAULT_MOBILE_CONTEXT_CAP

/**
 * Seam for the mobile shell (src/mobile/lib/device-fit.ts supplies the
 * number): the largest context, in tokens, an agent run may restart the
 * engine with on this device. 0 or less switches the raise off. No effect on
 * a desktop.
 */
export function setMobileContextCap(tokens: number): void {
  mobileContextCap = Number.isFinite(tokens) && tokens > 0 ? Math.floor(tokens) : 0
}

export function getMobileContextCap(): number {
  return mobileContextCap
}

/**
 * Taking turns in the one slot. 'idle' almost always. While Document Chat
 * borrows the slot from the chat model the step is one of:
 *   'unloading-chat'  the chat model is being unloaded
 *   'reading'         the document model is loaded and at work
 *   'reloading-chat'  the document model is gone, the chat model loads again
 */
export type SlotTurn = 'idle' | 'unloading-chat' | 'reading' | 'reloading-chat'

let slotTurn: SlotTurn = 'idle'
const slotTurnListeners = new Set<() => void>()
let slotIdleWaiters: Array<() => void> = []

/**
 * A document that is being read, from its first passage to its last. Wider
 * than the turn above: a phone with room for both models never borrows the
 * slot, and its reading still must not be cut by a send. Before round 5 a
 * send in that state searched the documents, gave the embedder back when it
 * was done and so stopped it under the reading that was still using it. The
 * file then failed with "Embedding failed (HTTP 500)" and was gone (N1).
 *
 *   'waiting-for-answer'  the reading waits until the answer that is being
 *                         written is finished, so the chat model is not
 *                         unloaded under it
 *   'waiting-for-model'   the reading waits until the chat model that is
 *                         being loaded is in memory (round 6, see below)
 *   'reading'             passages are being embedded
 */
export type DocumentJobState = 'none' | 'waiting-for-answer' | 'waiting-for-model' | 'reading'

let documentJobs = 0
let documentJobsWaiting = 0
/**
 * Searches that hold the slot (api/rag.ts, retrieveContext). A search may
 * unload the chat model for the length of one question, so from its first
 * step to its last a send must wait, exactly as for a reading. Counted apart
 * from the readings because the screen says "reading a document" for those
 * and nothing for a search.
 */
let searchJobs = 0

/**
 * Chat model loads that are running on a single slot device, counted from
 * the moment the slot was free for them until the engine answered.
 *
 * WHY (acceptance on Android 8 GB, B4): a question during a reading ended
 * twice in "The model did not finish loading within 120 seconds". The limit
 * belongs to the engine and starts when the engine is asked to load. Two
 * things kept a load inside that limit from finishing: it was asked for while
 * the document model was busy on every core, and a reading began while a
 * load was still running. The first is closed by waiting for the slot BEFORE
 * the engine is asked (api/builtin-ensure.ts, so the limit only runs once the
 * slot is free). This counter closes the second: a reading does not start
 * under a load (api/rag.ts).
 */
let chatModelLoads = 0

function notifySlot(): void {
  for (const listener of [...slotTurnListeners]) {
    try { listener() } catch { /* a listener must not break the turn */ }
  }
}

function slotFree(): boolean {
  return slotTurn === 'idle' && documentJobs === 0 && searchJobs === 0
}

function releaseSlotWaiters(): void {
  if (!slotFree() || slotIdleWaiters.length === 0) return
  const waiters = slotIdleWaiters
  slotIdleWaiters = []
  for (const done of waiters) done()
}

export function getSlotTurn(): SlotTurn {
  return slotTurn
}

/** Written by api/rag.ts only. */
export function setSlotTurn(next: SlotTurn): void {
  if (next === slotTurn) return
  slotTurn = next
  notifySlot()
  releaseSlotWaiters()
}

export function getDocumentJobState(): DocumentJobState {
  if (documentJobs > 0) return 'reading'
  if (documentJobsWaiting === 0) return 'none'
  return chatModelLoads > 0 ? 'waiting-for-model' : 'waiting-for-answer'
}

/**
 * A chat model load starts on a single slot device. Call it only once the
 * slot is free (`claimSlotForChatLoad` does both in one step). The returned
 * function ends it and may be called more than once. No effect on a desktop:
 * nobody calls it there.
 */
export function beginChatModelLoad(): () => void {
  chatModelLoads += 1
  notifySlot()
  let open = true
  return () => {
    if (!open) return
    open = false
    chatModelLoads = Math.max(0, chatModelLoads - 1)
    notifySlot()
  }
}

/** Is a chat model being loaded right now (single slot devices)? */
export function chatModelLoading(): boolean {
  return chatModelLoads > 0
}

/**
 * Wait until the slot is free, then mark a chat model load, with nothing in
 * between: a reading that asks at that moment sees the load and waits for it.
 * Resolves with the function that ends the load.
 */
export async function claimSlotForChatLoad(): Promise<() => void> {
  // A reading may begin in the tick between the wait and this line. Ask again until it is free here and now.
  while (!slotFree()) await whenSlotIdle()
  return beginChatModelLoad()
}

/**
 * A reading starts (api/rag.ts, indexDocument, single slot devices only).
 * From here until the returned function is called, whenSlotIdle does not
 * resolve: a send waits for the document instead of answering without it.
 * The returned function may be called more than once.
 */
export function beginDocumentJob(): () => void {
  documentJobs += 1
  notifySlot()
  let open = true
  return () => {
    if (!open) return
    open = false
    documentJobs = Math.max(0, documentJobs - 1)
    notifySlot()
    releaseSlotWaiters()
  }
}

/**
 * A search starts (api/rag.ts, retrieveContext, single slot devices only).
 * From here until the returned function is called, whenSlotIdle does not
 * resolve: a send that starts now waits until the search has given the chat
 * model back, instead of being written by a model the search unloads under
 * it. The returned function may be called more than once.
 */
export function beginSearchJob(): () => void {
  searchJobs += 1
  notifySlot()
  let open = true
  return () => {
    if (!open) return
    open = false
    searchJobs = Math.max(0, searchJobs - 1)
    notifySlot()
    releaseSlotWaiters()
  }
}

/** Is a document being read right now? */
export function documentJobRunning(): boolean {
  return documentJobs > 0
}

/** A reading that has not started yet because an answer is still being written. */
export function markDocumentJobWaiting(waiting: boolean): void {
  documentJobsWaiting = Math.max(0, documentJobsWaiting + (waiting ? 1 : -1))
  notifySlot()
}

/** For useSyncExternalStore. Fires for the turn and for the document job. */
export function subscribeSlotTurn(listener: () => void): () => void {
  slotTurnListeners.add(listener)
  return () => { slotTurnListeners.delete(listener) }
}

/**
 * Resolves once nobody borrows the slot and no document is being read. A
 * send that starts during a reading waits here, so it neither loads the chat
 * model next to the document model nor answers without the document.
 * Resolves at once on a desktop and whenever the slot is free.
 *
 * With a signal the wait also ends when the signal aborts (Stop). It resolves
 * either way: the caller reads signal.aborted to tell the two apart.
 */
export function whenSlotIdle(signal?: AbortSignal): Promise<void> {
  if (slotFree() || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      signal?.removeEventListener('abort', stopped)
      resolve()
    }
    const stopped = () => {
      slotIdleWaiters = slotIdleWaiters.filter((w) => w !== done)
      resolve()
    }
    slotIdleWaiters.push(done)
    signal?.addEventListener('abort', stopped, { once: true })
  })
}

/**
 * Resolves once no document is being read. For a search (api/rag.ts): it
 * waits for a reading, not for a turn, because the search takes a turn itself.
 */
export function whenNoDocumentJob(): Promise<void> {
  if (documentJobs === 0) return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => {
      if (documentJobs > 0) return
      slotTurnListeners.delete(check)
      resolve()
    }
    slotTurnListeners.add(check)
  })
}

/** Is the slot free right now (nobody borrows it, no document is being read)? */
export function slotIsFree(): boolean {
  return slotFree()
}

/** Test-only. */
export function __resetModelSlotForTests(): void {
  fitCheck = () => 'unknown'
  keepLoaded = false
  mobileContextCap = DEFAULT_MOBILE_CONTEXT_CAP
  slotTurn = 'idle'
  documentJobs = 0
  documentJobsWaiting = 0
  chatModelLoads = 0
  searchJobs = 0
  slotTurnListeners.clear()
  slotIdleWaiters = []
}
