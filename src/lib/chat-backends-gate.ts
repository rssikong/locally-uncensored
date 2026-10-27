/**
 * The way a chat request asks for the chat backends a render moved out.
 *
 * A Create render takes the local chat model off the graphics card
 * (api/vram-handoff) and no longer loads it straight back, because the next
 * thing on the Create view is usually another render. The model comes back
 * when a chat needs it. The providers cannot import the hand-off module
 * (it sits on top of half the api layer), so the hand-off leaves its restore
 * here while a haul is parked, and a local provider waits for it before it
 * sends. Nothing parked: nothing to wait for.
 *
 * Why not let the backends load lazily: Ollama would, but the built-in engine
 * comes back without its saved KV slot and LM Studio without the context
 * length it was loaded with, or not at all with its own load on demand
 * switched off. The restore knows all three.
 *
 * Holds (3.0.8, A2): a generation from the chat can now go on in the
 * background while the user keeps writing. When it had to take the chat model
 * off the card, the model is not there until the render is done, and loading
 * it meanwhile would put both on one card. A hold makes the request wait for
 * that render instead, and says what it waits for, so the run can show it.
 */
let restore: (() => Promise<void>) | null = null

type HoldKind = 'image' | 'video'
interface Hold { kind: HoldKind; done: Promise<void> }
const holds = new Set<Hold>()
const listeners = new Set<() => void>()

/** Set by the hand-off while a haul is parked, null once it is back or taken over. */
export function setChatBackendsRestore(fn: (() => Promise<void>) | null): void {
  restore = fn
}

/**
 * A render has the chat model off the card until the returned release is
 * called. Called once per eviction, released once its restore is through.
 * Release is idempotent.
 */
export function holdChatBackends(kind: HoldKind): () => void {
  let release!: () => void
  const hold: Hold = { kind, done: new Promise<void>((r) => { release = r }) }
  holds.add(hold)
  notify()
  let released = false
  return () => {
    if (released) return
    released = true
    holds.delete(hold)
    release()
    notify()
  }
}

/** What a chat request would wait for right now, or null when nothing holds. */
export function chatBackendsHeldBy(): HoldKind | null {
  let kind: HoldKind | null = null
  for (const h of holds) if (!kind || h.kind === 'video') kind = h.kind
  return kind
}

/** Told whenever a hold starts or ends. Returns the unsubscribe. */
export function onChatBackendsHold(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

function notify(): void {
  for (const fn of listeners) {
    try { fn() } catch { /* a listener must not break the gate */ }
  }
}

/** Resolves when the chat backends a render moved out are loaded again. */
export async function chatBackendsBack(): Promise<void> {
  // Every hold first: a render that took the model must give it back before
  // the request may load anything. A new hold that starts while we wait is
  // waited for too.
  while (holds.size > 0) {
    await Promise.all([...holds].map((h) => h.done))
  }
  const run = restore
  if (!run) return
  try { await run() } catch { /* the request goes out either way */ }
}
