/**
 * "Sign in with my computer" and the address directory, the window's half
 * (REMOTE-PROTOKOLL v2, sections 14 and 15). The desktop side is in
 * src-tauri/src/commands/remote_sealed.rs and its tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRemoteStore, normalizeAnnounce, normalizeSigninRequest, normalizePairedDevices } from '../remoteStore'
import { requestDeviceSigninCode } from '../../api/cloud/device-signin'
import { signinQuestion } from '../../components/remote/RemoteSigninPrompt'
import { announceLine } from '../../components/settings/RemoteAccessSettings'

vi.mock('../../api/backend', () => ({
  backendCall: vi.fn().mockResolvedValue({}),
  isTauri: vi.fn(() => true),
}))
vi.mock('../../api/cloud/supabase', () => ({
  getAccessToken: vi.fn(),
}))
import { backendCall } from '../../api/backend'
import { getAccessToken } from '../../api/cloud/supabase'
const mockBackend = backendCall as unknown as ReturnType<typeof vi.fn>
const mockToken = getAccessToken as unknown as ReturnType<typeof vi.fn>

const TOKEN = 'eyJDESKTOP-SESSION-TOKEN-must-never-leave-9f3a'
const PHONE_KEY = 'QXJWeQNQ-SQ9-vxUYr6oP_y6nSLlKqV4Sk0ptG01gRc'
const CODE = 'Zx9_k-2mQpLr7TbWZx9_k-2mQpLr7TbW'

let fetchMock: ReturnType<typeof vi.fn>
const consoleSpies: { mock: { calls: unknown[][] }; mockRestore: () => void }[] = []

function answer(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

beforeEach(() => {
  mockBackend.mockReset()
  mockBackend.mockResolvedValue({})
  mockToken.mockReset()
  mockToken.mockResolvedValue(TOKEN)
  fetchMock = vi.fn().mockResolvedValue(answer(200, { code: CODE, expires: 1_790_000_120 }))
  vi.stubGlobal('fetch', fetchMock)
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}))
  }
  useRemoteStore.setState({
    signinRequests: [{ requestId: 'q1', name: 'Pixel 8', platform: 'android', devicePub: PHONE_KEY }],
    error: null,
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  consoleSpies.splice(0).forEach((s) => s.mockRestore())
})

/** Everything that left this window towards the desktop side or a log. */
function everythingSaid(): string {
  const calls = mockBackend.mock.calls.map((c) => JSON.stringify(c))
  const logs = consoleSpies.flatMap((s) => s.mock.calls.map((c: unknown[]) => JSON.stringify(c)))
  return [...calls, ...logs, JSON.stringify(useRemoteStore.getState().error)].join('\n')
}

