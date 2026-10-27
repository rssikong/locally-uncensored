// @vitest-environment jsdom
/**
 * Short check on the iPhone, package 8, B2: the user chose another model
 * while an answer was written. The answer stops, which is right, but the
 * chat said "The model on this phone was interrupted before the end", as if
 * something had gone wrong. It now says what happened.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/switched-under-answer.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

const place = vi.hoisted(() => ({ of: 'device' as 'device' | 'cloud' | 'own' }))
vi.mock('../../../lib/model-place', () => ({
  modelPlace: () => place.of,
  isDeviceModel: () => place.of === 'device',
  leavesPhone: () => place.of !== 'device',
}))
vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, type MessageHandlers } from '../parts/MessageItem'
import { SWITCHED_KEY, SWITCHED_MAX, __resetSwitchNoteForTests, cutsNear, deviceAnswersInProgress, installSwitchNote, noteModelSwitch, stoppedBySwitch } from '../parts/switched-under-answer'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import { useChatStore } from '../../../../stores/chatStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { useModelStore } from '../../../../stores/modelStore'
import type { Message } from '../../../../types/chat'

const noop = () => undefined
const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: noop, answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
const answer = (over: Partial<Message>): Message => ({ id: 'a1', role: 'assistant', content: 'Half an answer', timestamp: 2, modelId: 'Qwen3-1.7B', ...over }) as Message
const show = (message: Message) => render(<MessageItem chatId="c1" message={message} handlers={handlers} last streaming={false} continues />)
const chat = (id: string, last: Partial<Message>) => ({ id, title: id, model: 'Qwen3-1.7B', systemPrompt: '', createdAt: 1, updatedAt: 1, messages: [{ id: `${id}-q`, role: 'user', content: 'q', timestamp: 1 }, answer(last)] })

beforeEach(() => {
  place.of = 'device'
  localStorage.clear()
  __resetSwitchNoteForTests()
  useGenerationStore.setState({ generating: {} })
  useChatStore.setState({ conversations: [] } as never)
  useModelStore.setState({ activeModel: 'Qwen3-1.7B' })
})
afterEach(cleanup)

describe('an answer that stopped because the user switched models', () => {
  it('pure: only the last answer of a chat that is being written, and only of a model on this phone', () => {
    const chats = [chat('c1', { id: 'a1' }), chat('c2', { id: 'a2' }), chat('c3', { id: 'a3', modelId: 'cloud-model' }), { id: 'c4', messages: [{ id: 'q4', role: 'user' }] }]
    const onDevice = (model: string | undefined) => model !== 'cloud-model'
    expect(deviceAnswersInProgress({ c1: true, c3: true, c4: true }, chats, onDevice)).toEqual(['a1'])
    expect(deviceAnswersInProgress({}, chats, onDevice)).toEqual([])
  })

  it('the change of the chosen model notes the running answer, and the note survives the end of the app', () => {
    installSwitchNote()
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' }), chat('c2', { id: 'a2' })] } as never)
    useGenerationStore.setState({ generating: { c1: true } })
    useModelStore.setState({ activeModel: 'Qwen3.5-0.8B' })
    expect(stoppedBySwitch('a1')).toBe(true)
    expect(stoppedBySwitch('a2')).toBe(false)
    expect(JSON.parse(localStorage.getItem(SWITCHED_KEY) ?? '[]')).toEqual(['a1'])
    __resetSwitchNoteForTests()
    expect(stoppedBySwitch('a1')).toBe(true)
  })

  it('a change while nothing is written notes nothing', () => {
    installSwitchNote()
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' })] } as never)
    useModelStore.setState({ activeModel: 'Another' })
    expect(stoppedBySwitch('a1')).toBe(false)
    expect(localStorage.getItem(SWITCHED_KEY)).toBeNull()
  })

  it('the chat says what happened, in the box and in the small line, and keeps the way on', () => {
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' })] } as never)
    useGenerationStore.setState({ generating: { c1: true } })
    expect(noteModelSwitch()).toEqual(['a1'])
    show(answer({ finishReason: 'disconnect' }))
    expect(screen.getByTestId('m-chat-cut').textContent).toBe(S.message.cutSwitched)
    const box = screen.getByTestId('m-chat-error')
    expect(box.textContent).toContain(S.errors.switchedTitle)
    expect(box.textContent).not.toContain('interrupted')
    expect(screen.getByTestId('m-chat-error-action').textContent).toBe(S.errors.continue)
  })

  it('an answer the chat run itself saved as stopped by a switch says so without a note (package 10)', () => {
    show(answer({ finishReason: 'model_switch' }))
    expect(screen.getByTestId('m-chat-cut').textContent).toBe(S.message.cutSwitched)
    expect(screen.queryByTestId('m-chat-error')?.textContent ?? '').not.toContain('interrupted')
  })

  it('a note written after the bubble was drawn draws it again (B2, round 24)', () => {
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' })] } as never)
    useGenerationStore.setState({ generating: { c1: true } })
    show(answer({ finishReason: 'disconnect' }))
    expect(screen.getByTestId('m-chat-cut').textContent).toBe(S.message.cutDevice)
    act(() => {
      noteModelSwitch()
    })
    expect(screen.getByTestId('m-chat-cut').textContent).toBe(S.message.cutSwitched)
  })

  it('the stream breaks first and the model change follows within moments: still said as a switch', () => {
    installSwitchNote()
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' })] } as never)
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1', finishReason: 'disconnect' })] } as never)
    expect(stoppedBySwitch('a1')).toBe(false)
    useModelStore.setState({ activeModel: 'Qwen3.5-0.8B' })
    expect(stoppedBySwitch('a1')).toBe(true)
  })

  it('the model change first and the break after: said as a switch as well', () => {
    installSwitchNote()
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' })] } as never)
    useModelStore.setState({ activeModel: 'Qwen3.5-0.8B' })
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1', finishReason: 'disconnect' })] } as never)
    expect(stoppedBySwitch('a1')).toBe(true)
  })

  it('a break long before the model change is not the user\'s doing', () => {
    expect(cutsNear(new Map([['a1', 1000]]), 1000 + 60_000)).toEqual([])
    expect(cutsNear(new Map([['a1', 1000]]), 1000 + 1500)).toEqual(['a1'])
  })

  it('an answer the engine dropped by itself keeps its sentence', () => {
    show(answer({ id: 'other', finishReason: 'disconnect' }))
    expect(screen.getByTestId('m-chat-cut').textContent).toBe(S.message.cutDevice)
    expect(screen.getByTestId('m-chat-error').textContent).toContain(S.errors.deviceStoppedTitle)
  })

  it('an answer that is written on is a new run: its note goes', () => {
    installSwitchNote()
    useChatStore.setState({ conversations: [chat('c1', { id: 'a1' })] } as never)
    useGenerationStore.setState({ generating: { c1: true } })
    noteModelSwitch()
    useGenerationStore.setState({ generating: {} })
    expect(stoppedBySwitch('a1')).toBe(true)
    // Continue: the same answer is written on.
    useGenerationStore.setState({ generating: { c1: true } })
    expect(stoppedBySwitch('a1')).toBe(false)
  })

  it('keeps only the latest notes', () => {
    for (let i = 0; i < SWITCHED_MAX + 5; i++) {
      useChatStore.setState({ conversations: [chat('c1', { id: `a${i}` })] } as never)
      useGenerationStore.setState({ generating: { c1: true } })
      noteModelSwitch()
    }
    expect(JSON.parse(localStorage.getItem(SWITCHED_KEY) ?? '[]')).toHaveLength(SWITCHED_MAX)
    expect(stoppedBySwitch('a0')).toBe(false)
    expect(stoppedBySwitch(`a${SWITCHED_MAX + 4}`)).toBe(true)
  })

  it('the sentences are English and carry no dashes', () => {
    for (const text of [S.message.cutSwitched, S.errors.switchedTitle]) expect(text).not.toMatch(/[–—]/)
  })
})
