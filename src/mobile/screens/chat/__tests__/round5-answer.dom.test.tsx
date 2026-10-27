// @vitest-environment jsdom
/**
 * Round 5, the answer in the chat.
 *
 * N2  An answer of a model on this phone whose stream broke said "The
 *     connection dropped ... Check the connection". Nothing leaves the phone
 *     there, so the box says what is true. A cloud answer keeps its sentence.
 * N7  An answer that waits for a document that is still being read says so,
 *     in the answer itself.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round5-answer.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const place = vi.hoisted(() => ({ of: 'device' as 'device' | 'cloud' | 'own' }))
vi.mock('../../../lib/model-place', () => ({
  modelPlace: () => place.of,
  isDeviceModel: () => place.of === 'device',
  leavesPhone: () => place.of !== 'device',
}))
vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, type MessageHandlers } from '../parts/MessageItem'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import { DISCONNECT_WITHOUT_ANSWER } from '../../../../lib/answer-notes'
import { __resetModelSlotForTests, beginDocumentJob } from '../../../../lib/model-slot'
import type { Message } from '../../../../types/chat'

const noop = () => undefined
const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: noop, answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
const answer = (over: Partial<Message>): Message => ({ id: 'm1', role: 'assistant', content: '', timestamp: 1, modelId: 'SmolLM2-360M', ...over }) as Message
const show = (message: Message, streaming = false) => render(<MessageItem chatId="c1" message={message} handlers={handlers} last streaming={streaming} />)

beforeEach(() => {
  place.of = 'device'
  __resetModelSlotForTests()
})
afterEach(cleanup)

describe('N2: a broken stream of a model on this phone', () => {
  it('with a part of the answer: the box speaks of the model, not of a connection', () => {
    show(answer({ content: 'The opening hours are', error: { kind: 'network', detail: 'error sending request', at: 21 } }))
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.deviceStoppedTitle)
    // This chat cannot go on inside an answer (no `continues`): the button writes it again, and the sentence says so.
    expect(box.textContent).toContain(S.errors.deviceStoppedAgain)
    expect(box.textContent).not.toContain('is kept')
    expect(box.textContent).not.toMatch(/connection|network/i)
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe(S.errors.tryAgain)
    expect(screen.getByTestId('m-chat-answer').textContent).toContain('The opening hours are')
  })

  // Acceptance iPhone, second part, P3: "The part that arrived is kept." stood over a button that threw that part away.
  it('with a part, in a chat that can go on inside an answer: the button is Continue and goes on, it does not ask again', () => {
    const calls: string[] = []
    const watched: MessageHandlers = { ...handlers, continueAnswer: () => void calls.push('continue'), regenerate: () => void calls.push('regenerate') }
    render(<MessageItem chatId="c1" message={answer({ content: 'The opening hours are', error: { kind: 'network', detail: 'error sending request', at: 21 } })} handlers={watched} last continues />)
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.deviceStoppedText)
    expect(S.errors.deviceStoppedText).toContain('The part that arrived is kept. Continue goes on from there.')
    const button = screen.getByTestId('m-chat-error-action')
    expect(button.textContent).toBe(S.errors.continue)
    fireEvent.click(button)
    expect(calls).toEqual(['continue'])
  })

  it('with nothing arrived: the box does not speak of a part', () => {
    show(answer({ content: '', error: { kind: 'network', detail: 'error sending request', at: 0 } }))
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.deviceStoppedNothing)
    expect(box.textContent).not.toContain('is kept')
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe(S.errors.tryAgain)
  })

  it('without any text: the sentence about the network the logic layer wrote is not shown either', () => {
    show(answer({ content: DISCONNECT_WITHOUT_ANSWER, finishReason: 'disconnect' }))
    expect(screen.getByTestId('m-chat-message').textContent).not.toMatch(/connection|network/i)
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.deviceStoppedTitle)
  })

  it('cut before the end: the small line under the answer names the model as well', () => {
    show(answer({ content: 'Half an answer', finishReason: 'disconnect' }))
    expect(screen.getByTestId('m-chat-cut').textContent).toBe(S.message.cutDevice)
  })

  it('an answer from LU Cloud keeps the sentence about the connection', () => {
    place.of = 'cloud'
    show(answer({ content: 'Half', error: { kind: 'network', detail: 'fetch failed', at: 4 } }))
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.networkTitle)
  })

  it('the sentences are English and carry no dashes', () => {
    for (const text of [S.errors.deviceStoppedTitle, S.errors.deviceStoppedText, S.message.cutDevice, S.message.waitsForDocument]) {
      expect(text).not.toMatch(/[\u2013\u2014]/)
    }
  })
})

describe('N7: an answer that waits for a document says so', () => {
  it('while the document is read the empty answer carries the hint, and loses it when the reading is done', () => {
    const end = beginDocumentJob()
    show(answer({}), true)
    expect(screen.getByTestId('m-chat-waits-for-document').textContent).toBe(S.message.waitsForDocument)
    act(() => end())
    expect(screen.queryByTestId('m-chat-waits-for-document')).toBeNull()
  })

  it('no reading, no hint; and an answer that already writes has none', () => {
    show(answer({}), true)
    expect(screen.queryByTestId('m-chat-waits-for-document')).toBeNull()
    cleanup()
    const end = beginDocumentJob()
    show(answer({ content: 'Monday to Friday' }), true)
    expect(screen.queryByTestId('m-chat-waits-for-document')).toBeNull()
    end()
  })
})
