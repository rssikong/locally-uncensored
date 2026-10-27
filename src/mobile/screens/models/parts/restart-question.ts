/**
 * "Restart engine" while the model on this phone writes an answer.
 *
 * The restart cut the answer without a word (acceptance iPhone, second part,
 * P3). The engine page asks first when a chat is between its send and its
 * end. Pure, so the rule has a test: `pending` is what hooks/useChat keeps
 * per conversation for a running plain chat send.
 */
export function answerIsRunning(pending: Record<string, unknown> | null | undefined): boolean {
  return !!pending && Object.keys(pending).length > 0
}
