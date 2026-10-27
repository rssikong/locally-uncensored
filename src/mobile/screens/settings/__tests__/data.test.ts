/** Backup, restore and the import from other chat apps. */
import { describe, expect, it } from 'vitest'
import { serializeAllConversations } from '../../../../lib/chat-export'
import { parseJsonText } from '../../../../lib/parsers/chatbot-export'
import type { Conversation } from '../../../../types/chat'
import { LARGE_FILE_BYTES, backupFileName, backupNote, backupToast, backupWhen, forgetCreateDraftEverywhere, isLargeFile, readBackupText } from '../parts/data'
import { markdownToMessages, toConversations } from '../parts/import-chats'

const chat = (id: string, updatedAt = 1): Conversation => ({
  id,
  title: `Chat ${id}`,
  messages: [{ id: `${id}-1`, role: 'user', content: 'Hello', timestamp: 1 }],
  model: 'm',
  systemPrompt: '',
  createdAt: 1,
  updatedAt,
})

describe('backupWhen', () => {
  const now = new Date(2026, 9, 8, 15, 30).getTime()

  it('says today and yesterday in words', () => {
    expect(backupWhen(new Date(2026, 9, 8, 14, 2).getTime(), now)).toBe('today, 14:02')
    expect(backupWhen(new Date(2026, 9, 7, 9, 5).getTime(), now)).toBe('yesterday, 09:05')
  })

  it('calls 23:59 the day before yesterday, not today', () => {
    expect(backupWhen(new Date(2026, 9, 7, 23, 59).getTime(), new Date(2026, 9, 8, 0, 1).getTime())).toBe('yesterday, 23:59')
  })

  it('writes a date for anything older', () => {
    const text = backupWhen(new Date(2026, 8, 1, 8, 0).getTime(), now)
    expect(text.endsWith(', 08:00')).toBe(true)
    expect(text).not.toMatch(/today|yesterday/)
  })
})

describe('backupFileName', () => {
  it('carries the day and the number of chats', () => {
    expect(backupFileName(42, new Date(2026, 9, 8).getTime())).toBe('lu-chats-2026-10-08-42.json')
  })
})

describe('readBackupText', () => {
  it('reads what "Back up all chats" wrote', () => {
    const read = readBackupText(serializeAllConversations([chat('a'), chat('b')]))
    expect(read.ok && read.conversations.map((c) => c.id)).toEqual(['a', 'b'])
  })

  it('tells a file that is not JSON from one without chats', () => {
    expect(readBackupText('not json at all')).toEqual({ ok: false, reason: 'not-json' })
    expect(readBackupText('{"hello":"world"}')).toEqual({ ok: false, reason: 'no-chats' })
    expect(readBackupText('[]')).toEqual({ ok: false, reason: 'no-chats' })
  })
})

describe('isLargeFile', () => {
  it('starts at the limit', () => {
    expect(isLargeFile(LARGE_FILE_BYTES - 1)).toBe(false)
    expect(isLargeFile(LARGE_FILE_BYTES)).toBe(true)
    expect(isLargeFile(Number.NaN)).toBe(false)
  })
})

describe('markdownToMessages', () => {
  it('splits the layout of the parser back into messages', () => {
    const md = ['# Trip plan', '', '_Created: 2026-01-01_', '', '**You**', '', 'Where to?', '', '**Assistant**', '', 'Lisbon.', '', 'It is warm.', ''].join('\n')
    expect(markdownToMessages(md)).toEqual([
      { role: 'user', content: 'Where to?' },
      { role: 'assistant', content: 'Lisbon.\n\nIt is warm.' },
    ])
  })

  it('keeps a bold line inside an answer as text', () => {
    const md = ['**You**', '', 'Hi', '', '**Assistant**', '', '**Note** this is bold', '**You**', 'still the answer', ''].join('\n')
    const out = markdownToMessages(md)
    expect(out).toHaveLength(2)
    expect(out[1].content).toContain('**You**')
  })

  it('drops empty messages and text before the first heading', () => {
    expect(markdownToMessages('# Title\n\nloose text')).toEqual([])
    expect(markdownToMessages('**You**\n\n\n\n**Assistant**\n\nYes')).toEqual([{ role: 'assistant', content: 'Yes' }])
  })
})

