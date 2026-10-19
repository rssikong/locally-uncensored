/**
 * 3.0.7, Windows run d307-k (B5): three messages of a numeric log on a 32K
 * window got HTTP 400 "request (38214 tokens) exceeds the available context
 * size (32768 tokens)". The estimate said about 26,000, so the send budget
 * never trimmed. Digits, hex and Base64 are now charged by what Qwen and
 * Gemma really make of them.
 *
 * The real counts below come from the tokenizers themselves, see
 * token-estimate-samples.ts.
 *
 * Run: npx vitest run src/lib/__tests__/token-estimate-ziffern.test.ts
 */
import { describe, it, expect } from 'vitest'
import { estimateTokens, charsPerToken, TOKENS_PER_CHAR } from '../token-estimate'
import { estimateMessageTokens } from '../context-compaction'
import { applyChatSendBudget, sendBudgetWouldTrim } from '../chat-send-budget'
import { SAMPLES } from './token-estimate-samples'

/** Real counts: Qwen2.5 (llama-tokenize) and Gemma 3. */
const REAL: Record<keyof typeof SAMPLES, { qwen: number; gemma: number }> = {
  log: { qwen: 12669, gemma: 12340 },
  words: { qwen: 2307, gemma: 2088 },
  digits: { qwen: 5000, gemma: 5000 },
  numbers: { qwen: 8999, gemma: 8999 },
  hex: { qwen: 5282, gemma: 5298 },
  base64: { qwen: 5908, gemma: 5557 },
  prose: { qwen: 3321, gemma: 3281 },
}

const JA_SENTENCE = '今日はとても良い天気ですね。私は公園で本を読みながら、ゆっくりとコーヒーを飲みました。'

describe('dense text is no longer undercounted', () => {
  for (const key of ['log', 'digits', 'numbers', 'hex', 'base64'] as const) {
    it(`${key}: at or a little over the real count of both tokenizers`, () => {
      const est = estimateTokens(SAMPLES[key])
      const real = Math.max(REAL[key].qwen, REAL[key].gemma)
      expect(est).toBeGreaterThanOrEqual(real)
      // Leaning high, not absurdly high.
      expect(est).toBeLessThan(real * 1.2)
    })
  }

  it('the log of the run: chars / 4 said 8,588, Qwen counts 12,669', () => {
    const log = SAMPLES.log
    expect(Math.ceil(log.length / 4) + 1).toBe(8588)
    expect(estimateTokens(log)).toBeGreaterThanOrEqual(12669)
  })
})

describe('plain text keeps its old rate', () => {
  it('English prose without digits is the old ceil(len / 4) + 1', () => {
    expect(estimateTokens(SAMPLES.prose)).toBe(Math.ceil(SAMPLES.prose.length / 4) + 1)
    expect(estimateTokens(SAMPLES.prose)).toBeGreaterThanOrEqual(REAL.prose.qwen)
  })

  it('cheap English words stay over the real count (the trim comes early, auto compact must come first)', () => {
    const est = estimateTokens(SAMPLES.words)
    expect(est).toBeGreaterThan(REAL.words.qwen * 1.3)
  })

  it('an identifier or a camelCase word is not an encoded run', () => {
    const code = 'const getModelContextCached = resolveCompactThresholdFromSettings(window)'
    expect(estimateTokens(code)).toBe(Math.ceil(code.length / 4) + 1)
  })

  it('Japanese is charged exactly as in GH #167', () => {
    // 200 sentences, 8,600 characters, all CJK: 0.8 each, as before.
    const ja = JA_SENTENCE.repeat(200)
    expect(estimateTokens(ja)).toBe(Math.ceil(ja.length * TOKENS_PER_CHAR.cjk) + 1)
    expect(charsPerToken(ja)).toBeCloseTo(1 / TOKENS_PER_CHAR.cjk, 5)
  })

  it('Japanese with dates and prices gains the digits and nothing else', () => {
    const line = '2026年10月19日、売上は12340円でした。'
    const digits = line.replace(/[^0-9]/g, '').length
    const cjk = line.length - digits
    expect(estimateTokens(line)).toBe(Math.ceil(cjk * TOKENS_PER_CHAR.cjk + digits * TOKENS_PER_CHAR.digit) + 1)
  })

  it('charsPerToken follows the density: 4 for prose, about 1 for digits', () => {
    expect(charsPerToken(SAMPLES.prose)).toBe(4)
    expect(charsPerToken(SAMPLES.digits)).toBeLessThan(1.01)
  })
})

describe('the scenario of the run: three log messages on a 32K window', () => {
  const window = 32768
  const input = { providerId: 'openai', modelWindow: window, contextDecay: true, localBackend: true }
  const chat = () => [
    { role: 'system', content: 'You are the user\'s own model.' },
    { role: 'user', content: SAMPLES.log },
    { role: 'assistant', content: 'OK' },
    { role: 'user', content: SAMPLES.log },
    { role: 'assistant', content: 'OK' },
    { role: 'user', content: SAMPLES.log },
  ]

  it('the estimate of the payload is over the window, as the server said', () => {
    expect(estimateMessageTokens(chat() as never)).toBeGreaterThan(38000)
  })

  it('the send budget trims it, and what goes out fits the window', () => {
    expect(sendBudgetWouldTrim(chat(), input)).toBe(true)
    const sent = applyChatSendBudget(chat(), input).messages
    // The first log is dropped from the window; the trim pins the first user
    // turn again, cut to its first 8,000 characters.
    expect(sent.filter((m) => m.content === SAMPLES.log)).toHaveLength(2)
    // A whole log is 12,669 real tokens; for anything else the estimate,
    // which runs at or over the real count on this text.
    const real = sent.reduce(
      (n, m) => n + (m.content === SAMPLES.log ? REAL.log.qwen : estimateTokens(m.content)) + 4,
      0,
    )
    expect(real).toBeLessThan(window)
  })
})
