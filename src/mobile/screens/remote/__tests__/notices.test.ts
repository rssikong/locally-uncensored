/**
 * A17: notices of the computer. A notification while LU is away, a toast
 * while it is on the screen (not for the chat in sight), nothing with the
 * switch off; the link behind it opens only a page of the app; LU is kept
 * alive while it waits, asked for only while it is on the screen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const life = vi.hoisted(() => ({ state: 'foreground' as 'foreground' | 'background' }))
vi.mock('../../../platform/lifecycle', async (orig) => ({
  ...(await orig<typeof import('../../../platform/lifecycle')>()),
  lifecycleState: () => life.state,
}))

import { __setBridgeForTests } from '../../../platform/bridge'
import { noticeUrl, parseNoticeUrl } from '../../../remote/noticeLink'
import { __resetNoticesForTests, sayNotice, setNoticeScreen, setWaiting, systemNotice, useRemoteNotices } from '../parts/notices'

afterEach(() => {
  __resetNoticesForTests()
  __setBridgeForTests(undefined)
  life.state = 'foreground'
})

describe('the link behind a notice', () => {
  it('names a chat or a result, nothing else', () => {
    expect(noticeUrl({ kind: 'chat', id: 'chat_1' })).toBe('lu://remote/notice?chat=chat_1')
    expect(parseNoticeUrl('lu://remote/notice?chat=chat_1')).toEqual({ kind: 'chat', id: 'chat_1' })
    expect(parseNoticeUrl('lu://remote/notice?item=pc_res_ab')).toEqual({ kind: 'item', id: 'pc_res_ab' })
    expect(parseNoticeUrl('lu://remote/notice?chat=..%2Fx')).toBeNull()
    expect(parseNoticeUrl('lu://remote?desk=1')).toBeNull()
    expect(parseNoticeUrl('https://example.com/?chat=1')).toBeNull()
  })
})

describe('saying it', () => {
  it('away: a notification of the system with title, text and the link', async () => {
    const shown: unknown[] = []
    __setBridgeForTests({ localNotify: async (n) => (shown.push(n), true) })
    life.state = 'background'
    expect(await sayNotice({ kind: 'answer', about: 'Trip', text: 'Sure.', target: { kind: 'chat', id: 'chat_1' } })).toBe('system')
    expect(shown).toEqual([{ id: 'answer_chat_1', title: 'Answer ready', body: 'Trip: Sure.', url: 'lu://remote/notice?chat=chat_1' }])
    expect(systemNotice({ kind: 'approval', about: 'Build', text: 'x', target: { kind: 'chat', id: 'c' } }).title).toBe('Approval needed')
    expect(systemNotice({ kind: 'render', about: 'A fox', text: 'y', target: { kind: 'item', id: 'pc_res_1' } })).toMatchObject({ title: 'Render ready', url: 'lu://remote/notice?item=pc_res_1' })
  })

  it('on the screen a toast, but not for the chat in sight; switched off nothing', async () => {
    const toasts: string[] = []
    setNoticeScreen({ toast: (t) => toasts.push(t), isOpen: (t) => t.kind === 'chat' && t.id === 'open' })
    expect(await sayNotice({ kind: 'answer', about: 'Trip', text: '', target: { kind: 'chat', id: 'other' } })).toBe('toast')
    expect(await sayNotice({ kind: 'answer', about: 'Trip', text: '', target: { kind: 'chat', id: 'open' } })).toBe('none')
    expect(toasts).toEqual(['Answer ready: Trip'])
    useRemoteNotices.getState().setOn(false)
    life.state = 'background'
    expect(await sayNotice({ kind: 'answer', about: 'Trip', text: '', target: { kind: 'chat', id: 'x' } })).toBe('none')
  })

  it('keeps LU alive while something waits, starts only on the screen, lets go when nothing waits', async () => {
    const calls: Array<[boolean, string | undefined]> = []
    __setBridgeForTests({ remoteWatch: async (on, text) => (calls.push([on, text]), true) })
    life.state = 'background'
    setWaiting('chats', true)
    await Promise.resolve()
    expect(calls).toEqual([])
    life.state = 'foreground'
    setWaiting('chats', true, 'waiting')
    setWaiting('render', true)
    setWaiting('chats', false)
    setWaiting('render', false)
    await new Promise((r) => setTimeout(r, 0))
    expect(calls).toEqual([
      [true, 'waiting'],
      [false, ''],
    ])
  })
})
