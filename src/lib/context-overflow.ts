/**
 * A request that was longer than the window of the model, when it happened
 * anyway (lib/phone-context-fit.ts is what keeps it from happening on a phone).
 *
 * The engine says it in token counts: "the request exceeds the available
 * context size (4289 prompt tokens, context 4096)". True, and nothing a
 * reader can act on. A leaf without imports, so the reader of an answer
 * (lib/message-error.ts) can ask without pulling the agent loop along.
 */

/** The sentence of the engine of a phone, and of the usual servers, for a request longer than the window. */
const OVERFLOW = /exceeds? the (available )?context (size|window|length)|context (size|length|window) (has been |was )?exceeded|maximum context length|prompt is too long/i

/** Pure: is this reason "the request was longer than the window"? */
export function isContextOverflow(reason: string): boolean {
  return OVERFLOW.test(reason ?? '')
}

/** What the reader is told in place of the sentence of the engine: what happened, and the way out. */
export const CONTEXT_OVERFLOW_DETAIL =
  'This was more text than the model can read at once, so it could not answer. Start a new chat, or ask about one shorter page or file at a time.'
