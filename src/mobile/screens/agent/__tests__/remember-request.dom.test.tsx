// @vitest-environment jsdom
/**
 * Round 6, acceptance on Android with 8 GB, B8: "Remember this" in a chat
 * left nothing on the Memory page while the model said "I have noted".
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/remember-request.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

import { MessageBlocks } from '../MessageBlocks'
import { keepRememberRequest, questionOf, rememberOutcome, rememberRequest } from '../parts/remember-request'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { useChatStore } from '../../../../stores/chatStore'
import { useGenerationStore } from '../../../../stores/generationStore'
import { useMemoryStore } from '../../../../stores/memoryStore'
import type { Conversation, Message } from '../../../../types/chat'

const fact = (text: string) => rememberRequest(text)?.fact

describe('which messages ask to remember something', () => {
  it('the sentence of the acceptance run', () => {
    expect(rememberRequest('Please remember this about me: my dog is called Pixel and I live in Tromso.')).toEqual({
      fact: 'My dog is called Pixel and I live in Tromso.',
    })
  })

  it('the usual ways to say it', () => {
    expect(fact('Remember that my sister is called Ana.')).toBe('My sister is called Ana.')
    expect(fact('remember: I am allergic to peanuts')).toBe('I am allergic to peanuts')
    expect(fact('Can you remember that I work night shifts')).toBe('I work night shifts')
    expect(fact('Please remember my favourite colour is green.')).toBe('My favourite colour is green.')
    expect(fact("Don't forget that I prefer short answers.")).toBe('I prefer short answers.')
    expect(fact('Keep in mind: we use metric units.')).toBe('We use metric units.')
    expect(fact('Note for later: the wifi code is on the fridge')).toBe('The wifi code is on the fridge')
    expect(fact('Hey, please remember this - I am vegetarian')).toBe('I am vegetarian')
    expect(fact('I moved to Bergen last week. Please remember that.')).toBe('I moved to Bergen last week')
    expect(fact('Save this to memory: my car is a blue Volvo')).toBe('My car is a blue Volvo')
  })

  it('in German as well', () => {
    expect(fact('Merk dir: ich wohne in Hamburg')).toBe('Ich wohne in Hamburg')
    expect(fact('Bitte merke dir, dass mein Hund Pixel heisst.')).toBe('Mein Hund Pixel heisst.')
  })

  it('a request that names nothing is known as one', () => {
    for (const text of ['Remember that.', 'Please remember this', 'remember it please', 'Can you remember this for later?'.replace('?', ''), 'Merk dir das.']) {
      expect(rememberRequest(text), text).toEqual({ fact: null })
    }
  })

  it('questions, recollections, reminders and everything else stay normal messages', () => {
    for (const text of [
      'Do you remember my dog?',
      'What do you remember about me?',
      'Remember when we talked about Iceland?',
      'Remember to buy milk',
      "Don't forget to call me",
      'I can never remember that formula.',
      'Write a poem about memory.',
      'How do I remember things better?',
      'Remember: yes?',
      'Note: answer in French from now on',
      'Save: the file as notes.md',
      'Note the difference between the two.',
      'ok',
      '',
    ]) {
      expect(rememberRequest(text), text).toBeNull()
    }
  })

  it('a long text behind "remember" is a text to work on, not a fact', () => {
    expect(rememberRequest(`Remember this: ${'word '.repeat(200)}`)).toBeNull()
  })
})

const CHAT = 'c1'
const msg = (over: Partial<Message>): Message => ({ id: 'x', role: 'user', content: '', timestamp: 1, ...over }) as Message

function seed(messages: Message[]) {
  useChatStore.setState({ conversations: [{ id: CHAT, title: 'T', messages, createdAt: 1, updatedAt: 1 } as unknown as Conversation], activeConversationId: CHAT })
}

beforeEach(() => {
  useMemoryStore.setState({ entries: [] })
  useGenerationStore.setState({ generating: {} })
})
afterEach(cleanup)

describe('the request is kept before the message goes out', () => {
  it('saves the fact as a memory about the user, once', () => {
    seed([])
    keepRememberRequest('Please remember this about me: my dog is called Pixel and I live in Tromso.', CHAT)
    keepRememberRequest('Please remember this about me: my dog is called Pixel and I live in Tromso.', CHAT)
    const entries = useMemoryStore.getState().entries
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ type: 'user', source: 'manual', content: 'My dog is called Pixel and I live in Tromso.', title: 'My dog is called Pixel and I live in Tromso.' })
  })

  it('saves nothing for a normal message and for a request that names nothing', () => {
    keepRememberRequest('What is the capital of Iceland?', CHAT)
    keepRememberRequest('Remember that.', CHAT)
    keepRememberRequest('Do you remember my dog?', null)
    expect(useMemoryStore.getState().entries).toHaveLength(0)
  })

  it('a memory of a project chat lands in that project', () => {
    useChatStore.setState({ conversations: [{ id: CHAT, title: 'T', messages: [], createdAt: 1, updatedAt: 1, memoryScope: 'project-7' } as unknown as Conversation] })
    keepRememberRequest('Remember that the deadline is in March.', CHAT)
    expect(useMemoryStore.getState().entries[0]).toMatchObject({ scope: 'project-7', content: 'The deadline is in March.' })
  })
})

describe('the line under the answer', () => {
  const question = msg({ id: 'q', role: 'user', content: 'Please remember this about me: my dog is called Pixel and I live in Tromso.' })
  const reply = msg({ id: 'a', role: 'assistant', content: 'I have noted that your dog is called Pixel.' })

  it('says "Saved to Memory." when the memory is there', () => {
    seed([question, reply])
    keepRememberRequest(question.content, CHAT)
    render(<MessageBlocks chatId={CHAT} message={reply} position="after" />)
    const line = screen.getByTestId('m-chat-remembered')
    expect(line.textContent).toBe(T.tools.rememberSaved)
    expect(line.getAttribute('data-state')).toBe('saved')
  })

  it('says that nothing was saved when the request named nothing, whatever the model claims', () => {
    const bare = msg({ id: 'q', role: 'user', content: 'Remember that.' })
    seed([bare, reply])
    render(<MessageBlocks chatId={CHAT} message={reply} position="after" />)
    const line = screen.getByTestId('m-chat-remembered')
    expect(line.textContent).toBe(T.tools.rememberNothing)
    expect(line.getAttribute('data-state')).toBe('nothing')
  })

  it('is absent under every other answer, while the answer is written, and once the memory was deleted', () => {
    seed([msg({ id: 'q', role: 'user', content: 'What is the capital of Iceland?' }), reply])
    render(<MessageBlocks chatId={CHAT} message={reply} position="after" />)
    expect(screen.queryByTestId('m-chat-remembered')).toBeNull()
    cleanup()

    seed([question, reply])
    keepRememberRequest(question.content, CHAT)
    useGenerationStore.setState({ generating: { [CHAT]: true } })
    render(<MessageBlocks chatId={CHAT} message={reply} position="after" />)
    expect(screen.queryByTestId('m-chat-remembered')).toBeNull()
    cleanup()

    useGenerationStore.setState({ generating: {} })
    useMemoryStore.setState({ entries: [] })
    render(<MessageBlocks chatId={CHAT} message={reply} position="after" />)
    expect(screen.queryByTestId('m-chat-remembered')).toBeNull()
  })

  it('belongs to the answer right behind the request, not to later ones', () => {
    const later = msg({ id: 'a2', role: 'assistant', content: 'Reykjavik.' })
    const messages = [question, msg({ id: 't', role: 'tool', content: 'x', hidden: true }), reply, msg({ id: 'q2', role: 'user', content: 'Capital of Iceland?' }), later]
    expect(questionOf(messages, 'a')?.id).toBe('q')
    expect(questionOf(messages, 'a2')?.id).toBe('q2')
    expect(rememberOutcome(questionOf(messages, 'a2'))).toBeNull()
  })

  it('the two sentences are English and carry no dashes', () => {
    for (const text of [T.tools.rememberSaved, T.tools.rememberNothing]) expect(text).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('the chat page asks before both of its sends', () => {
  it('ChatPage.tsx calls keepRememberRequest in front of each sendMessage of a typed message', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const page = readFileSync(resolve(__dirname, '../../chat/ChatPage.tsx'), 'utf8')
    expect(page.match(/keepRememberRequest\(/g)?.length).toBe(2)
    expect(page).toMatch(/keepRememberRequest\(text, chatId\)\s+void live\.current\.chat\.sendMessage\(text\.trim\(\)/)
    expect(page).toMatch(/keepRememberRequest\(waiting\.text, chatId\)\s+void chat\.sendMessage\(waiting\.text/)
  })
})