describe('toConversations', () => {
  const exportText = JSON.stringify([
    {
      title: 'Trip plan',
      create_time: 1767225600,
      mapping: {
        root: { id: 'root', message: null, parent: null, children: ['a'] },
        a: { id: 'a', parent: 'root', children: ['b'], message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['Where to?'] } } },
        b: { id: 'b', parent: 'a', children: [], message: { author: { role: 'assistant' }, content: { content_type: 'text', parts: ['Lisbon.'] } } },
      },
    },
  ])

  it('turns an export of another app into chats with messages', () => {
    const parsed = parseJsonText(exportText)
    expect(parsed.conversations).toHaveLength(1)
    const chats = toConversations(parsed.conversations, 1000, (c) => `${c.title} (ChatGPT)`)
    expect(chats).toHaveLength(1)
    expect(chats[0].title).toBe('Trip plan (ChatGPT)')
    expect(chats[0].messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Where to?'],
      ['assistant', 'Lisbon.'],
    ])
    expect(chats[0].id.startsWith('imported-chatgpt-')).toBe(true)
  })

  it('gives the same ids on a second import, so nothing is added twice', () => {
    const parsed = parseJsonText(exportText)
    const first = toConversations(parsed.conversations, 1000, (c) => c.title)
    const second = toConversations(parsed.conversations, 2000, (c) => c.title)
    expect(second.map((c) => c.id)).toEqual(first.map((c) => c.id))
  })

  it('keeps two chats with the same title apart', () => {
    const one = { id: 'same', title: 'Same', platform: 'claude' as const, timestamp: null, createdAt: null, updatedAt: null, messageCount: 1, messages: [{ role: 'user' as const, content: 'A', timestamp: null }] }
    const chats = toConversations([one, { ...one, messages: [{ role: 'user' as const, content: 'B', timestamp: null }] }], 5, (c) => c.title)
    expect(chats.map((c) => c.id)).toEqual(['imported-claude-same', 'imported-claude-same-2'])
  })

  it('leaves out a conversation without a readable message', () => {
    const empty = { id: 'e', title: 'Empty', platform: 'gemini' as const, timestamp: null, createdAt: null, updatedAt: null, messageCount: 0, messages: [{ role: 'user' as const, content: '  ', timestamp: null }] }
    expect(toConversations([empty], 5, (c) => c.title)).toEqual([])
  })
})

describe('"Delete all" and the draft of Create', () => {
  it('removes the words of the draft under its one key, and survives a storage that throws', async () => {
    const removed: string[] = []
    await forgetCreateDraftEverywhere({ removeItem: (key) => void removed.push(key) })
    expect(removed).toEqual(['lu-create-draft'])
    await expect(
      forgetCreateDraftEverywhere({
        removeItem: () => {
          throw new Error('locked')
        },
      }),
    ).resolves.toBeUndefined()
  })
})

describe('backupNote (M8): the page only names a place it knows', () => {
  const name = 'lu-chats-2026-10-08-3.json'

  it('a file written through the save dialog is in the folder the user picked', () => {
    const note = backupNote({ how: 'save', saved: true, via: 'native' }, 3, name)
    expect(note).toMatchObject({ ok: true, tone: 'info', restoreHint: true })
    expect(note.text).toBe(`Backup of 3 chats saved as ${name} in the folder you picked.`)
  })

  it('a closed save dialog saved nothing and promises no restore', () => {
    const note = backupNote({ how: 'save', saved: false, via: 'native' }, 3, name)
    expect(note).toMatchObject({ ok: false, restoreHint: false })
    expect(note.text).toMatch(/^Nothing was saved\./)
  })

  it('a phone without the save command is sent to sharing', () => {
    const note = backupNote({ how: 'save', unavailable: true }, 3, name)
    expect(note.ok).toBe(false)
    expect(note.text).toContain('Use Share backup')
  })

  it('a folder that could not be written is an error', () => {
    expect(backupNote({ how: 'save', failed: true }, 1, name)).toMatchObject({ ok: false, tone: 'error' })
  })

  it('a browser download is called a download, whichever button started it', () => {
    const a = backupNote({ how: 'save', saved: true, via: 'download' }, 1, name)
    const b = backupNote({ how: 'share', completed: true, via: 'download' }, 1, name)
    expect(a.text).toBe(b.text)
    expect(a.text).toContain('Backup of 1 chat downloaded')
  })

  it('after the share sheet the place is the choice of the other app, and a closed sheet is no backup', () => {
    expect(backupNote({ how: 'share', completed: true, via: 'native' }, 2, name).text).toContain('depends on the app you picked')
    expect(backupNote({ how: 'share', completed: false, via: 'native' }, 2, name)).toMatchObject({ ok: false, restoreHint: false })
  })
})

describe('backupToast (N14)', () => {
  it('says nothing after the share sheet of the phone: it reports back when it opens, not when the file arrived', () => {
    expect(backupToast({ how: 'share', completed: true, via: 'native' }, true)).toBeNull()
    expect(backupToast({ how: 'share', completed: true, via: 'web-share' }, true)).toBeNull()
  })
  it('keeps the toast where the result is known', () => {
    expect(backupToast({ how: 'share', completed: true, via: 'download' }, true)).toBe('downloaded')
    expect(backupToast({ how: 'save', saved: true, via: 'download' }, true)).toBe('downloaded')
    expect(backupToast({ how: 'save', saved: true, via: 'native' }, true)).toBe('saved')
    expect(backupToast({ how: 'share', completed: false, via: 'native' }, false)).toBe('cancelled')
    expect(backupToast({ how: 'save', saved: false, via: 'native' }, false)).toBeNull()
    expect(backupToast({ how: 'save', failed: true }, false)).toBeNull()
  })
})
