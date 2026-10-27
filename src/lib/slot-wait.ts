// A send that waits for the one model slot, and can be stopped while it waits.
//
// On a phone a question waits until the document that is being read is done
// (lib/model-slot.ts). That can take a minute for a long file. Before round 5
// the wait had no handle: Stop found no aborter for the conversation, because
// the send registers its own only once the run starts, and did nothing.
//
// For the length of the wait this registers an aborter of its own under the
// conversation, the same register Stop already calls (generationStore). On a
// desktop the slot is always free and nothing is registered.

import { useGenerationStore } from '../stores/generationStore'
import { slotIsFree, whenSlotIdle } from './model-slot'

export type SlotWaitOutcome = 'free' | 'stopped'

export interface StopHandle {
  /** Aborts when Stop is pressed in the conversation. */
  signal: AbortSignal
  /** Take the handle away again. The aborter that was there before comes back. */
  release: () => void
}

/**
 * A Stop handle for a wait that happens before the run has registered its
 * own: the search of a chat with documents waits for the model slot here
 * (api/rag.ts). Same register and same rule as below: an aborter that is
 * already there stays, and Stop reaches this wait through it.
 */
export function stopHandleFor(conversationId: string): StopHandle {
  const wait = new AbortController()
  const stop = () => wait.abort()
  const store = useGenerationStore.getState()
  const before = store.aborters[conversationId]
  const mine = before ? () => { stop(); before() } : stop
  store.registerAborter(conversationId, mine)
  return {
    signal: wait.signal,
    release: () => {
      const now = useGenerationStore.getState()
      if (now.aborters[conversationId] !== mine) return
      if (before) now.registerAborter(conversationId, before)
      else now.clearAborter(conversationId)
    },
  }
}

export async function waitForSlotOrStop(conversationId: string): Promise<SlotWaitOutcome> {
  if (slotIsFree()) return 'free'
  const wait = new AbortController()
  const stop = () => wait.abort()
  const store = useGenerationStore.getState()
  // An aborter that is already there belongs to something that runs (a loop
  // pass, an earlier turn). It stays, and Stop reaches this wait through it.
  const before = store.aborters[conversationId]
  const mine = before ? () => { stop(); before() } : stop
  store.registerAborter(conversationId, mine)
  try {
    await whenSlotIdle(wait.signal)
  } finally {
    const now = useGenerationStore.getState()
    if (now.aborters[conversationId] === mine) {
      if (before) now.registerAborter(conversationId, before)
      else now.clearAborter(conversationId)
    }
  }
  return wait.signal.aborted ? 'stopped' : 'free'
}

const SEARCH_STOPPED = 'search_stopped'

/** What a search that was stopped while it waited for the slot ends with. */
export function searchStoppedError(): Error {
  const err = new Error('The search was stopped.')
  err.name = 'AbortError'
  return Object.assign(err, { code: SEARCH_STOPPED })
}

/** True for that error, and for nothing else: a failed search is not a stopped one. */
export function isSearchStopped(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: unknown }).code === SEARCH_STOPPED
}
