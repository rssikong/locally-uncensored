// @vitest-environment jsdom
/**
 * Check on the iPhone, round 23, N16: an answer whose stored text is not empty but draws nothing was a blank
 * bubble with only "Report" and "More". It is an empty answer and says so.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/blank-answer.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, type MessageHandlers } from '../parts/MessageItem'
import { holdsVisibleText } from '../parts/blank-answer'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import type { Message } from '../../../../types/chat'

afterEach(cleanup)

const noop = () => undefined
const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: noop, answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
const answer = (content: string): Message => ({ id: 'a1', role: 'assistant', content, timestamp: 2, modelId: 'Qwen3.5-2B' }) as Message
const show = (content: string, last = true) => render(<MessageItem chatId="c1" message={answer(content)} handlers={handlers} last={last} streaming={false} reportable />)

describe('an answer that draws nothing', () => {
  it('pure: blanks and characters without a width are nothing, a word or a digit is something', () => {
    expect(holdsVisibleText('​‌ \n﻿')).toBe(false)
    expect(holdsVisibleText('  ')).toBe(false)
    expect(holdsVisibleText('4')).toBe(true)
    expect(holdsVisibleText('​4')).toBe(true)
  })

  it.each([['zero width characters', '​​'], ['a byte order mark and blanks', '﻿ \n ']])('%s: the chat says the model returned nothing', (_name, content) => {
    show(content)
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.emptyTitle)
    expect(screen.getByTestId('m-chat-error-action')).toBeTruthy()
    expect(screen.queryByTestId('m-chat-report')).toBeNull()
  })

  it('an earlier blank answer gets its word too, and a real answer is left alone', () => {
    show('​', false)
    expect(screen.getByTestId('m-chat-empty-earlier')).toBeTruthy()
    cleanup()
    show('Yellow.')
    expect(screen.queryByTestId('m-chat-error')).toBeNull()
    expect(screen.getByTestId('m-chat-answer').textContent).toContain('Yellow.')
  })

  it('Markdown that is drawn without a word (a link with no text) is an empty answer as well', () => {
    show('[](https://example.com)')
    expect(screen.queryByTestId('m-chat-report')).toBeNull()
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.emptyTitle)
  })
})
