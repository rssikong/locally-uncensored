/**
 * Acceptance android-4gb, F11: the context figure of a plain chat on a phone.
 *
 * What was seen, window 4096 (Qwen 3.5 0.8B): a question of 11 500 characters
 * of notes with many numbers. The chip said "Context 72%", the answer was
 * "This was more text than the model can read at once". Asked on in the same
 * chat without deleting anything: 74, 78, 13, 18, 21, 86, 84, 85, 88, 96, 90.
 *
 * The figure and what is left out of a request now come from one function
 * (lib/phone-context-fit.ts). This file plays the chat of the finding through
 * the send path's rule and the chip's rule and holds what a user must see:
 *  - a question that cannot be read never stands next to a figure below 100,
 *  - the figure never falls unless turns were left out, and then it says so,
 *  - what the chip shows after a send is what that send carried.
 *
 * Run: npx vitest run src/lib/__tests__/phone-context-meter.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

let phone = true
vi.mock('../capabilities', async (orig) => ({ ...((await orig()) as object), singleModelSlot: () => phone }))

import {
  fitChatForPhone, fitChatToWindow, meterOfFit, phoneContextMeter, phonePromptLimit, phoneTokens, shownPhoneMeter,
  type PhoneMeter, type PhoneMeterReport, type StoredForMeter,
} from '../phone-context-fit'
import { computeContextFill } from '../token-usage'

const CTX = 4096
interface Msg { role: 'user' | 'assistant' | 'system'; content: string }

/** Notes with many numbers, 11 500 characters, as in the finding. */
function notes(chars = 11500): string {
  const lines: string[] = []
  for (let i = 0; lines.join('\n').length < chars; i++) {
    lines.push(`Entry ${1000 + i}: reading ${(i * 37) % 1000}.${(i * 91) % 100} at ${10 + (i % 14)}:${10 + (i % 50)}, batch ${48213 + i * 7}, cost ${(i * 13) % 900}.${(i * 7) % 100}`)
  }
  return lines.join('\n').slice(0, chars)
}

const SYSTEM = 'You are a helpful assistant.'

/** A chat on the phone: the send path and the chip, the way useChat and the chat page use the functions. */
class PhoneChat {
  stored: Msg[] = []
  report: PhoneMeterReport | null = null
  /** Every figure the chip showed, in order, with why. */
  seen: Array<{ when: string; meter: PhoneMeter }> = []

  private storedForMeter(): StoredForMeter[] {
    return this.stored.map((m) => ({ message: m, counts: m.role !== 'system' && m.content.trim() !== '' }))
  }

  look(when: string): PhoneMeter {
    const meter = shownPhoneMeter(this.report, this.storedForMeter(), SYSTEM, CTX)
    this.seen.push({ when, meter })
    return meter
  }

  /** What useChat does at a send. Returns what went out, and whether the engine could read it. */
  send(question: string): { wire: Msg[]; readable: boolean } {
    this.stored.push({ role: 'user', content: question })
    const candidate: Msg[] = [{ role: 'system', content: SYSTEM }, ...this.stored.filter((m) => m.role !== 'system' && m.content.trim() !== '')]
    const fit = fitChatForPhone(candidate, CTX)
    this.report = { meter: meterOfFit(candidate.length, fit, CTX), window: CTX, atMessageCount: this.stored.length }
    this.look(`sent: ${question.slice(0, 24)}`)
    return { wire: fit.messages, readable: !fit.over }
  }

  answer(text: string): void {
    this.stored.push({ role: 'assistant', content: text })
    this.look(`answered: ${text.slice(0, 24)}`)
  }
}

