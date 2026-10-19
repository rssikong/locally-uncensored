/**
 * GH #167, part 1: the token estimate undercounted Japanese about 2.8 times.
 *
 * The reporter (Gemma via LM Studio, long Japanese conversation) measured:
 * a history budget of 16,384 put 41,000 to 43,000 real prompt tokens on the
 * wire, a budget of 4,096 put 9,000 to 10,000. Gemma needs about 1.4 Japanese
 * characters per token, the estimate counted 4. The arithmetic matches the
 * log to the thousand: a local chat on a 16,384 window trims at 1.15 x 0.8 of
 * the window, 15,073 estimated tokens, and 15,073 x 4 / 1.4 is 43,000.
 *
 * These tests use the measured rate (1.4 characters per token) as the truth
 * and ask the estimate, the history budget, the max_tokens headroom and the
 * memory block to stay on the safe side of it.
 *
 * Run: npx vitest run src/lib/__tests__/japanisch-wird-nicht-viermal-zu-billig-gezaehlt.test.ts
 */
import { describe, it, expect } from 'vitest'
import { estimateTokens as fromLeaf, charsPerToken, TOKENS_PER_CHAR } from '../token-estimate'
import { estimateTokens, estimateMessageTokens } from '../context-compaction'
import { applyChatSendBudget } from '../chat-send-budget'
import { renderMemoryContext, MEMORY_CONTEXT_TOKEN_CAP } from '../../stores/memoryStore'
import type { MemoryFile } from '../../types/agent-mode'

/** Measured in the issue: Gemma, about 1.4 Japanese characters per token. */
const GEMMA_JA_CHARS_PER_TOKEN = 1.4

const JA_SENTENCE = '今日はとても良い天気ですね。私は公園で本を読みながら、ゆっくりとコーヒーを飲みました。'

/** Real Gemma tokens of a Japanese text, by the rate the reporter measured. */
const realJa = (text: string) => Math.ceil(text.length / GEMMA_JA_CHARS_PER_TOKEN)

describe('estimateTokens, Japanese', () => {
  it('a Japanese text is estimated at least at the measured real count', () => {
    const text = JA_SENTENCE.repeat(200)
    // The old chars / 4 said 1/2.8 of this.
    expect(estimateTokens(text)).toBeGreaterThanOrEqual(realJa(text))
    // Leaning high, not absurdly high: under 1.25 times the real count.
    expect(estimateTokens(text)).toBeLessThan(realJa(text) * 1.25)
  })

  it('Korean and Chinese are charged like Japanese', () => {
    const ko = '안녕하세요 오늘 날씨가 정말 좋네요'.repeat(50)
    const zh = '今天天气很好，我们一起去公园散步吧。'.repeat(50)
    expect(estimateTokens(zh)).toBeGreaterThanOrEqual(Math.ceil(zh.length / 1.4))
    // Hangul syllables plus ASCII spaces: the syllables alone carry 0.8.
    const syllables = ko.replace(/ /g, '').length
    expect(estimateTokens(ko)).toBeGreaterThanOrEqual(Math.ceil(syllables * TOKENS_PER_CHAR.cjk))
  })

  it('emoji cost tokens, not a quarter of one', () => {
    expect(estimateTokens('😀'.repeat(100))).toBeGreaterThanOrEqual(200)
  })

  it('ASCII without digits is byte for byte the old ceil(len / 4) + 1', () => {
    // Digits cost a token each since 3.0.7 (token-estimate-ziffern.test.ts).
    for (const s of ['', 'a', 'hello world', 'x'.repeat(4001), JSON.stringify({ a: ['x', 'y'], b: 'text' })]) {
      expect(estimateTokens(s)).toBe(Math.ceil(s.length / 4) + 1)
    }
  })

  it('there is one estimate: context-compaction hands out the leaf function', () => {
    const mixed = `${JA_SENTENCE} and some English 😀`
    expect(estimateTokens(mixed)).toBe(fromLeaf(mixed))
  })

  it('charsPerToken is 4 for ASCII and near 1.25 for Japanese', () => {
    expect(charsPerToken('plain ascii text')).toBe(4)
    expect(charsPerToken(JA_SENTENCE)).toBeLessThan(GEMMA_JA_CHARS_PER_TOKEN)
  })
})

describe('the history budget holds a Japanese chat (the scenario of the issue)', () => {
  function japaneseChat(turns: number) {
    const msgs: { role: string; content: string }[] = [{ role: 'system', content: 'You are a helpful assistant.' }]
    for (let i = 0; i < turns; i++) {
      msgs.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: JA_SENTENCE.repeat(12) })
    }
    return msgs
  }

  for (const window of [16384, 4096]) {
    it(`a ${window} window receives at most ${window} real tokens`, () => {
      const sent = applyChatSendBudget(japaneseChat(400), {
        providerId: 'openai',
        modelWindow: window,
        contextDecay: true,
        localBackend: true,
      }).messages
      const real = sent.reduce((n, m) => n + realJa(m.content) + 4, 0)
      expect(real).toBeLessThanOrEqual(window)
      // And the trim still keeps a real part of the conversation.
      expect(sent.length).toBeGreaterThan(4)
    })
  }

  it('estimateMessageTokens of the same history is at least its real size', () => {
    const msgs = japaneseChat(10) as { role: 'user' | 'assistant' | 'system'; content: string }[]
    const real = msgs.reduce((n, m) => n + realJa(m.content), 0)
    expect(estimateMessageTokens(msgs)).toBeGreaterThanOrEqual(real)
  })
})

describe('the memory block keeps its token cap in Japanese', () => {
  it('a Japanese memory block stays within MEMORY_CONTEXT_TOKEN_CAP real tokens', () => {
    const memories = Array.from({ length: 40 }, (_, i) => ({
      id: `m${i}`,
      type: 'user',
      title: `メモ${i}`,
      content: JA_SENTENCE,
    })) as unknown as MemoryFile[]
    const { text, memoryIds } = renderMemoryContext(memories, 5000)
    expect(memoryIds.length).toBeGreaterThan(0)
    expect(realJa(text)).toBeLessThanOrEqual(MEMORY_CONTEXT_TOKEN_CAP * 1.05)
  })
})
