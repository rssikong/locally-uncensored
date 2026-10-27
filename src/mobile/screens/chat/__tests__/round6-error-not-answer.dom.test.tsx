// @vitest-environment jsdom
/**
 * Round 6, G8: a sentence a failed run left in an answer is drawn as the
 * error of that answer, never as its text. Local and cloud.
 *
 * The rules are in src/lib/logic-notes.ts and tested for every sentence in
 * src/lib/__tests__/logic-notes.test.ts. This file looks at the bubble.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round6-error-not-answer.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const place = vi.hoisted(() => ({ of: 'device' as 'device' | 'cloud' | 'own' }))
vi.mock('../../../lib/model-place', () => ({
  modelPlace: () => place.of,
  isDeviceModel: () => place.of === 'device',
  leavesPhone: () => place.of !== 'device',
}))
vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, type MessageHandlers } from '../parts/MessageItem'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import { DISCONNECT_WITHOUT_ANSWER, emptyAnswerExplanation } from '../../../../lib/answer-notes'
import { PLATFORM_TEXTS } from '../../../../lib/platform-text'
import type { Message } from '../../../../types/chat'

const noop = () => undefined
const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: noop, answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
const answer = (over: Partial<Message>): Message => ({ id: 'm1', role: 'assistant', content: '', timestamp: 1, modelId: 'SmolLM2-360M', ...over }) as Message
const show = (message: Message) => render(<MessageItem chatId="c1" message={message} handlers={handlers} last />)

beforeEach(() => {
  place.of = 'device'
})
afterEach(cleanup)

describe('G8: the sentence is in the box, the answer has no text', () => {
  it('a cloud answer whose stream broke before any text: the box, and no sentence as the answer', () => {
    place.of = 'cloud'
    show(answer({ content: DISCONNECT_WITHOUT_ANSWER, finishReason: 'disconnect', modelId: 'lu-cloud::small' }))
    expect(screen.queryByTestId('m-chat-answer')).toBeNull()
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.networkTitle)
    expect(screen.getByTestId('m-chat-copy').hasAttribute('disabled') || screen.getByTestId('m-chat-copy').getAttribute('aria-disabled') === 'true').toBe(true)
  })

  it('the token budget ran out before any text: "No answer came back" with the reason, no answer text', () => {
    const reason = emptyAnswerExplanation({ finishReason: 'length', captured: false, keepThinking: false })
    show(answer({ content: reason, finishReason: 'length' }))
    expect(screen.queryByTestId('m-chat-answer')).toBeNull()
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.emptyTitle)
    expect(box.textContent).toContain('token limit')
  })

  it('the model only thought: the reason stands at the thoughts, with the one tap that answers without thinking', () => {
    const reason = emptyAnswerExplanation({ finishReason: 'length', captured: true, keepThinking: true })
    show(answer({ content: reason, thinking: 'Step one. Step two.', finishReason: 'length' }))
    expect(screen.queryByTestId('m-chat-answer')).toBeNull()
    expect(screen.queryByTestId('m-chat-error')).toBeNull()
    expect(screen.getByTestId('m-chat-thought-only').textContent).toContain('token budget')
    expect(screen.getByTestId('m-chat-answer-no-thinking')).toBeTruthy()
  })

  it('an agent run that lost the model: the part that arrived is the answer, the rest is the box', () => {
    const lost = PLATFORM_TEXTS.agentBackendLost.mobile.replace('{details}', 'error sending request')
    show(answer({ content: `I looked it up.\n\n${lost}` }))
    expect(screen.getByTestId('m-chat-answer').textContent).toBe('I looked it up.')
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.engineTitle)
  })

  it('"Agent error: ..." is the box and not a line of the answer', () => {
    show(answer({ content: 'Half a plan.\n\nAgent error: something odd' }))
    expect(screen.getByTestId('m-chat-answer').textContent).toBe('Half a plan.')
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.genericTitle)
    expect(box.textContent).toContain('something odd')
    expect(box.textContent).not.toContain('Agent error')
  })
})
