/**
 * Mobile, acceptance on Android with 8 GB, B10: after a declined step Qwen3
 * 1.7B gave the app's own note back word for word as its answer.
 *
 * Run: npx vitest run src/lib/__tests__/rejected-call-echo.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import { REJECTED_CALL_DESKTOP, REJECTED_CALL_FOR_MODEL, REJECTED_CALL_PHONE, stripRejectedEcho } from '../rejected-call'
import { viewAnswer } from '../message-error'

describe('the note a model reads after a declined step', () => {
  it('a repeat of the phone sentence of before round 9 is still dropped from a stored answer', () => {
    const before =
      'This step was declined, so nothing ran. The other tools are still available. '
      + 'Do not repeat the same step: carry on another way, or ask what is wanted instead.'
    expect(stripRejectedEcho(`Fine.\n\n${before}`)).toEqual({ text: 'Fine.', echoed: true })
  })

  it('the desktop sentence is word for word what it was, and it is what a desktop sends', () => {
    expect(REJECTED_CALL_DESKTOP).toBe(
      'The user declined this tool call, so it did not run. All your tools are still available. '
      + 'Do not repeat the same call: continue another way, or ask the user what they want instead.',
    )
    expect(REJECTED_CALL_FOR_MODEL).toBe(REJECTED_CALL_DESKTOP)
  })

  it('a phone sends its own sentence', async () => {
    vi.resetModules()
    vi.doMock('../device-kind', async (orig) => ({ ...(await orig() as object), isMobile: () => true }))
    const phone = await import('../rejected-call')
    expect(phone.REJECTED_CALL_FOR_MODEL).toBe(REJECTED_CALL_PHONE)
    vi.doUnmock('../device-kind')
    vi.resetModules()
  })

  it('the phone sentence says the same three things and names neither a "user" nor a "tool call"', () => {
    expect(REJECTED_CALL_PHONE).toMatch(/declined, so nothing ran/)
    // Round 9, N7: what that means for the answer is said too.
    expect(REJECTED_CALL_PHONE).toMatch(/Nothing was written, saved or changed, so do not say that it was\./)
    expect(REJECTED_CALL_PHONE).toMatch(/tools are still available/)
    expect(REJECTED_CALL_PHONE).toMatch(/Do not repeat the same step/)
    expect(REJECTED_CALL_PHONE).not.toMatch(/\buser\b/i)
    expect(REJECTED_CALL_PHONE).not.toMatch(/tool call/i)
    expect(REJECTED_CALL_PHONE).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('a word for word repeat is not shown as the answer', () => {
  it('finds both sentences, also with other spacing, in quotes or without the last full stop', () => {
    for (const sentence of [REJECTED_CALL_DESKTOP, REJECTED_CALL_PHONE]) {
      expect(stripRejectedEcho(sentence)).toEqual({ text: '', echoed: true })
      expect(stripRejectedEcho(`"${sentence}"`)).toEqual({ text: '', echoed: true })
      expect(stripRejectedEcho(sentence.replace(/ /g, '\n').slice(0, -1))).toEqual({ text: '', echoed: true })
      expect(stripRejectedEcho(`Understood.\n\n${sentence}\n\nWhat should I do instead?`)).toEqual({
        text: 'Understood.\n\nWhat should I do instead?',
        echoed: true,
      })
    }
  })

  it('leaves every other answer exactly as it is', () => {
    const answer = 'You declined the search, so I answered from memory.  The capital is Reykjavik.\n'
    expect(stripRejectedEcho(answer)).toEqual({ text: answer, echoed: false })
    expect(stripRejectedEcho('')).toEqual({ text: '', echoed: false })
  })

  it('the reader of an answer drops it from the text that is copied and read aloud', () => {
    expect(viewAnswer({ content: REJECTED_CALL_DESKTOP })).toEqual({ body: '', error: null })
    expect(viewAnswer({ content: `Fine.\n\n${REJECTED_CALL_PHONE}` })).toEqual({ body: 'Fine.', error: null })
  })
})
