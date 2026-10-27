// @vitest-environment jsdom
/**
 * A17, device test 20.10.2026 (Android 14): notices of the computer came only
 * after POST_NOTIFICATIONS was granted by adb; the app never asked. Now, once,
 * after the first pairing or at the first shared chat: "Get notified when
 * your computer is done?" with Allow / Not now; Allow puts the question of
 * the system. Not at every start.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { __setBridgeForTests } from '../../../platform/bridge'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { NOTICES_OFFERED_KEY, __resetNoticesForTests, noticeStatus, offerRemoteNotices, shouldOfferNotices, useRemoteNotices } from '../parts/notices'

const native = { state: { granted: false, needed: true, asked: false }, systemSays: true, calls: [] as boolean[] }
const specs: Array<{ title: string; confirmLabel: string; cancelLabel: string; testid: string }> = []
let userSays = true
const confirm = async (spec: { title: string; confirmLabel: string; cancelLabel: string; testid: string }) => (specs.push(spec), userSays)

beforeEach(() => {
  localStorage.clear()
  native.state = { granted: false, needed: true, asked: false }
  native.systemSays = true
  native.calls = []
  specs.length = 0
  userSays = true
  __setBridgeForTests({
    remoteNotifyPermission: async (ask?: boolean) => {
      native.calls.push(ask !== false)
      if (ask !== false && !native.state.asked && !native.state.granted) native.state = { granted: native.systemSays, needed: true, asked: true }
      return native.state
    },
  })
})
afterEach(() => {
  __resetNoticesForTests()
  __setBridgeForTests(undefined)
})

describe('asking for notices of the computer', () => {
  it('pure: only while the system could still ask, once, with the switch on', () => {
    expect(shouldOfferNotices('open', false, true)).toBe(true)
    expect(shouldOfferNotices('open', true, true)).toBe(false)
    expect(shouldOfferNotices('open', false, false)).toBe(false)
    expect(shouldOfferNotices('granted', false, true)).toBe(false)
    expect(shouldOfferNotices('refused', false, true)).toBe(false)
    expect(shouldOfferNotices('not-needed', false, true)).toBe(false)
  })

  it('Allow: the question of the system; then never again, also not at the next start', async () => {
    expect(await noticeStatus()).toBe('open')
    expect(native.calls).toEqual([false])
    expect(await offerRemoteNotices(confirm)).toBe('asked')
    expect(specs).toEqual([expect.objectContaining({ title: S.notices.offerTitle, confirmLabel: 'Allow', cancelLabel: 'Not now', testid: 'remote-notify' })])
    expect(native.calls).toEqual([false, false, true])
    expect(await noticeStatus()).toBe('granted')
    expect(localStorage.getItem(NOTICES_OFFERED_KEY)).toBe('1')
    expect(await offerRemoteNotices(confirm)).toBe('skipped')
    expect(specs).toHaveLength(1)
  })

  it('Not now: no question of the system, and the sheet does not come again', async () => {
    userSays = false
    expect(await offerRemoteNotices(confirm)).toBe('declined')
    expect(native.calls).toEqual([false])
    expect(await offerRemoteNotices(confirm)).toBe('skipped')
    expect(specs).toHaveLength(1)
  })

  it('nothing when the phone already shows them, when the system said no, with the switch off, or without the app around it', async () => {
    native.state = { granted: true, needed: true, asked: true }
    expect(await offerRemoteNotices(confirm)).toBe('skipped')
    native.state = { granted: false, needed: true, asked: true }
    expect(await noticeStatus()).toBe('refused')
    expect(await offerRemoteNotices(confirm)).toBe('skipped')
    native.state = { granted: false, needed: true, asked: false }
    useRemoteNotices.getState().setOn(false)
    expect(await offerRemoteNotices(confirm)).toBe('skipped')
    useRemoteNotices.getState().setOn(true)
    __setBridgeForTests(null)
    expect(await offerRemoteNotices(confirm)).toBe('skipped')
    expect(specs).toHaveLength(0)
    expect(native.calls.every((ask) => ask === false)).toBe(true)
  })

  it('two screens at once (home and chat) ask once', async () => {
    const [a, b] = await Promise.all([offerRemoteNotices(confirm), offerRemoteNotices(confirm)])
    expect([a, b].sort()).toEqual(['asked', 'skipped'])
    expect(specs).toHaveLength(1)
  })
})
