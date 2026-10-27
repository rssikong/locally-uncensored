// @vitest-environment jsdom
/**
 * Round 6, the agent on a phone with 8 GB (mobile-docs/r6/agent.md).
 *
 * B1   A request longer than the window of the model: the box says what
 *      happened and the way out, not token counts, and no speed stands under it.
 * B10  A model that gives the app's note for a declined step back word for
 *      word: the note is not shown as the answer.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round6-agent.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../lib/model-place', () => ({
  modelPlace: () => 'device',
  isDeviceModel: () => true,
  leavesPhone: () => false,
}))
vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, type MessageHandlers } from '../parts/MessageItem'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import { CONTEXT_OVERFLOW_DETAIL } from '../../../../lib/context-overflow'
import { REJECTED_CALL_DESKTOP, REJECTED_CALL_PHONE } from '../../../../lib/rejected-call'
import type { Message } from '../../../../types/chat'

const noop = () => undefined
const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: noop, answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
const answer = (over: Partial<Message>): Message => ({ id: 'm1', role: 'assistant', content: '', timestamp: 1, modelId: 'Qwen3-1.7B-Q4_K_M', ...over }) as Message
const show = (message: Message, speed?: string) => render(<MessageItem chatId="c1" message={message} handlers={handlers} last speed={speed} />)

afterEach(cleanup)

describe('B1: the request was longer than the window', () => {
  const ENGINE = 'Agent error: the request exceeds the available context size (4289 prompt tokens, context 4096)'

  it('the box says what happened and the way out, the sentence of the engine is not on screen', () => {
    show(answer({ content: `\n\n${ENGINE}`, agentBlocks: [] }))
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.genericTitle)
    expect(box.textContent).toContain(CONTEXT_OVERFLOW_DETAIL)
    const all = screen.getByTestId('m-chat-message').textContent ?? ''
    expect(all).not.toContain('4289')
    expect(all).not.toContain('context size')
    expect(all).not.toContain('Agent error')
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe(S.errors.tryAgain)
  })

  it('the part of the answer that arrived stays the answer', () => {
    show(answer({ content: `I found the page.\n\n${ENGINE}`, agentBlocks: [] }))
    expect(screen.getByTestId('m-chat-answer').textContent).toContain('I found the page.')
    expect(screen.getByTestId('m-chat-answer').textContent).not.toContain('context')
  })
})

describe('B10: the note for a declined step is not an answer', () => {
  it('a word for word repeat is replaced by what happened, in the words of the app', () => {
    for (const note of [REJECTED_CALL_DESKTOP, REJECTED_CALL_PHONE]) {
      show(answer({ content: note, agentBlocks: [{ id: 'b1', phase: 'answer', content: note, timestamp: 1 }] as Message['agentBlocks'] }))
      const text = screen.getByTestId('m-chat-answer').textContent ?? ''
      expect(text).toContain(S.chat.declinedStep)
      expect(text).not.toContain('tools are still available')
      expect(text).not.toContain('Do not repeat')
      cleanup()
    }
  })

  it('also when the repeat only stands in the answer block of the run', () => {
    show(answer({ content: '', agentBlocks: [{ id: 'b1', phase: 'answer', content: REJECTED_CALL_DESKTOP, timestamp: 1 }] as Message['agentBlocks'] }))
    expect(screen.getByTestId('m-chat-answer').textContent).toContain(S.chat.declinedStep)
  })

  it('what the model said besides the note stays', () => {
    show(answer({ content: `No problem.\n\n${REJECTED_CALL_PHONE}`, agentBlocks: [] }))
    const text = screen.getByTestId('m-chat-answer').textContent ?? ''
    expect(text).toContain('No problem.')
    expect(text).not.toContain('nothing ran')
    expect(text).not.toContain(S.chat.declinedStep)
  })

  it('the sentence of the app is English and carries no dashes', () => {
    expect(S.chat.declinedStep).not.toMatch(/[\u2013\u2014]/)
  })
})
