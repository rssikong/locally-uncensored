// @vitest-environment jsdom
/**
 * Round 6, acceptance on Android 8 GB, find B4: a question sent while a long
 * document was read waited for minutes, and the answer only said that it
 * waits. Now the waiting answer names the file and how far the reading is,
 * so the wait has an end the user can see. Stop during the wait is held in
 * src/hooks/__tests__/useChat-stop-waehrend-dokument.test.ts.
 *
 * Run: npx vitest run src/mobile/screens/chat/__tests__/round6-waiting-answer.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../lib/model-place', () => ({ modelPlace: () => 'device', isDeviceModel: () => true, leavesPhone: () => false }))
vi.mock('../../agent/MessageBlocks', () => ({ MessageBlocks: () => null }))

import { MessageItem, waitsForOtherChat, type MessageHandlers } from '../parts/MessageItem'
import { documentLineText, waitingForDocumentText } from '../../agent/parts/slot-turn'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { CHAT_STRINGS as S } from '../../../strings/chat'
import { __resetModelSlotForTests, beginDocumentJob } from '../../../../lib/model-slot'
import { useRAGStore } from '../../../../stores/ragStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import type { Message } from '../../../../types/chat'

const noop = () => undefined
const handlers: MessageHandlers = { more: noop, copy: noop, regenerate: noop, speak: noop, report: noop, continueAnswer: noop, answerWithoutThinking: noop, newChat: noop, chooseModel: noop }
const waiting: Message = { id: 'm1', role: 'assistant', content: '', timestamp: 1, modelId: 'Qwen3-1.7B-Q4_K_M' } as Message
const show = () => render(<MessageItem chatId="c1" message={waiting} handlers={handlers} last streaming />)
const hint = () => screen.getByTestId('m-chat-waits-for-document').textContent

beforeEach(() => {
  __resetModelSlotForTests()
  useRAGStore.setState({ isIndexing: false, indexingProgress: null, pausedIndex: {}, ragEnabled: {}, documents: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
})
afterEach(cleanup)

describe('the sentence of an answer that waits for a document', () => {
  it('names the file and the share that is read, in whole percent', () => {
    expect(waitingForDocumentText({ name: 'club-minutes.txt', current: 108, total: 235 })).toBe('Reading club-minutes.txt, 45% done. The answer starts when it is done.')
    expect(waitingForDocumentText({ name: null, current: 1, total: 4 })).toBe('Reading a document, 25% done. The answer starts when it is done.')
  })

  it('never says 0 or 100 percent while it still waits', () => {
    expect(waitingForDocumentText({ name: 'a.txt', current: 1, total: 935 })).toContain('1% done')
    expect(waitingForDocumentText({ name: 'a.txt', current: 935, total: 935 })).toContain('99% done')
  })

  it('before the first passage is counted it names the file only, and without anything known it is the plain sentence', () => {
    expect(waitingForDocumentText({ name: 'a.txt', current: 0, total: 1 })).toBe('Reading a.txt. The answer starts when it is done.')
    expect(waitingForDocumentText({ name: null, current: 0, total: 0 })).toBe(S.message.waitsForDocument)
    expect(waitingForDocumentText(null)).toBe(S.message.waitsForDocument)
  })

  it('English, no dashes', () => {
    for (const text of [waitingForDocumentText({ name: 'a.txt', current: 1, total: 2 }), waitingForDocumentText({ name: 'a.txt', current: 0, total: 0 }), T.notices.docWaitingModel, T.documents.waitsForModel]) {
      expect(text).not.toMatch(/[–—]| - /)
    }
  })
})

describe('in the chat', () => {
  it('the waiting answer follows the reading, also one that was started in another chat', () => {
    const end = beginDocumentJob()
    useRAGStore.setState({ isIndexing: true, indexingProgress: { current: 0, total: 1 }, pausedIndex: { other: [{ id: 'ix1', name: 'club-minutes.txt', size: 93000, at: 1, state: 'running' }] } })
    show()
    expect(hint()).toBe('Reading club-minutes.txt. The answer starts when it is done.')
    act(() => useRAGStore.setState({ indexingProgress: { current: 47, total: 235 } }))
    expect(hint()).toBe('Reading club-minutes.txt, 20% done. The answer starts when it is done.')
    act(() => useRAGStore.setState({ indexingProgress: { current: 200, total: 235 } }))
    expect(hint()).toBe('Reading club-minutes.txt, 85% done. The answer starts when it is done.')
    act(() => end())
    expect(screen.queryByTestId('m-chat-waits-for-document')).toBeNull()
  })

  it('the hint stands in the answer, not in or above the input field', () => {
    const end = beginDocumentJob()
    show()
    expect(screen.getByTestId('m-chat-waits-for-document').closest('[data-testid="m-chat-message"]')).not.toBeNull()
    end()
  })
})

describe('the line in the chat for a reading that waits', () => {
  it('names what it waits for', () => {
    expect(documentLineText('idle', 'waiting-for-model')).toBe(T.notices.docWaitingModel)
    expect(documentLineText('idle', 'waiting-for-answer')).toBe(T.notices.docWaiting)
    expect(documentLineText('idle', 'reading')).toBe(T.notices.docReading)
    expect(documentLineText('idle', 'none')).toBeNull()
  })
})

// Round 9, N6 of the check on Android: chat B showed an empty bubble with a
// caret for 92 seconds while the model on the phone answered in chat A.
describe('an answer that waits for the answer of another chat', () => {
  const otherChat = () => screen.queryByTestId('m-chat-waits-for-chat')?.textContent ?? null
  const answering = (id: string, lane: 'local' | 'cloud') =>
    useGenerationStore.setState({ generating: { [id]: true }, runs: { [id]: { conversationId: id, lane, bookedAt: 1, runToken: {} } } })

  it('says so, and the sentence goes the moment the other answer is done', () => {
    answering('chat-a', 'local')
    show()
    expect(otherChat()).toBe('The model on this phone is answering in another chat. This answer starts when that one is done.')
    act(() => useGenerationStore.setState({ generating: {}, runs: {} }))
    expect(otherChat()).toBeNull()
  })

  it('not for the chat that is being answered itself, and not while a cloud model answers elsewhere', () => {
    answering('c1', 'local')
    show()
    expect(otherChat()).toBeNull()
    cleanup()
    answering('chat-a', 'cloud')
    show()
    expect(otherChat()).toBeNull()
  })

  it('a document that is being read has the more exact sentence, and only that one is shown', () => {
    const end = beginDocumentJob()
    answering('chat-a', 'local')
    show()
    expect(screen.getByTestId('m-chat-waits-for-document')).not.toBeNull()
    expect(otherChat()).toBeNull()
    end()
  })

  it('an answer that has begun says nothing about waiting', () => {
    answering('chat-a', 'local')
    render(<MessageItem chatId="c1" message={{ ...waiting, content: 'Rome.' }} handlers={handlers} last streaming />)
    expect(otherChat()).toBeNull()
  })

  it('pure: a cloud answer waits only when its chat has documents to search', () => {
    const generating = { a: true }
    const local = { a: { lane: 'local' } }
    expect(waitsForOtherChat('b', true, generating, local)).toBe(true)
    expect(waitsForOtherChat('b', false, generating, local)).toBe(false)
    expect(waitsForOtherChat('a', true, generating, local)).toBe(false)
    expect(waitsForOtherChat('b', true, generating, { a: { lane: 'cloud' } })).toBe(false)
    // A run of an older path that set the flag without booking a lane counts as one of this phone.
    expect(waitsForOtherChat('b', true, generating, {})).toBe(true)
    expect(waitsForOtherChat('b', true, { a: false }, local)).toBe(false)
  })

  it('English, no dashes', () => {
    expect(S.message.waitsForOtherChat).not.toMatch(/[\u2013\u2014]| - /)
  })
})