describe('the counting', () => {
  it('four characters per token read the notes of the finding as 70 percent; they are more than the window', () => {
    const text = notes()
    expect(text.length).toBe(11500)
    // What the chip did before was characters by four, of the whole window:
    // 70 percent. The desktop's counter counts a digit as a token since 3.0.8
    // too, so it no longer says the notes fit.
    const before = computeContextFill([{ role: 'user', content: text }])
    expect(before.used).toBeGreaterThan(CTX)
    // A digit is a token: the text alone is far more than the window holds.
    expect(phoneTokens(text)).toBeGreaterThan(CTX)
    expect(phoneTokens(text)).toBeGreaterThanOrEqual((text.match(/\d/g) ?? []).length)
  })

  it('a question that is too long on its own is too long, at 100 percent, and goes out whole', () => {
    const chat: Msg[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: notes() }]
    const meter = phoneContextMeter(chat, CTX)
    expect(meter.state).toBe('too-long')
    expect(meter.percent).toBe(100)
    // A plain chat never sends half a question: the engine, which counts for real, says no to the whole one.
    const fit = fitChatToWindow(chat, CTX)
    expect(fit.over).toBe(true)
    expect(fit.messages[fit.messages.length - 1].content).toBe(notes())
  })

  it('a short chat fits and is counted against the room a request has, not the whole window', () => {
    const chat: Msg[] = [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'What is the capital of France? One word.' }, { role: 'assistant', content: 'Paris.' }]
    const meter = phoneContextMeter(chat, CTX)
    expect(meter.state).toBe('fits')
    expect(meter.limit).toBe(phonePromptLimit(CTX))
    expect(meter.limit).toBeLessThan(CTX)
    expect(meter.percent).toBeGreaterThan(0)
    expect(meter.percent).toBeLessThan(5)
    expect(meter.dropped).toBe(0)
  })
})

