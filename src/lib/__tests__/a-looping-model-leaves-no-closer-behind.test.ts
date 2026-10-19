/**
 * Box run 14.10.2026 (Qwen3.5 9B, Think on, issue 160 check): a model in a
 * loop wrote `</think>` twelve times. The first closed the thought; the other
 * eleven stood in the answer bubble and, since read aloud speaks what the
 * bubble shows, in the spoken text too.
 *
 * Run: npx vitest run src/lib/__tests__/a-looping-model-leaves-no-closer-behind.test.ts
 */
import { describe, it, expect } from 'vitest'
import { dropStrayClosers, settleThinking } from '../thinking-stripper'

const loop = 'The user wants a color.\n</think>\n\n' + '</think>\n'.repeat(11) + 'Red is a primary color.'

describe('closers left after the thought is split off', () => {
  it('none stands in the answer, with Think on and off', () => {
    for (const keep of [true, false]) {
      const out = settleThinking(loop, '', keep)
      expect(out.content, `keep ${keep}`).toBe('Red is a primary color.')
    }
    expect(settleThinking(loop, '', true).thinking).toBe('The user wants a color.\n')
  })

  it('a closer the answer shows as code stays', () => {
    const answer = 'Qwen ends its thought with `</think>`, like this:\n\n```\n<think>plan</think>\nanswer\n```\nDone.'
    expect(dropStrayClosers(answer)).toBe(answer)
  })

  it('a closer inside a sentence goes without taking the sentence', () => {
    expect(dropStrayClosers('Red </think>is a primary color.')).toBe('Red is a primary color.')
  })

  it('text without a closer comes back as it was', () => {
    expect(dropStrayClosers('Red is a primary color.')).toBe('Red is a primary color.')
  })
})
