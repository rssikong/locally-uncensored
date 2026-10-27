import { describe, expect, it } from 'vitest'
import type { Conversation, Message } from '../../../../types/chat'
import { chatTitle, matchChats, phoneChats, plainExcerpt, plainLine, previewLine, relativeTime, shownText } from '../parts/logic/chat-list'

let n = 0
function msg(role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  n += 1
  return { id: `m${n}`, role, content, timestamp: n, ...extra } as Message
}
function chat(id: string, title: string, messages: Message[], extra: Partial<Conversation> = {}): Conversation {
  return { id, title, messages, model: 'x', systemPrompt: '', createdAt: 1, updatedAt: 1, ...extra } as Conversation
}

describe('phoneChats', () => {
  it('keeps plain chats, newest first, and leaves remote and agent modes out', () => {
    const list = [chat('a', 'A', [], { updatedAt: 1 }), chat('b', 'B', [], { updatedAt: 5 }), chat('c', 'C', [], { updatedAt: 3, mode: 'codex' as Conversation['mode'] }), chat('d', 'D', [], { updatedAt: 2, mode: 'lu' as Conversation['mode'] })]
    expect(phoneChats(list).map((c) => c.id)).toEqual(['b', 'd', 'a'])
  })
})

describe('shownText', () => {
  it('shows what the user typed, not the expanded text the model got', () => {
    expect(shownText({ role: 'user', content: 'long expanded', displayContent: '/commit' })).toBe('/commit')
    expect(shownText({ role: 'assistant', content: 'answer', displayContent: 'never' })).toBe('answer')
  })
})

describe('matchChats', () => {
  const list = [
    chat('a', 'Trip to Rome', [msg('user', 'Where to eat pasta'), msg('assistant', 'Try Trastevere')]),
    chat('b', 'Tax notes', [msg('user', 'What is deductible'), msg('system', 'Rome is hidden here'), msg('assistant', 'secret pasta', { hidden: true })]),
  ]
  it('keeps everything for an empty search', () => {
    expect(matchChats(list, '   ')).toHaveLength(2)
  })
  it('finds a word in the title or in the content, without regard to case', () => {
    expect(matchChats(list, 'ROME').map((c) => c.id)).toEqual(['a'])
    expect(matchChats(list, 'deductible').map((c) => c.id)).toEqual(['b'])
  })
  it('needs every word', () => {
    expect(matchChats(list, 'rome pasta').map((c) => c.id)).toEqual(['a'])
    expect(matchChats(list, 'rome deductible')).toEqual([])
  })
  it('does not search hidden messages and system lines', () => {
    expect(matchChats(list, 'secret')).toEqual([])
  })
})

describe('plainLine and previewLine', () => {
  it('takes the first line with content and drops the marks', () => {
    expect(plainLine('\n\n## **Hello** `world`\nmore')).toBe('Hello world')
    expect(plainLine('```js\ncode\n```')).toBe('code')
    expect(plainLine('- [a link](https://example.com) here')).toBe('a link here')
    expect(plainLine('   ')).toBe('')
  })
  it('prefers the last answer, without its error tail', () => {
    const c = chat('a', 'A', [msg('user', 'Hi'), msg('assistant', 'First answer\n\nError: network'), msg('user', 'Again')])
    expect(previewLine(c)).toBe('First answer')
  })
  it('never shows the raw error of a failed answer', () => {
    expect(previewLine(chat('a', 'A', [msg('user', 'Hello phone'), msg('assistant', 'Error: The on device engine is not running.')]))).toBe('Hello phone')
    expect(previewLine(chat('a', 'A', [msg('assistant', 'Error: nothing')]))).toBe('No messages yet')
  })
  it('falls back to the last message of the user, then to what was attached', () => {
    expect(previewLine(chat('a', 'A', [msg('user', 'Only me')]))).toBe('Only me')
    expect(previewLine(chat('a', 'A', [msg('user', '', { images: [{ data: 'x', mimeType: 'image/png', name: 'p.png' }] } as Partial<Message>)]))).toBe('Photo')
    expect(previewLine(chat('a', 'A', []))).toBe('No messages yet')
  })
})

describe('relativeTime', () => {
  const now = new Date(2026, 9, 8, 15, 0, 0).getTime()
  it('reads from seconds to years', () => {
    expect(relativeTime(now - 20_000, now)).toBe('Just now')
    expect(relativeTime(now - 12 * 60_000, now)).toBe('12 min ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(relativeTime(new Date(2026, 9, 7, 23, 0, 0).getTime(), now)).toBe('Yesterday')
    expect(relativeTime(new Date(2026, 9, 4, 9, 0, 0).getTime(), now)).toBe('4 Oct')
    expect(relativeTime(new Date(2025, 9, 4, 9, 0, 0).getTime(), now)).toBe('4 Oct 2025')
  })
})

describe('chatTitle', () => {
  it('is never empty', () => {
    expect(chatTitle({ title: '  ' })).toBe('New chat')
    expect(chatTitle(undefined)).toBe('New chat')
    expect(chatTitle({ title: ' Plans ' })).toBe('Plans')
  })
})

describe('plainExcerpt', () => {
  it('reads as text: no heading marks, no table rules, no fences', () => {
    const text = ['## Tides', 'The **moon** pulls.', '', '| Body | Pull |', '|---|---|', '| Moon | strong |', '', '```py', 'x = 1', '```'].join('\n')
    expect(plainExcerpt(text)).toBe('Tides The moon pulls. Body, Pull Moon, strong x = 1')
  })
  it('is cut with three dots', () => {
    expect(plainExcerpt('word '.repeat(100), 20)).toBe('word word word word...')
  })
})