describe('the chat of the finding', () => {
  const story = (n: number) => `Here is part ${n} of the story. ${'The harbour was quiet and the boat lay still on the water. '.repeat(9)}`

  function play(): PhoneChat {
    const chat = new PhoneChat()
    const first = chat.send(notes())
    expect(first.readable).toBe(false)
    // The engine refuses; the sentence stands in the chat as an app notice, not as an answer of the model.
    chat.stored.push({ role: 'system', content: 'This was more text than the model can read at once, so it could not answer.' })
    chat.look('refused')
    for (let i = 1; i <= 11; i++) {
      const sent = chat.send(`Tell me part ${i} of a story about a harbour, in about 120 words.`)
      expect(sent.readable, `question ${i}`).toBe(true)
      chat.answer(story(i))
    }
    return chat
  }

  it('the refused question stands at 100 percent, never at 72', () => {
    const chat = play()
    expect(chat.seen[0].meter).toMatchObject({ state: 'too-long', percent: 100 })
    expect(chat.seen[1].meter).toMatchObject({ state: 'too-long', percent: 100 })
  })

  it('the next question leaves the long one out, and the figure says so when it falls', () => {
    const chat = play()
    const afterSecondSend = chat.seen[2].meter
    expect(afterSecondSend.state).toBe('trimmed')
    expect(afterSecondSend.dropped).toBeGreaterThan(0)
    expect(afterSecondSend.percent).toBeLessThan(20)
  })

  it('the figure never falls without turns being left out', () => {
    const chat = play()
    const falls: string[] = []
    for (let i = 1; i < chat.seen.length; i++) {
      const before = chat.seen[i - 1].meter
      const now = chat.seen[i].meter
      if (now.percent < before.percent && !(now.state === 'trimmed' && now.dropped > before.dropped || before.state === 'too-long' && now.state === 'trimmed')) {
        falls.push(`${chat.seen[i - 1].when} ${before.percent}% (${before.state}) -> ${chat.seen[i].when} ${now.percent}% (${now.state})`)
      }
    }
    expect(falls).toEqual([])
  })

  it('it does not jump either: between two looks it moves by what was added, not by another way of counting', () => {
    const chat = play()
    const jumps: string[] = []
    for (let i = 3; i < chat.seen.length; i++) {
      const before = chat.seen[i - 1].meter
      const now = chat.seen[i].meter
      // One question or one answer of about 120 words is 5 to 8 percent of the room. More than 25 is a jump.
      if (now.dropped === before.dropped && Math.abs(now.percent - before.percent) > 25) jumps.push(`${before.percent} -> ${now.percent} at ${chat.seen[i].when}`)
    }
    expect(jumps).toEqual([])
    // And the chat does fill up: the last figure is well above the first one after the long question was left out.
    expect(chat.seen[chat.seen.length - 1].meter.percent).toBeGreaterThan(chat.seen[2].meter.percent + 30)
  })

  it('what the chip shows after a send is what that send carried', () => {
    const chat = new PhoneChat()
    chat.send(notes())
    chat.stored.push({ role: 'system', content: 'refused' })
    const sent = chat.send('What is the capital of Spain? One word.')
    const shown = chat.seen[chat.seen.length - 1].meter
    // The long question is not on the wire, and the figure is the size of the wire.
    expect(sent.wire.some((m) => m.content === notes())).toBe(false)
    expect(sent.wire[0].role).toBe('system')
    expect(sent.wire[sent.wire.length - 1].content).toBe('What is the capital of Spain? One word.')
    const onWire = sent.wire.reduce((sum, m) => sum + phoneTokens(m.content) + 6, 0)
    expect(shown.tokens).toBe(onWire)
    expect(shown.state).toBe('trimmed')
  })

  it('a chat opened after a restart (no report) shows the same rule run over the chat as it stands', () => {
    const chat = play()
    const withReport = chat.seen[chat.seen.length - 1].meter
    chat.report = null
    const without = chat.look('after a restart')
    expect(without.state).toBe(withReport.state)
    expect(Math.abs(without.percent - withReport.percent)).toBeLessThanOrEqual(12)
  })

  it('a growing chat without a long message goes up evenly and says "trimmed" from the moment turns fall out', () => {
    const chat = new PhoneChat()
    let trimmedAt = -1
    for (let i = 1; i <= 40 && trimmedAt < 0; i++) {
      chat.send(`Tell me part ${i} of a story about a harbour, in about 120 words.`)
      chat.answer(story(i))
      if (chat.seen[chat.seen.length - 1].meter.state === 'trimmed') trimmedAt = i
    }
    expect(trimmedAt).toBeGreaterThan(5)
    const before = chat.seen.filter((s) => s.meter.state === 'fits').map((s) => s.meter.percent)
    for (let i = 1; i < before.length; i++) expect(before[i]).toBeGreaterThanOrEqual(before[i - 1])
    expect(before[before.length - 1]).toBeGreaterThan(80)
  })
})

describe('where it runs', () => {
  it('on a desktop and for a large window the send path gets its array back, by reference', () => {
    const messages: Msg[] = [{ role: 'user', content: notes() }]
    phone = false
    try {
      expect(fitChatForPhone(messages, CTX).messages).toBe(messages)
    } finally {
      phone = true
    }
    expect(fitChatForPhone(messages, 131072).messages).toBe(messages)
  })

  it('useChat cuts a plain chat on the phone with it and reports what went out; the chip and the sheet read that', () => {
    const src = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8')
    const hook = src('hooks/useChat.ts')
    expect(hook).toContain('const phoneOwnsFit = isMobile() && phoneFitApplies(modelWindowTokens)')
    expect(hook).toContain('const phoneFit = phoneOwnsFit ? fitChatForPhone(budgetedBySendWindow, modelWindowTokens) : null')
    // Check 4 on Android, F7: one rule, not two. The send budget of the desktop does not run in front of the rule of the phone.
    expect(hook).toContain('const budgetedBySendWindow = phoneOwnsFit ? candidate : applyChatSendBudget(')
    expect(hook).toContain('usePhoneMeterStore.getState().report(convId, {')
    const chip = src('mobile/screens/chat/parts/ComposerParts.tsx')
    expect(chip).toContain('shownPhoneMeter(report, stored,')
    expect(src('mobile/screens/agent/parts/options/ContextPage.tsx')).toContain('usePhoneMeter(chat.key, window)')
  })
})
