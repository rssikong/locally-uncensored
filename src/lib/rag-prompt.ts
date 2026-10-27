/**
 * The retrieval block, built in one place.
 *
 * Plain chat (hooks/useChat) and Agent mode (hooks/useAgentChat) each carried
 * their own copy of this string. Two copies of a prompt are two prompts as soon
 * as one of them is edited, and A9 needed a third caller to prove the block
 * reaches a CLOUD request, so it moves here.
 *
 * It is a suffix, not a prefix, on purpose: the retrieved chunks are the most
 * volatile thing in the prompt (every turn pulls different ones). At byte 0 they
 * pushed an upstream prefix cache, which matches from the first byte and stops
 * at the first difference, off the ENTIRE prompt on every RAG turn. Behind
 * persona, memory and caveman, everything a cache could match stays
 * byte-identical from turn to turn (plan A5).
 *
 * A7 (3.0.8) took the last step: the end of the system prompt is still in
 * front of the whole conversation, so a suffix there still cost the cache every
 * message of the chat. The block now rides in the turn note behind the newest
 * user message (lib/turn-context.ts). A user turn is, like the system message,
 * something Ollama, the built-in engine, LM Studio and LU Cloud all take, so
 * Document Chat still works in Cloud mode.
 */

export const RAG_INSTRUCTION =
  "Use the following document context to help answer the user's question. " +
  'If the context is not relevant, ignore it and answer normally.'

/**
 * @param chunks the retrieved passages, already ranked and cut to the budget
 * @returns the block for the turn note (lib/turn-context.ts), or '' when there is
 *   nothing to say. Empty in, empty out: a turn without a hit must not spend
 *   tokens on an instruction pointing at no context.
 */
export function buildRagSuffix(chunks: { content: string }[]): string {
  if (!chunks || chunks.length === 0) return ''
  const contextBlock = chunks
    .map((c, i) => `[Source ${i + 1}]\n${c.content}`)
    .join('\n\n')
  return `\n\n${RAG_INSTRUCTION}\n\n---\n${contextBlock}\n---`
}

/**
 * Shown when retrieval threw and the turn went out without the documents
 * (review S4). English, like every other error surface in the app.
 */
export const RETRIEVAL_FAILED_MESSAGE =
  'Your documents could not be searched for this message, so the answer was written without them. ' +
  'Check that the embedding engine is running, then send again.'
