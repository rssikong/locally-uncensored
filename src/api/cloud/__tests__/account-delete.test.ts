/**
 * Deleting the account (api/cloud/account.ts): the one success and every way
 * it can fail. A failure must never read as a deletion, and each one has to
 * tell the caller which sentence to show: no network, sign in again, or the
 * server declined.
 *
 * Run: npx vitest run src/api/cloud/__tests__/account-delete.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  savedSessionUser: vi.fn(),
}))
vi.mock('../supabase', () => ({ getAccessToken: h.getAccessToken, savedSessionUser: h.savedSessionUser }))

import { CLOUD_BASE } from '../config'
import { DeleteAccountError, deleteAccount, deleteAccountFailure } from '../account'

const fetchMock = vi.fn()
const online = () => true

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

async function reasonOf(run: Promise<void>): Promise<DeleteAccountError> {
  try {
    await run
  } catch (err) {
    expect(err).toBeInstanceOf(DeleteAccountError)
    return err as DeleteAccountError
  }
  throw new Error('the call resolved, it should have rejected')
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', fetchMock)
  h.getAccessToken.mockResolvedValue('tok-123')
  h.savedSessionUser.mockResolvedValue({ id: 'u1' })
})

describe('deleteAccountFailure', () => {
  it('reads the reason from the status', () => {
    expect(deleteAccountFailure(null, true)).toBe('offline')
    expect(deleteAccountFailure(0, true)).toBe('offline')
    expect(deleteAccountFailure(408, true)).toBe('offline')
    expect(deleteAccountFailure(401, true)).toBe('not-signed-in')
    expect(deleteAccountFailure(403, true)).toBe('not-signed-in')
    expect(deleteAccountFailure(500, true)).toBe('server')
    expect(deleteAccountFailure(502, true)).toBe('server')
    expect(deleteAccountFailure(409, true)).toBe('server')
  })

  it('says offline whatever the status when the device has no network', () => {
    expect(deleteAccountFailure(500, false)).toBe('offline')
    expect(deleteAccountFailure(401, false)).toBe('offline')
  })
})

describe('deleteAccount', () => {
  it('posts to the delete route with the bearer and resolves on { ok: true }', async () => {
    fetchMock.mockResolvedValue(jsonRes({ ok: true }))
    await expect(deleteAccount(online)).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${CLOUD_BASE}/api/account/delete`)
    expect(init.method).toBe('POST')
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer tok-123')
  })

  it('offline: the request never reached anything', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await reasonOf(deleteAccount(() => false))
    expect(err.reason).toBe('offline')
  })

  it('offline: a network failure while the device believes it is online is still "no answer"', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = await reasonOf(deleteAccount(online))
    expect(err.reason).toBe('offline')
    expect(err.status).toBe(0)
  })

  it('session expired: the server refuses the bearer', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'unauthorized' }, 401))
    expect((await reasonOf(deleteAccount(online))).reason).toBe('not-signed-in')
  })

  it('session expired: there is no token to send, and nothing is sent', async () => {
    h.getAccessToken.mockResolvedValue(null)
    expect((await reasonOf(deleteAccount(online))).reason).toBe('not-signed-in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('session expired: the token could not be renewed and the device holds no session any more', async () => {
    h.getAccessToken.mockRejectedValue(new Error('LU Cloud unreachable. Check your connection.'))
    h.savedSessionUser.mockResolvedValue(null)
    expect((await reasonOf(deleteAccount(online))).reason).toBe('not-signed-in')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('offline: the token could not be renewed but the session is still on the device', async () => {
    h.getAccessToken.mockRejectedValue(new Error('LU Cloud unreachable. Check your connection.'))
    expect((await reasonOf(deleteAccount(online))).reason).toBe('offline')
  })

  it('the server declines: 502 with an error body', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'Could not delete account.' }, 502))
    const err = await reasonOf(deleteAccount(online))
    expect(err.reason).toBe('server')
    expect(err.status).toBe(502)
  })

  it('the server declines: 200 without the confirmation is not a deletion', async () => {
    fetchMock.mockResolvedValue(jsonRes({ ok: false }))
    expect((await reasonOf(deleteAccount(online))).reason).toBe('server')
    fetchMock.mockResolvedValue(new Response('<html>gateway</html>', { status: 200 }))
    expect((await reasonOf(deleteAccount(online))).reason).toBe('server')
  })

  it('never asks twice', async () => {
    fetchMock.mockResolvedValue(jsonRes({ error: 'boom' }, 500))
    await reasonOf(deleteAccount(online))
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
