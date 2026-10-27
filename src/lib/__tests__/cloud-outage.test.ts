/**
 * @vitest-environment jsdom
 *
 * 3.0.8, A28: the LU Cloud outage line. The server's answer at
 * GET /api/app/status, read only while somebody is signed in, and the
 * sentence a failed cloud request reads while an outage is announced.
 *
 * Run: npx vitest run src/lib/__tests__/cloud-outage.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OUTAGE_FALLBACK, OUTAGE_MESSAGE_MAX, OUTAGE_MIN_GAP_MS, OUTAGE_POLL_MS, failureMayBeOutage, parseAppStatus,
} from '../cloud-outage'
import { outageAfterFailure, refreshOutage, resetOutageWatchForTests, setOutageWatching } from '../cloud-outage-watch'
import { activeOutageMessage, useCloudOutageStore } from '../../stores/cloudOutageStore'
import { CloudJobError } from '../../api/cloud/client'
import { ProviderError } from '../../api/providers/types'
import { isTerminalModelError } from '../http-status'

const answer = (active: boolean, message: string | null = null) => ({
  desktop: { active, message },
  web: { active: false, message: null },
  updatedAt: '2026-10-22T21:50:00Z',
})

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetOutageWatchForTests()
  useCloudOutageStore.setState({ active: false, message: null, dismissedMessage: null })
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('the answer', () => {
  it('reads the desktop half of the contract', () => {
    expect(parseAppStatus(answer(true, 'LU Cloud is down.'))).toEqual({ active: true, message: 'LU Cloud is down.' })
    expect(parseAppStatus(answer(false))).toEqual({ active: false, message: null })
  })

  it('keeps its own sentence when the server switched on without one', () => {
    expect(parseAppStatus(answer(true, null))).toEqual({ active: true, message: OUTAGE_FALLBACK })
    expect(parseAppStatus(answer(true, '   '))).toEqual({ active: true, message: OUTAGE_FALLBACK })
  })

  it('is nothing when the body is not the contract', () => {
    for (const body of [null, 'x', 42, {}, { desktop: null }, { desktop: { active: 'yes' } }, { on: true }]) {
      expect(parseAppStatus(body)).toBeNull()
    }
  })

  it('cuts a broken text to a size the line holds', () => {
    const parsed = parseAppStatus(answer(true, `a\u0000b\n${'x'.repeat(1000)}`))!
    expect(parsed.message!.length).toBe(OUTAGE_MESSAGE_MAX)
    expect(parsed.message!.startsWith('a b ')).toBe(true)
  })

  it('asks every three minutes', () => {
    expect(OUTAGE_POLL_MS).toBe(180_000)
  })
})

describe('asking', () => {
  it('never asks while nobody is signed in', async () => {
    await refreshOutage()
    expect(await outageAfterFailure(new Error('Failed to fetch'))).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the status route and keeps what it says', async () => {
    fetchMock.mockResolvedValue(json(answer(true, 'LU Cloud is down.')))
    setOutageWatching(true)
    await refreshOutage()
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/app\/status$/)
    expect(activeOutageMessage()).toBe('LU Cloud is down.')
  })

  it('stays quiet on a 404, a 500 and without a network, and keeps what it knew', async () => {
    setOutageWatching(true)
    for (const reply of [() => Promise.resolve(json({ error: 'nope' }, 404)), () => Promise.resolve(json({}, 500)), () => Promise.reject(new TypeError('Failed to fetch'))]) {
      fetchMock.mockImplementationOnce(reply)
      await expect(refreshOutage()).resolves.toBeUndefined()
      expect(useCloudOutageStore.getState().active).toBe(false)
    }
    useCloudOutageStore.getState().setOutage(true, 'Known.')
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await refreshOutage()
    expect(activeOutageMessage()).toBe('Known.')
  })

  it('takes the line away when the server says it is over', async () => {
    setOutageWatching(true)
    useCloudOutageStore.getState().setOutage(true, 'Down.')
    fetchMock.mockResolvedValue(json(answer(false)))
    await refreshOutage()
    expect(activeOutageMessage()).toBeNull()
  })

  it('shares a question on its way and does not ask again inside the gap', async () => {
    setOutageWatching(true)
    fetchMock.mockResolvedValue(json(answer(false)))
    await Promise.all([refreshOutage(), refreshOutage(), refreshOutage()])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await refreshOutage({ force: false })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + OUTAGE_MIN_GAP_MS + 1)
    await refreshOutage({ force: false })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.restoreAllMocks()
  })

  it('forgets the outage on sign out', () => {
    setOutageWatching(true)
    useCloudOutageStore.getState().setOutage(true, 'Down.')
    setOutageWatching(false)
    expect(activeOutageMessage()).toBeNull()
  })
})

describe('a failed cloud request', () => {
  it('reads the sentence when the outage is announced', async () => {
    setOutageWatching(true)
    fetchMock.mockResolvedValue(json(answer(true, 'LU Cloud is down.')))
    expect(await outageAfterFailure(new CloudJobError('Bad gateway', 502))).toBe('LU Cloud is down.')
  })

  it('keeps its own error when no outage is announced', async () => {
    setOutageWatching(true)
    fetchMock.mockResolvedValue(json(answer(false)))
    expect(await outageAfterFailure(new CloudJobError('Bad gateway', 502))).toBeNull()
  })

  it('does not wait for an answer that does not come', async () => {
    setOutageWatching(true)
    fetchMock.mockReturnValue(new Promise(() => {}))
    const started = Date.now()
    expect(await outageAfterFailure(new Error('Failed to fetch'), 50)).toBeNull()
    expect(Date.now() - started).toBeLessThan(1_000)
  })

  it('keeps the sentences that are the person\'s to act on', () => {
    expect(failureMayBeOutage(new ProviderError('Sign in', 'lu-cloud', 'signed_out', 401))).toBe(false)
    expect(failureMayBeOutage(Object.assign(new Error('empty'), { code: 'credits_exhausted' }))).toBe(false)
    expect(failureMayBeOutage(new CloudJobError('slow down', 429))).toBe(false)
    expect(failureMayBeOutage(new CloudJobError('price moved', 409, { code: 'quote_changed' }))).toBe(false)
    expect(failureMayBeOutage(new CloudJobError('blocked prompt', 422))).toBe(false)
    expect(failureMayBeOutage(new CloudJobError('polling aborted', 0))).toBe(false)
    expect(failureMayBeOutage(Object.assign(new Error('stop'), { name: 'AbortError' }))).toBe(false)
  })

  it('reads the server and the way to it as possibly the outage', () => {
    expect(failureMayBeOutage(new CloudJobError('Bad gateway', 502))).toBe(true)
    expect(failureMayBeOutage(new CloudJobError('Could not reach the LU Cloud server.', 0))).toBe(true)
    expect(failureMayBeOutage(new ProviderError('upstream', 'lu-cloud', 'upstream_unavailable', 502))).toBe(true)
    expect(failureMayBeOutage(new TypeError('Failed to fetch'))).toBe(true)
  })

  it('is not retried by the agent once it reads as the outage', () => {
    expect(isTerminalModelError(new ProviderError('Down.', 'lu-cloud', 'outage', 503))).toBe(true)
  })
})

describe('the store on disk', () => {
  it('keeps only which sentence was closed', () => {
    useCloudOutageStore.getState().setOutage(true, 'Down.')
    useCloudOutageStore.getState().dismiss()
    const saved = JSON.parse(localStorage.getItem('lu-cloud-outage') ?? '{}')
    expect(saved.state).toEqual({ dismissedMessage: 'Down.' })
  })
})
