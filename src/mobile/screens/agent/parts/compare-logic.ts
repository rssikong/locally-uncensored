/** Pure helpers of C9 Compare. */
import type { Message } from '../../../../types/chat'

export type Side = 'a' | 'b'

/** Why the two chosen models cannot be compared yet, or null. */
export function compareBlock(modelA: string, modelB: string): 'need-two' | 'same' | null {
  if (!modelA || !modelB) return 'need-two'
  if (modelA === modelB) return 'same'
  return null
}

/** The question an answer belongs to: the last user message before it. */
export function questionOf(messages: ReadonlyArray<Message>, answerIndex: number): Message | null {
  for (let i = answerIndex - 1; i >= 0; i--) {
    if (messages[i].role === 'user') return messages[i]
  }
  return null
}

/** The two messages "Keep this answer" writes into the chat: the question and the answer, under fresh ids. */
export function keptPair(messages: ReadonlyArray<Message>, answerIndex: number, model: string, makeId: () => string, now: number): Message[] {
  const answer = messages[answerIndex]
  if (!answer || answer.role !== 'assistant' || !answer.content.trim()) return []
  const question = questionOf(messages, answerIndex)
  const out: Message[] = []
  if (question) out.push({ id: makeId(), role: 'user', content: question.content, timestamp: now })
  out.push({ id: makeId(), role: 'assistant', content: answer.content, modelId: model, timestamp: now + 1 })
  return out
}

export function formatRate(perSec: number): string {
  if (!Number.isFinite(perSec) || perSec <= 0) return '0'
  return perSec >= 10 ? String(Math.round(perSec)) : perSec.toFixed(1)
}

/** An answer shorter than this says nothing about speed: its time is all waiting for the first word. */
export const RATE_FROM_TOKENS = 8

/** Pure: is "per second" worth showing for an answer of this length (acceptance on the small iPhone, N27: "2 tokens, 0.1 per second"). */
export function rateIsMeaningful(tokens: number): boolean {
  return Number.isFinite(tokens) && tokens >= RATE_FROM_TOKENS
}
