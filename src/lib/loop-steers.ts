/**
 * Is this text one of the steering sentences the agent loop writes itself?
 *
 * The loop appends its own instructions to the run as `user` messages: "your
 * last round was reasoning only", "your todo list is not finished", "these
 * links came from no tool". They carry no field that tells them from what the
 * user typed, so a reader that looks for "the last user message" finds the
 * steer and takes it for the question (review of round 6, finding 2).
 *
 * The texts are read from where they are written, never copied: a sentence
 * that is reworded there is still recognised here. A sentence with a variable
 * part is recognised by what stays the same around that part.
 *
 * This list is the fallback, not the proof. The loop has more sentences than
 * the ones that have a source of their own (several are written in place in
 * hooks/useAgentChat.ts, and the loop guard builds its own). The sure way is
 * the caller saying which message the question is (`question` in
 * lib/phone-context-fit.ts), and the loop does that.
 */
import { ANKUENDIGUNG_STEER } from '../api/agents/ankuendigung'
import { planReconcileSteer } from './plan-reconcile'
import { REASONING_CONTINUE_STEER } from './reasoning-round'
import { unbackedLinksSteer } from './unbacked-links'

interface Frame {
  head: string
  tail: string
}

/** What two renderings of one sentence share at the start and at the end. */
function frameOf(a: string, b: string): Frame {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  return { head: a.slice(0, head), tail: tail > 0 ? a.slice(a.length - tail) : '' }
}

const FIXED: readonly string[] = [REASONING_CONTINUE_STEER, ANKUENDIGUNG_STEER]

const FRAMED: readonly Frame[] = [
  frameOf(
    planReconcileSteer({ done: 1, total: 2, next: 'a' }),
    planReconcileSteer({ done: 3, total: 4, next: 'b' }),
  ),
  // One link and several are worded differently, so each has its own frame.
  // The count of several links is part of the sentence, so the two samples
  // differ in it and the frame ends in front of the number.
  frameOf(unbackedLinksSteer(['https://a.example/']), unbackedLinksSteer(['https://b.example/x'])),
  frameOf(
    unbackedLinksSteer(['https://a.example/', 'https://c.example/']),
    unbackedLinksSteer(['https://b.example/x', 'https://d.example/y', 'https://e.example/z']),
  ),
].filter((frame) => frame.head.length >= 20)

/** True for a text the loop wrote to steer the model. */
export function isLoopSteer(text: unknown): boolean {
  if (typeof text !== 'string' || !text) return false
  if (FIXED.includes(text)) return true
  return FRAMED.some((frame) => text.startsWith(frame.head) && text.endsWith(frame.tail))
}
