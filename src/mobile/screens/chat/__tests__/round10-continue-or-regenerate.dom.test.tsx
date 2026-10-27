// @vitest-environment jsdom
/**
 * Round 10: the box under a cut answer says what its button does.
 *
 * "Continue" only where the answer really goes on: the engine of this phone
 * writes on inside it (lib/continue-answer.ts). For LU Cloud, a provider
 * with an own key, an agent run and a group chat the button is "Regenerate",
 * and the text says that the answer is written again.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round10-continue-or-regenerate.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, type MessageHandlers } from '../parts/MessageItem'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import type { Message } from '../../../../types/chat'

const noop = () => undefined
const cut = (over: Partial<Message> = {}): Message =>
  ({ id: 'm1', role: 'assistant', content: 'Lighthouses guide ships navigating the', timestamp: 1, modelId: 'openai::qwen3-1.7b', finishReason: 'interrupted', ...over }) as Message

function show(message: Message, continues: boolean | undefined) {
  const tapped: string[] = []
  const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: (m) => tapped.push(m.id), answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
  render(<MessageItem chatId="c1" message={message} handlers={handlers} last continues={continues} />)
  return tapped
}

afterEach(cleanup)

describe('the box under an answer that was cut', () => {
  it('where the answer goes on in place: "Continue", and the text says so', () => {
    const tapped = show(cut(), true)
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe('Continue')
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.interruptedText)
    fireEvent.click(screen.getByTestId('m-chat-error-action'))
    expect(tapped).toEqual(['m1'])
  })

  it('where it cannot: "Regenerate", and the text says that the answer is written again', () => {
    show(cut({ modelId: 'lu-cloud::zai-org/GLM-5.3' }), false)
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe('Regenerate')
    const box = screen.getByTestId('m-chat-error').textContent ?? ''
    expect(box).toContain('Regenerate writes the answer again.')
    expect(box).not.toContain('Continue')
  })

  it('a page that does not say: "Regenerate", never a "Continue" that might start over', () => {
    show(cut(), undefined)
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe('Regenerate')
  })

  it('only thoughts arrived: there is nothing to go on from, also with the engine of the phone', () => {
    show(cut({ content: '', thinking: 'Let me think about lighthouses.' }), true)
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe('Regenerate')
  })

  it('nothing arrived: "Ask again", as before', () => {
    show(cut({ content: '' }), true)
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe('Ask again')
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.interruptedNothing)
  })

  it('no text has a long dash', () => {
    for (const text of [S.errors.interruptedText, S.errors.interruptedRegenerate, S.errors.regenerate]) expect(text).not.toMatch(/[\u2013\u2014]/)
  })
})
