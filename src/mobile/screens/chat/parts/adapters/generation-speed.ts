/**
 * Report how fast an answer was written, for the diagnostics page: the
 * measuring seam of the scaffold (src/mobile/lib/diagnostics.ts).
 */
import { reportGenerationSpeed, type GenerationSpeedInput } from '../../../../lib/diagnostics'

export type { GenerationSpeedInput }

/** Pure: a rough token count for an answer whose backend reported none. About four characters are one token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4)
}

/**
 * Pure: what one finished answer measures.
 *
 * One measure for the whole app (acceptance on Android, N22: three places showed 20.5, 8.5 and 4.9
 * for the same phone). It is the speed of writing: every token the model wrote, thoughts included,
 * over the time from its first token to its last. Loading the model and reading the prompt are not
 * in it. The chat used to divide the visible answer by the whole wait, which is how the same phone
 * came to less than half of its self test.
 */
export function answerSpeedInput(facts: {
  /** Tokens the engine reported for this answer, when it did and it is not an estimate. */
  reportedTokens?: number
  /** The visible answer and the thoughts before it, for the estimate. */
  body: string
  thinking?: string
  runStartedAt: number
  /** When the first token arrived, or null when that moment was not seen. */
  firstTokenAt: number | null
  endedAt: number
}): { tokens: number; ms: number } {
  const tokens = facts.reportedTokens && facts.reportedTokens > 0 ? facts.reportedTokens : estimateTokens(`${facts.thinking ?? ''} ${facts.body}`)
  const from = facts.firstTokenAt !== null && facts.firstTokenAt >= facts.runStartedAt ? facts.firstTokenAt : facts.runStartedAt
  return { tokens, ms: Math.max(0, facts.endedAt - from) }
}

/** Pure: the figure as every place of the app writes it. Whole numbers from 10 up, one decimal below. */
export function speedFigure(tokensPerSecond: number): string {
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) return '0'
  return tokensPerSecond >= 10 ? tokensPerSecond.toFixed(0) : tokensPerSecond.toFixed(1)
}

/**
 * The shortest stretch of writing that measures anything. An answer that arrives in one piece (the
 * closing text of an agent run, a sentence of the app in place of an answer) has its first and its
 * last token in the same moment, and a few tokens over a few milliseconds read as "1200 tokens per
 * second" on a phone that writes 20 (acceptance on Android with 8 GB, B1 and B13).
 */
export const MIN_MEASURED_MS = 250

/** Pure: can these two numbers be a speed? */
export function measuresSpeed(input: { tokens: number; ms: number }): boolean {
  return input.tokens > 0 && input.ms >= MIN_MEASURED_MS
}

/** Never throws: the chat does not depend on the report. Returns the tokens per second that were kept, or null. */
export function reportSpeed(input: GenerationSpeedInput): number | null {
  if (!measuresSpeed(input)) return null
  try {
    return reportGenerationSpeed(input)?.tokensPerSecond ?? null
  } catch {
    /* a broken report must not touch the chat */
    return null
  }
}
