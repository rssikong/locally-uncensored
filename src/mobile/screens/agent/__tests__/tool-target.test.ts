/**
 * The row of a file step says what was asked (r6 Nachpruefung Android, N10).
 *
 * A model asked to read `../../x.txt`. The step was refused, rightly, and its
 * row read "Read a file | x.txt in this chat failed": a file nobody asked
 * for, in a place the path did not point to. A path that leaves the chat is
 * shown as written. A path inside the chat keeps the short form.
 *
 * Run: npx vitest run src/mobile/screens/agent/__tests__/tool-target.test.ts
 */
import { describe, expect, it } from 'vitest'
import { leavesChat, toolTarget } from '../parts/tool-words'

describe('a path that climbs out of the chat', () => {
  it('is recognised by its parent steps', () => {
    for (const path of ['../../x.txt', '..', 'notes/../../x.txt', '..\\x.txt', '/data/../x.txt']) {
      expect(leavesChat(path), path).toBe(true)
    }
    for (const path of ['x.txt', 'notes/x.txt', './x.txt', 'a..b.txt', '...txt', 'notes\\x.txt', '/data/chats/abc/notes.txt']) {
      expect(leavesChat(path), path).toBe(false)
    }
  })

  it('stands in the row as it was written, for every file step', () => {
    for (const tool of ['file_read', 'file_write', 'file_edit', 'file_list']) {
      expect(toolTarget(tool, { path: '../../x.txt' }), tool).toBe('../../x.txt')
    }
  })

  it('an absolute path still shows the file name only: no path of the device in a row', () => {
    expect(toolTarget('file_write', { path: '/data/chats/abc/notes.txt' })).toBe('notes.txt in this chat')
  })
})

describe('a path inside the chat', () => {
  it('keeps the short form with the file name', () => {
    expect(toolTarget('file_read', { path: 'x.txt' })).toBe('x.txt in this chat')
    expect(toolTarget('file_write', { path: 'notes/plan.md' })).toBe('plan.md in this chat')
    expect(toolTarget('file_list', { path: '.' })).toBe('Files in this chat')
    expect(toolTarget('file_list', {})).toBe('Files in this chat')
    expect(toolTarget('file_read', {})).toBe('')
  })
})
