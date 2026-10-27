/**
 * Mobile, acceptance on Android with 8 GB, B11: "File saved:
 * /data/user/0/.../agent-workspace/new-chat-15c857/notes.md".
 *
 * Run: npx vitest run src/lib/__tests__/phone-file-path.test.ts
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

let mobile = false
vi.mock('../device-kind', async (orig) => ({ ...(await orig() as object), isMobile: () => mobile }))

import { fileSavedText, insideChatFolder, shownToolPath } from '../phone-file-path'

const ANDROID = '/data/user/0/com.example.app/files/agent-workspace/new-chat-15c857/notes.md'
const IOS = '/var/mobile/Containers/Data/Application/0000-1111/Documents/agent-workspace/trip-plan-7f2c3d/drafts/plan.md'

afterEach(() => { mobile = false })

describe('a path inside the folder of the chat', () => {
  it('is the file as the model named it', () => {
    expect(insideChatFolder(ANDROID)).toBe('notes.md')
    expect(insideChatFolder(IOS)).toBe('drafts/plan.md')
    expect(insideChatFolder('/data/user/0/app/agent-workspace/new-chat-15c857')).toBe('.')
    expect(insideChatFolder('C:\\Users\\a\\agent-workspace\\chat-1\\a\\b.txt')).toBe('a/b.txt')
  })

  it('a path somewhere else keeps only its file name, a relative one stays', () => {
    expect(insideChatFolder('/storage/emulated/0/Download/report.pdf')).toBe('report.pdf')
    expect(insideChatFolder('drafts/plan.md')).toBe('drafts/plan.md')
    expect(insideChatFolder('')).toBe('')
  })
})

describe('what the file tools answer', () => {
  it('on a desktop: the path, word for word as before', () => {
    expect(fileSavedText('/Users/a/agent-workspace/chat-1/notes.md')).toBe('File saved: /Users/a/agent-workspace/chat-1/notes.md')
    expect(shownToolPath('/Users/a/agent-workspace/chat-1/notes.md')).toBe('/Users/a/agent-workspace/chat-1/notes.md')
  })

  it('on a phone: the file name and where the user finds it, never the folder of the app', () => {
    mobile = true
    const text = fileSavedText(ANDROID)
    expect(text).toBe('File saved: notes.md. The user finds it under "Files in this chat".')
    expect(text).not.toContain('/data/')
    expect(text).not.toContain('agent-workspace')
    expect(shownToolPath(IOS)).toBe('drafts/plan.md')
  })
})
