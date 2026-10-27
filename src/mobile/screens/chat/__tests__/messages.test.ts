import { describe, expect, it } from 'vitest'
import type { Message } from '../../../../types/chat'
import { WINDOW_SIZE, chatFiles, contextLevel, contextPercent, decodeFileRef, encodeFileRef, formatClock, isAtBottom, lastAnswerId, messageText, visibleMessages, widenWindow, windowStart, type FileRef } from '../parts/logic/messages'

function msg(id: string, role: Message['role'], content: string, extra: Partial<Message> = {}): Message {
  return { id, role, content, timestamp: 1, ...extra } as Message
}

describe('visibleMessages', () => {
  it('drops hidden ones, tool results and plain system lines, keeps notices', () => {
    const list = [msg('a', 'user', 'hi'), msg('b', 'tool', 'result'), msg('c', 'system', 'prompt'), msg('d', 'system', 'note', { notice: 'info' } as Partial<Message>), msg('e', 'assistant', 'x', { hidden: true }), msg('f', 'assistant', 'answer')]
    expect(visibleMessages(list).map((m) => m.id)).toEqual(['a', 'd', 'f'])
  })
})

describe('the window of a long chat', () => {
  it('renders the end and widens by one step', () => {
    expect(windowStart(500, WINDOW_SIZE)).toBe(440)
    expect(windowStart(20, WINDOW_SIZE)).toBe(0)
    expect(windowStart(10, 0)).toBe(9)
    expect(widenWindow(500, 60)).toBe(120)
    expect(widenWindow(100, 60)).toBe(100)
  })
})

describe('isAtBottom', () => {
  it('counts a small distance to the end as the end', () => {
    expect(isAtBottom({ scrollTop: 900, clientHeight: 100, scrollHeight: 1000 })).toBe(true)
    expect(isAtBottom({ scrollTop: 840, clientHeight: 100, scrollHeight: 1000 })).toBe(true)
    expect(isAtBottom({ scrollTop: 700, clientHeight: 100, scrollHeight: 1000 })).toBe(false)
    expect(isAtBottom({ scrollTop: 899, clientHeight: 100, scrollHeight: 1000 }, 0)).toBe(false)
  })
})

describe('formatClock', () => {
  it('reads minutes, and hours only when there are some', () => {
    expect(formatClock(7_000)).toBe('0:07')
    expect(formatClock(760_000)).toBe('12:40')
    expect(formatClock(3_723_000)).toBe('1:02:03')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('messageText', () => {
  it('hands over the answer without its error tail and the text the user typed', () => {
    expect(messageText(msg('a', 'assistant', ' Part one \n\nError: fetch failed'))).toBe('Part one')
    expect(messageText(msg('b', 'user', 'expanded', { displayContent: ' /init ' }))).toBe('/init')
  })
})

describe('lastAnswerId', () => {
  it('is the answer after the last message of the user, else nothing', () => {
    expect(lastAnswerId([msg('a', 'user', 'q'), msg('b', 'assistant', 'r')])).toBe('b')
    expect(lastAnswerId([msg('a', 'assistant', 'r'), msg('b', 'user', 'q')])).toBeNull()
    expect(lastAnswerId([msg('a', 'user', 'q'), msg('b', 'assistant', 'r'), msg('c', 'system', 'n', { notice: 'info' } as Partial<Message>)])).toBe('b')
    expect(lastAnswerId([])).toBeNull()
  })
})

describe('file references', () => {
  const refs: FileRef[] = [
    { kind: 'image', messageId: 'm1', index: 2 },
    { kind: 'file', messageId: 'm1', index: 0 },
    { kind: 'artifact', messageId: 'm2', artifactId: 'a/b c~d' },
    { kind: 'draft-image', index: 1 },
    { kind: 'draft-file', index: 0 },
  ]
  it('survive the way through a route', () => {
    for (const ref of refs) expect(decodeFileRef(encodeFileRef(ref))).toEqual(ref)
  })
  it('refuse what is no reference', () => {
    for (const bad of ['', 'img', 'img~m1', 'img~m1~x', 'dimg~-1', 'art~m1', 'zip~m1~0', 'art~m1~%E0%A4%A']) expect(decodeFileRef(bad)).toBeNull()
  })
})

describe('chatFiles', () => {
  it('lists images, files and artifacts, newest first, without hidden messages', () => {
    const messages = [
      msg('u1', 'user', 'see', { images: [{ data: 'x', mimeType: 'image/png', name: '' }], files: [{ name: 'notes.txt', size: 12, summary: 's' }] } as Partial<Message>),
      msg('a1', 'assistant', 'made', { artifacts: [{ id: 'art1', name: 'page.html', mime: 'text/html', content: '<p>hi</p>' }] } as Partial<Message>),
      msg('h1', 'user', 'hidden', { hidden: true, images: [{ data: 'x', mimeType: 'image/png', name: 'no.png' }] } as Partial<Message>),
    ]
    const files = chatFiles({ messages })
    expect(files.map((f) => [f.kind, f.name, f.from])).toEqual([
      ['artifact', 'page.html', 'answer'],
      ['file', 'notes.txt', 'user'],
      ['image', 'image 1', 'user'],
    ])
    expect(files[0].size).toBe(9)
    expect(decodeFileRef(files[0].fileId)).toEqual({ kind: 'artifact', messageId: 'a1', artifactId: 'art1' })
    expect(chatFiles(undefined)).toEqual([])
  })
})

describe('context figure', () => {
  it('is a whole percent between 0 and 100 with two thresholds', () => {
    expect(contextPercent(2048, 4096)).toBe(50)
    expect(contextPercent(9000, 4096)).toBe(100)
    expect(contextPercent(10, 0)).toBe(0)
    expect(contextPercent(-1, 100)).toBe(0)
    expect(contextLevel(79)).toBe('ok')
    expect(contextLevel(80)).toBe('warn')
    expect(contextLevel(95)).toBe('full')
  })
})
