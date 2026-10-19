/**
 * @vitest-environment jsdom
 *
 * Issue 160: with a thinking model the answer looked clean, but read-aloud
 * pronounced reasoning markers that stood nowhere on the screen. The bubble
 * cleaned the stored text before it rendered it, the voice got the stored text
 * itself. Both take it from lib/shown-answer.ts now.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, fireEvent } from '@testing-library/react'
import type { Message } from '../../types/chat'
import type { AgentBlock } from '../../types/agent-mode'
import { GEMMA4_ANSWER, GEMMA4_STREAM, GEMMA4_THOUGHT } from './fixtures/gemma4-thinking-stream'

const spoken: string[] = []
vi.mock('../../hooks/useVoice', () => ({
  useVoice: () => ({
    isSpeaking: false,
    ttsSupported: true,
    ttsAvailable: true,
    ttsExternalReady: false,
    ttsEnabled: true,
    speakTextStreaming: (text: string) => { spoken.push(text) },
    stopSpeaking: () => {},
  }),
}))

import { MessageBubble } from '../../components/chat/MessageBubble'
import { shownAnswer } from '../shown-answer'
import { settleThinking, stripNonCanonicalTags } from '../thinking-stripper'
import { autoSpeak, registerAutoSpeak } from '../ttsBridge'
import { useChatStore } from '../../stores/chatStore'
import { useAgentModeStore } from '../../stores/agentModeStore'

const msg = (content: string, agentBlocks?: AgentBlock[]): Message =>
  ({ id: 'm1', role: 'assistant', content, timestamp: 1, agentBlocks }) as Message

const answerBlock = (id: string, content: string, timestamp: number): AgentBlock =>
  ({ id, phase: 'answer', content, timestamp })

/** Renders the bubble, presses Read aloud, returns what was shown and what was spoken. */
function readAloud(message: Message) {
  const { container, getByLabelText } = render(createElement(MessageBubble, { message, isLast: true }))
  fireEvent.click(getByLabelText('Read aloud'))
  return { shown: container.querySelector('.markdown-content')?.textContent ?? '', said: spoken.at(-1) ?? '' }
}

beforeEach(() => { spoken.length = 0 })
afterEach(() => cleanup())

describe('the Read aloud button', () => {
  it('speaks no marker the bubble does not show', () => {
    // What a server passes through when it does not know the template: the
    // answer between control tokens.
    const stored = '<|start|>assistant<|message|>Lighter evenings are the main reason.<|end|>'
    const { shown, said } = readAloud(msg(stored))
    expect(shown).toBe('assistantLighter evenings are the main reason.')
    expect(said).toBe(shown)
    expect(said).not.toMatch(/[<|>]/)
  })

  it('speaks no Gemma thought and none of its markers', () => {
    const { shown, said } = readAloud(msg(GEMMA4_STREAM.join('')))
    expect(shown).toBe(GEMMA4_ANSWER.replace(/\*\*/g, ''))
    expect(said).toBe(GEMMA4_ANSWER)
    expect(said).not.toContain('channel')
    expect(said).not.toContain('The user asks')
  })

  it('speaks the closing answer block of a tool turn, cleaned like the bubble cleans it', () => {
    const message = msg('Done. LOOP text that is never shown', [
      answerBlock('a1', 'I will look the file up first.', 10),
      answerBlock('a2', 'The file has 12 lines.\nLOOP_DONE (verified by reading it)', 20),
    ])
    const { said } = readAloud(message)
    expect(said).toBe('The file has 12 lines.')
  })

  it('NEGATIVE CONTROL: an answer without markers is spoken as written', () => {
    const { said } = readAloud(msg('Three is < four, and `a | b` is a pipe.'))
    expect(said).toBe('Three is < four, and `a | b` is a pipe.')
  })
})

describe('auto-read of a finished answer', () => {
  const heard: string[] = []
  beforeEach(() => {
    heard.length = 0
    registerAutoSpeak((text) => { heard.push(text) })
    useAgentModeStore.setState({ agentModeActive: {} })
  })

  const store = (message: Message) =>
    useChatStore.setState({
      conversations: [{ id: 'c1', title: 't', messages: [message], createdAt: 1, updatedAt: 1 }],
    } as never)

  it('speaks the stored turn the way its bubble shows it', () => {
    store(msg('<|channel|>final<|message|>Lighter evenings.<|return|>'))
    autoSpeak('c1', 'm1')
    expect(heard).toEqual([shownAnswer(msg('<|channel|>final<|message|>Lighter evenings.<|return|>'), false).spoken])
    expect(heard[0]).toBe('finalLighter evenings.')
  })

  it('uses the tool-loop tier when the agent drives the conversation', () => {
    const leak = 'Saved.\n```json\n{"name": "file_write", "arguments": {"path": "a.js", "content": "x"}}\n```'
    store(msg(leak))
    autoSpeak('c1', 'm1')
    expect(heard.at(-1)).toContain('file_write')
    useAgentModeStore.setState({ agentModeActive: { c1: true } })
    autoSpeak('c1', 'm1')
    expect(heard.at(-1)).toBe('Saved.')
  })

  it('stays silent when the turn holds nothing but markers, or is gone', () => {
    store(msg('<|channel>thought\nstill thinking'))
    autoSpeak('c1', 'm1')
    autoSpeak('c1', 'nope')
    expect(heard).toEqual([])
  })
})

describe('a Gemma 4 stream, piece by piece', () => {
  it('never offers a half thought as the answer while it arrives', () => {
    let wire = ''
    for (const piece of GEMMA4_STREAM) {
      wire += piece
      // useChat writes this into the bubble on every frame.
      const { spoken: text } = shownAnswer({ content: stripNonCanonicalTags(wire) }, false)
      expect(GEMMA4_ANSWER.startsWith(text), JSON.stringify(text)).toBe(true)
    }
  })

  it('settles into the answer, with the thought in the thinking block when it is wanted', () => {
    const wire = GEMMA4_STREAM.join('')
    const kept = settleThinking(wire, '', true)
    expect(kept).toEqual({ content: GEMMA4_ANSWER, thinking: GEMMA4_THOUGHT })
    expect(settleThinking(wire, '', false)).toEqual({ content: GEMMA4_ANSWER, thinking: '' })
    expect(shownAnswer({ content: kept.content }, false).spoken).toBe(GEMMA4_ANSWER)
  })

  it('a turn cut off inside the thought has no answer to read', () => {
    const cut = GEMMA4_STREAM.slice(0, 5).join('')
    const settled = settleThinking(cut, '', true)
    expect(settled.content).toBe('')
    expect(settled.thinking).toContain('The user asks')
    expect(shownAnswer({ content: cut }, false).spoken).toBe('')
  })
})
