/**
 * A question that never got an answer is not sent along with the next one.
 *
 * Phone, small iPhone K9: with Thinking on, "Explain step by step why the sky
 * is blue" was stopped after four seconds. The model had only thought, so the
 * stored answer is empty. The next message was "Say ok.", and the answer was
 * an essay about the blue sky. The history that goes to the model is built
 * without empty messages, so the model saw two user messages in a row, the
 * stopped question first, and took it for the one that is open.
 *
 * The chat shows the stopped round as stopped ("The model only thought and
 * wrote no answer."). The model gets the history without that round: the
 * question and its empty answer are left out of the request, the chat itself
 * is not changed. Left out and not marked with a stand-in answer, because a
 * model of a phone repeats a stand-in ("(stopped)") as if it were an answer.
 *
 * Pure. Called by the two send paths behind `isMobile()`; a desktop sends
 * what it always sent.
 */

interface TurnMessage {
  role: string
  content: string
  hidden?: boolean
  tool_calls?: readonly unknown[]
}

const says = (m: TurnMessage) => m.content.trim() !== '' || (m.tool_calls?.length ?? 0) > 0

/**
 * The messages without the user turns that were never answered and are not
 * the last one. A turn counts as answered when anything with a body follows
 * it before the next user message: an answer, a call of a tool, its result.
 * Hidden messages and app notices (role "system") are neither a question nor
 * an answer and stay where they are.
 */
export function withoutUnansweredTurns<M extends TurnMessage>(messages: readonly M[]): M[] {
  const isQuestion = (m: M) => m.role === 'user' && !m.hidden
  const drop = new Set<number>()
  for (let i = 0; i < messages.length; i++) {
    if (!isQuestion(messages[i])) continue
    let next = -1
    let answered = false
    const empties: number[] = []
    for (let j = i + 1; j < messages.length; j++) {
      const m = messages[j]
      if (isQuestion(m)) {
        next = j
        break
      }
      if (m.role === 'system' || m.hidden) continue
      if (says(m)) answered = true
      else empties.push(j)
    }
    // The last question is the one being asked now.
    if (next === -1 || answered) continue
    drop.add(i)
    for (const j of empties) drop.add(j)
  }
  return drop.size === 0 ? [...messages] : messages.filter((_, i) => !drop.has(i))
}
