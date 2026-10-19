/**
 * What an assistant turn shows as its answer, and so what is read aloud.
 *
 * The bubble never rendered the stored text as it is: it ran the display strip
 * over it first (lib/strip-model-noise.ts), which takes out reasoning and
 * orchestration markers. Read-aloud was handed the stored text itself, so the
 * voice pronounced markers that stood nowhere on the screen (issue 160). Both
 * take their text from here now, and there is no second cleaning for speech.
 */

import type { Message } from '../types/chat'
import { stripModelNoise } from './strip-model-noise'

export interface ShownAnswer {
  /** The cleaned text of every answer block, by block id. Empty when the block
   *  held nothing but orchestration. */
  blocks: Map<string, string>
  /** The cleaned message body, shown when no answer block has text. */
  content: string
  /** The answer as read aloud: the closing answer block when the turn has
   *  one, the message body otherwise. */
  spoken: string
}

/**
 * `toolLoopDriven` picks the tier for the message body: aggressive while a
 * tool loop drives the turn, gentle in plain chat, where a {"name": …,
 * "arguments": …} block can be exactly the answer the user asked for. Answer
 * blocks only exist in a tool loop and always get the aggressive tier.
 */
export function shownAnswer(
  message: Pick<Message, 'content' | 'agentBlocks'>,
  toolLoopDriven: boolean,
): ShownAnswer {
  const blocks = new Map<string, string>()
  let closing = ''
  let closingAt = -Infinity
  for (const b of message.agentBlocks ?? []) {
    if (b.phase !== 'answer') continue
    const clean = stripModelNoise(b.content, { aggressive: true })
    blocks.set(b.id, clean)
    if (clean && b.timestamp >= closingAt) {
      closing = clean
      closingAt = b.timestamp
    }
  }
  const content = stripModelNoise(message.content || '', { aggressive: toolLoopDriven })
  return { blocks, content, spoken: closing || content }
}
