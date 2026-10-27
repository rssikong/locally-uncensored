// @vitest-environment jsdom
/**
 * Deleting an account that uses Sign in with Apple (Apple 5.1.1(v), Pruefersicht R2, round 32).
 *
 * The website revokes the Apple token inside POST /api/account/delete, but only
 * when it holds one. For that the phone asks the Apple sheet once more and
 * hands its one-time code to POST /api/account/apple-token (form read in the
 * website, feat/web-307-store). What is held:
 *
 *  - the call: address, method, bearer, body `{ authorization_code }`, and
 *    that only `{ ok: true, stored: true }` counts as handed over,
 *  - who is asked: an iPhone and an account with an Apple identity only;
 *    Android and the desktop never see the sheet,
 *  - the ends: closed sheet (nothing sent, the caller deletes nothing),
 *    failed sheet, no code, network error or a refusing server (all
 *    'not-handed', never 'handed').
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/apple-before-delete.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getSession: vi.fn(),
  getAccessToken: vi.fn(),
}))

vi.mock('../../../../api/cloud/supabase', async (original) => ({
  ...(await original<typeof import('../../../../api/cloud/supabase')>()),
  getAccessToken: h.getAccessToken,
  savedSessionUser: vi.fn(async () => ({ id: 'u1' })),
  supabaseCloud: () => ({ auth: { getSession: h.getSession } }),
}))
vi.mock('../../../../hooks/useCloudAuth', () => ({ probeAccount: vi.fn(async () => {}), signOutAccount: vi.fn(async () => {}) }))

import { CLOUD_BASE } from '../../../../api/cloud/config'
import { handAppleCode } from '../../../../api/cloud/account'
import { __setBridgeForTests } from '../../../platform/bridge'
import { appleBeforeDelete, userUsesApple } from '../parts/auth'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'
const DESKTOP = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
const TOKEN_URL = `${CLOUD_BASE}/api/account/apple-token`

const fetchMock = vi.fn()

function device(userAgent: string): void {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true })
  Object.defineProperty(window.navigator, 'platform', { value: userAgent.includes('iPhone') ? 'iPhone' : 'Linux armv8l', configurable: true })
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

const APPLE_USER = { id: 'u1', app_metadata: { provider: 'apple', providers: ['apple'] }, identities: [{ provider: 'apple', id: '001234.abc' }] }
const EMAIL_USER = { id: 'u2', app_metadata: { provider: 'email', providers: ['email'] }, identities: [{ provider: 'email', id: 'u2' }] }

function session(user: unknown): void {
  h.getSession.mockResolvedValue({ data: { session: user ? { access_token: 'tok-123', user } : null }, error: null })
}

/** The sheet as AppleSignIn.swift answers since round 32: token and code. */
function sheet(answer: { identityToken: string; authorizationCode?: string } | null | Error) {
  return vi.fn(async () => {
    if (answer instanceof Error) throw answer
    return answer
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  h.getAccessToken.mockResolvedValue('tok-123')
  session(APPLE_USER)
  device(IPHONE)
})

afterEach(() => {
  vi.unstubAllGlobals()
  __setBridgeForTests(undefined)
  device(DESKTOP)
})

describe('handAppleCode: the call the website expects', () => {
  it('posts the code as authorization_code with the bearer, and stored: true is handed over', async () => {
    fetchMock.mockResolvedValue(jsonRes({ ok: true, stored: true }))
    expect(await handAppleCode('c0de.one-time')).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(TOKEN_URL)
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('authorization')).toBe('Bearer tok-123')
    expect(headers.get('content-type')).toBe('application/json')
    expect(JSON.parse(String(init.body))).toEqual({ authorization_code: 'c0de.one-time' })
  })

  it('stored: false (the server has no Apple keys) is not handed over', async () => {
    fetchMock.mockResolvedValue(jsonRes({ ok: true, stored: false }))
    expect(await handAppleCode('c')).toBe(false)
  })

  it.each([400, 401, 403, 409, 422, 429, 502])('status %i is not handed over, and nothing is tried twice', async (status) => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'no' }, status))
    expect(await handAppleCode('c')).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('no network and an answer that is no JSON are not handed over, and it never throws', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    expect(await handAppleCode('c')).toBe(false)
    fetchMock.mockResolvedValueOnce(new Response('<html>', { status: 200 }))
    expect(await handAppleCode('c')).toBe(false)
  })

  it('an empty code sends nothing', async () => {
    expect(await handAppleCode('')).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('userUsesApple', () => {
  it('reads the identities and the providers of the session user', () => {
    expect(userUsesApple(APPLE_USER)).toBe(true)
    expect(userUsesApple({ identities: [{ provider: 'google' }, { provider: 'apple' }] })).toBe(true)
    expect(userUsesApple({ app_metadata: { providers: ['email', 'apple'] } })).toBe(true)
    expect(userUsesApple(EMAIL_USER)).toBe(false)
    expect(userUsesApple({ identities: [{ provider: 'google' }] })).toBe(false)
    expect(userUsesApple(null)).toBe(false)
    expect(userUsesApple('apple')).toBe(false)
  })
})

describe('appleBeforeDelete', () => {
  it('an Apple account on an iPhone: a fresh sheet, its code to the server, handed', async () => {
    const played = sheet({ identityToken: 'id.tok.en', authorizationCode: 'fresh-code' })
    __setBridgeForTests({ appleSignIn: played })
    fetchMock.mockResolvedValue(jsonRes({ ok: true, stored: true }))
    expect(await appleBeforeDelete()).toBe('handed')
    expect(played).toHaveBeenCalledTimes(1)
    // A fresh nonce for the fresh sheet.
    expect(played.mock.calls[0]).toEqual([expect.stringMatching(/^[0-9a-f]{64}$/)])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe(TOKEN_URL)
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).toEqual({ authorization_code: 'fresh-code' })
  })

  it('the sheet closed by the user: cancelled, nothing sent', async () => {
    __setBridgeForTests({ appleSignIn: sheet(null) })
    expect(await appleBeforeDelete()).toBe('cancelled')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the sheet failed: not handed, nothing sent', async () => {
    __setBridgeForTests({ appleSignIn: sheet(new Error('Sign in with Apple is not available right now.')) })
    expect(await appleBeforeDelete()).toBe('not-handed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('a native part without the command: not handed', async () => {
    __setBridgeForTests({})
    expect(await appleBeforeDelete()).toBe('not-handed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('Apple sent no code (a native part older than round 32): not handed, nothing sent', async () => {
    __setBridgeForTests({ appleSignIn: sheet({ identityToken: 'id.tok.en' }) })
    expect(await appleBeforeDelete()).toBe('not-handed')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('the network fails on the way to the server: not handed', async () => {
    __setBridgeForTests({ appleSignIn: sheet({ identityToken: 'id.tok.en', authorizationCode: 'fresh-code' }) })
    fetchMock.mockRejectedValue(new TypeError('Load failed'))
    expect(await appleBeforeDelete()).toBe('not-handed')
  })

  it('the server keeps nothing (no Apple keys yet): not handed', async () => {
    __setBridgeForTests({ appleSignIn: sheet({ identityToken: 'id.tok.en', authorizationCode: 'fresh-code' }) })
    fetchMock.mockResolvedValue(jsonRes({ ok: true, stored: false }))
    expect(await appleBeforeDelete()).toBe('not-handed')
  })

  it('an account without Apple: no sheet, nothing sent', async () => {
    session(EMAIL_USER)
    const played = sheet({ identityToken: 'x', authorizationCode: 'y' })
    __setBridgeForTests({ appleSignIn: played })
    expect(await appleBeforeDelete()).toBe('none')
    expect(played).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('no session to read: no sheet', async () => {
    h.getSession.mockRejectedValue(new Error('keychain locked'))
    const played = sheet({ identityToken: 'x', authorizationCode: 'y' })
    __setBridgeForTests({ appleSignIn: played })
    expect(await appleBeforeDelete()).toBe('none')
    expect(played).not.toHaveBeenCalled()
  })

  it.each([
    ['Android', ANDROID],
    ['the desktop', DESKTOP],
  ])('%s: unchanged, no sheet even for an Apple account', async (_name, ua) => {
    device(ua)
    const played = sheet({ identityToken: 'x', authorizationCode: 'y' })
    __setBridgeForTests({ appleSignIn: played })
    expect(await appleBeforeDelete()).toBe('none')
    expect(played).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