describe('Sign this phone in', () => {
  it('Allow fetches one code with the session and hands on only the code', async () => {
    await useRemoteStore.getState().decideSignin('q1', true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url.endsWith('/api/device-signin/codes')).toBe(true)
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${TOKEN}`)
    expect(JSON.parse(String(init.body))).toEqual({ device_ed25519_pub: PHONE_KEY })
    expect(mockBackend).toHaveBeenCalledTimes(1)
    expect(mockBackend).toHaveBeenCalledWith('remote_signin_decide', {
      requestId: 'q1', outcome: 'allow', code: CODE, expires: 1_790_000_120,
    })
    expect(useRemoteStore.getState().signinRequests).toEqual([])
    // The desktop's session goes to lu-labs.ai and nowhere else.
    expect(everythingSaid()).not.toContain(TOKEN)
  })

  it('Deny (and closing the dialog) fetches nothing and gives no code', async () => {
    await useRemoteStore.getState().decideSignin('q1', false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockBackend).toHaveBeenCalledWith('remote_signin_decide', { requestId: 'q1', outcome: 'deny' })
  })

  it('a computer without an account says so, with or without asking lu-labs.ai', async () => {
    await useRemoteStore.getState().decideSignin('q1', true, true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockBackend).toHaveBeenLastCalledWith('remote_signin_decide', { requestId: 'q1', outcome: 'signed_out' })

    useRemoteStore.setState({ signinRequests: [{ requestId: 'q2', name: '', platform: '', devicePub: PHONE_KEY }] })
    mockToken.mockResolvedValue(null)
    await useRemoteStore.getState().decideSignin('q2', true)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockBackend).toHaveBeenLastCalledWith('remote_signin_decide', { requestId: 'q2', outcome: 'signed_out' })

    useRemoteStore.setState({ signinRequests: [{ requestId: 'q3', name: '', platform: '', devicePub: PHONE_KEY }] })
    mockToken.mockResolvedValue(TOKEN)
    fetchMock.mockResolvedValue(answer(401, { error: 'unauthorized' }))
    await useRemoteStore.getState().decideSignin('q3', true)
    expect(mockBackend).toHaveBeenLastCalledWith('remote_signin_decide', { requestId: 'q3', outcome: 'signed_out' })
    expect(everythingSaid()).not.toContain(TOKEN)
  })

  it('no usable code means unavailable, never a guess', async () => {
    fetchMock.mockResolvedValue(answer(200, { code: 'short', expires: 1 }))
    await useRemoteStore.getState().decideSignin('q1', true)
    expect(mockBackend).toHaveBeenLastCalledWith('remote_signin_decide', { requestId: 'q1', outcome: 'unavailable' })

    useRemoteStore.setState({ signinRequests: [{ requestId: 'q4', name: '', platform: '', devicePub: PHONE_KEY }] })
    fetchMock.mockResolvedValue(answer(503, { error: 'unavailable' }))
    await useRemoteStore.getState().decideSignin('q4', true)
    expect(mockBackend).toHaveBeenLastCalledWith('remote_signin_decide', { requestId: 'q4', outcome: 'unavailable' })

    useRemoteStore.setState({ signinRequests: [{ requestId: 'q5', name: '', platform: '', devicePub: PHONE_KEY }] })
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    await useRemoteStore.getState().decideSignin('q5', true)
    expect(mockBackend).toHaveBeenLastCalledWith('remote_signin_decide', { requestId: 'q5', outcome: 'unavailable' })
    expect(everythingSaid()).not.toContain(TOKEN)
  })

  it('a key of the wrong form is not sent anywhere', async () => {
    expect(await requestDeviceSigninCode('not-a-key')).toEqual({ kind: 'failed' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the question names the account', () => {
    expect(signinQuestion('name@example.com')).toBe('Sign this phone in to your LU account (name@example.com)?')
    expect(signinQuestion(undefined)).toBe('Sign this phone in to your LU account (your account)?')
  })

  it('a question from the desktop is read field by field', () => {
    expect(normalizeSigninRequest({ requestId: 'a', devicePub: PHONE_KEY, name: 'P', platform: 'android' }))
      .toEqual({ requestId: 'a', devicePub: PHONE_KEY, name: 'P', platform: 'android', fingerprint: '' })
    expect(normalizeSigninRequest({ requestId: 'a', devicePub: PHONE_KEY, fingerprint: '3F2A 9C01' })?.fingerprint).toBe('3F2A 9C01')
    expect(normalizeSigninRequest({ requestId: 'a' })).toBeNull()
    expect(normalizeSigninRequest(null)).toBeNull()
  })
})

describe('Findable from anywhere', () => {
  it('the announce status is read field by field', () => {
    expect(normalizeAnnounce({ state: 'ok', lastOkAt: 5, error: null })).toEqual({ state: 'ok', lastOkAt: 5, error: null, nextTryAt: null })
    expect(normalizeAnnounce({ state: 'weird' }).state).toBe('off')
    expect(normalizePairedDevices({ announce: { state: 'failed', error: 'x', nextTryAt: 9 } }).announce)
      .toEqual({ state: 'failed', lastOkAt: null, error: 'x', nextTryAt: 9 })
  })

  it('the panel says when it was announced and why it failed', () => {
    const now = 1_790_000_000_000
    expect(announceLine({ state: 'ok', lastOkAt: 1_790_000_000, error: null, nextTryAt: null }, false, now)).toBeNull()
    const ok = announceLine({ state: 'ok', lastOkAt: 1_790_000_000, error: null, nextTryAt: null }, true, now)
    expect(ok?.failed).toBe(false)
    expect(ok?.text).toMatch(/^Findable from anywhere\. Address last announced /)
    const failed = announceLine({ state: 'failed', lastOkAt: null, error: 'The tunnel address does not answer yet.', nextTryAt: 1_790_000_600 }, true, now)
    expect(failed).toEqual({ text: 'The address could not be announced: The tunnel address does not answer yet. Trying again in 10 min.', failed: true })
    expect(announceLine({ state: 'idle', lastOkAt: null, error: null, nextTryAt: null }, true, now)?.text).toMatch(/^Not findable yet/)
  })
})
