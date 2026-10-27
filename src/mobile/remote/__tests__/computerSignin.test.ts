/**
 * "Sign in with my computer" (R53, PROTOKOLL 15) against fakeDesktop (sealed
 * + create, which answers `signin/request`) and a stand in for
 * `POST https://lu-labs.ai/api/device-signin/redeem` with exactly the
 * answers of the web part. No real network, no real account.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { createRemoteClientStore, type RemoteClientStore } from '../remoteClientStore'
import type { RemoteFetch } from '../remoteClient'
import { createMemoryTokenVault } from '../tokenVault'
import {
  ComputerSigninError,
  SIGNIN_REDEEM_URL,
  SIGNIN_TEXT,
  SIGNIN_WITH_COMPUTER_ENABLED,
  computerSigninOffered,
  errorOfDesktopAnswer,
  errorOfRedeem,
  retryAfterSeconds,
  signInWithComputer,
} from '../computerSignin'
import { startFakeDesktop, type FakeDesktop } from './fakeDesktop'
import { createFakeSealedPhone, fakeSigninSignature, type FakeSealedPhone } from './fakeSealed'

const NET = 'https://quiet-river-lamp.trycloudflare.com'

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) }
}

let desk: FakeDesktop | null = null
afterEach(async () => {
  await desk?.stop()
  desk = null
})

async function rig(): Promise<{ store: RemoteClientStore; desk: FakeDesktop; phone: FakeSealedPhone }> {
  desk = await startFakeDesktop({ sealed: true, create: true })
  const d = desk
  const toDesk = (url: string) => `${d.url}${new URL(url).pathname}${new URL(url).search}`
  const fetchPlain: RemoteFetch = async (url, init) => fetch(toDesk(url), init)
  const phone = createFakeSealedPhone(async (url, body) => {
    const res = await fetch(toDesk(url), { method: 'POST', body: Buffer.from(body) })
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) }
  })
  const store = createRemoteClientStore({
    storage: memoryStorage(),
    vault: createMemoryTokenVault(),
    autoResume: false,
    persistWaitMs: 60_000,
    fetch: fetchPlain,
    sealed: { invoke: phone.invoke },
    pairPollMs: 5,
    pairWaitMs: 2_000,
  })
  await store.ready
  await store.useStore.getState().connect(d.sealed!.qrLink({ net: NET }))
  await store.useStore.getState().verifyConnection()
  return { store, desk: d, phone }
}

/** The web part: takes the code once, checks the signature of the paired phone. */
function fakeWeb(phone: FakeSealedPhone, opts: { status?: number; retryAfter?: string } = {}) {
  const seen: Array<Record<string, unknown>> = []
  const used = new Set<string>()
  const fetchWeb = async (url: string, init: RequestInit): Promise<Response> => {
    expect(url).toBe(SIGNIN_REDEEM_URL)
    const body = JSON.parse(String(init.body)) as { code: string; time: number; signature: string }
    seen.push(body)
    if (opts.status) return new Response(JSON.stringify({ error: 'x' }), { status: opts.status, headers: opts.retryAfter ? { 'retry-after': opts.retryAfter } : {} })
    if (used.has(body.code) || body.signature !== fakeSigninSignature(phone.deviceId, body.code, body.time)) return new Response('{"error":"invalid_code"}', { status: 401 })
    used.add(body.code)
    return new Response(JSON.stringify({ token_hash: 'th_123', type: 'magiclink', plan: 'pro' }), { status: 200 })
  }
  return { seen, fetchWeb }
}

describe('Sign in with my computer', () => {
  it('is off until the web part is live, and shown only when the computer names signin', () => {
    expect(SIGNIN_WITH_COMPUTER_ENABLED).toBe(false)
    expect(computerSigninOffered(['sealed', 'signin'], false)).toBe(false)
    expect(computerSigninOffered(['sealed', 'signin'], true)).toBe(true)
    expect(computerSigninOffered(['sealed', 'pending'], true)).toBe(false)
  })

  it('the whole way: the computer asks its user, the phone signs, redeems and verifies', async () => {
    const r = await rig()
    expect(r.store.useStore.getState().features).toContain('signin')
    r.desk.sealed!.deferSignin = 2
    const web = fakeWeb(r.phone)
    const verified: Array<Record<string, unknown>> = []
    const out = await signInWithComputer({
      channel: r.store.useStore.getState().desktopChannel()!,
      fetch: web.fetchWeb,
      verifyOtp: async (args) => {
        verified.push(args)
        return { error: null }
      },
      enabled: true,
    })
    expect(out.plan).toBe('pro')
    expect(r.desk.create!.signinAsks.length).toBe(1)
    expect(web.seen[0]).toMatchObject({ code: 'Zx9_k-2mQpLr7TbWq1r2s3t4u5v6w7x8' })
    expect(verified).toEqual([{ type: 'magiclink', token_hash: 'th_123' }])
  })

  it('switched off: nothing is asked', async () => {
    const r = await rig()
    const err = await signInWithComputer({ channel: r.store.useStore.getState().desktopChannel()!, fetch: async () => new Response(), verifyOtp: async () => ({ error: null }), enabled: false }).catch((e: unknown) => e)
    expect((err as ComputerSigninError).code).toBe('off')
    expect(r.desk.create!.signinAsks).toEqual([])
  })

  it('each answer of the computer has its sentence, nothing goes to the web', async () => {
    const r = await rig()
    const cases: Array<[number, Record<string, unknown>, string]> = [
      [403, { error: 'signin_denied' }, SIGNIN_TEXT.denied],
      [409, { error: 'desktop_signed_out', message: 'LU on your computer is not signed in.' }, SIGNIN_TEXT.desktopSignedOut],
      [409, { error: 'signin_pending' }, SIGNIN_TEXT.pending],
      [502, { error: 'signin_unavailable' }, SIGNIN_TEXT.unavailable],
    ]
    for (const [status, body, text] of cases) {
      r.desk.create!.signin = { status, body }
      const web = fakeWeb(r.phone)
      const err = await signInWithComputer({ channel: r.store.useStore.getState().desktopChannel()!, fetch: web.fetchWeb, verifyOtp: async () => ({ error: null }), enabled: true }).catch((e: unknown) => e)
      expect((err as ComputerSigninError).message).toBe(text)
      expect(web.seen).toEqual([])
    }
  })

  it('each answer of the web has its sentence (400, 401, 422, 429 with Retry-After)', async () => {
    expect(errorOfRedeem(400, null).code).toBe('bad-request')
    expect(errorOfRedeem(401, null).message).toBe(SIGNIN_TEXT.invalidCode)
    expect(errorOfRedeem(422, null).message).toBe(SIGNIN_TEXT.clock)
    expect(errorOfRedeem(429, '120').message).toBe(SIGNIN_TEXT.rateLimited(120))
    const r = await rig()
    const web = fakeWeb(r.phone, { status: 429, retryAfter: '30' })
    const err = await signInWithComputer({ channel: r.store.useStore.getState().desktopChannel()!, fetch: web.fetchWeb, verifyOtp: async () => ({ error: null }), enabled: true }).catch((e: unknown) => e)
    expect((err as ComputerSigninError).code).toBe('rate-limited')
    expect(web.seen.length).toBe(1)
  })

  it('the computer asked too often: 429 with retry-after in the inner answer, named in the sentence (Desktop f06160672)', async () => {
    const r = await rig()
    r.desk.create!.signin = { status: 429, body: { error: 'rate_limited' }, headers: { 'retry-after': '540' } }
    const web = fakeWeb(r.phone)
    const err = await signInWithComputer({ channel: r.store.useStore.getState().desktopChannel()!, fetch: web.fetchWeb, verifyOtp: async () => ({ error: null }), enabled: true }).catch((e: unknown) => e)
    expect((err as ComputerSigninError).code).toBe('rate-limited')
    expect((err as ComputerSigninError).retryAfterSeconds).toBe(540)
    expect((err as ComputerSigninError).message).toBe(SIGNIN_TEXT.desktopRateLimited(540))
    expect((err as ComputerSigninError).message).toContain('9 minutes')
    expect(web.seen).toEqual([])
    // Without a readable retry-after: a minute.
    expect(errorOfDesktopAnswer(429, { error: 'rate_limited' }, 'soon').retryAfterSeconds).toBe(60)
    expect(retryAfterSeconds('12')).toBe(12)
  })

  it('signin_pending holds for the whole computer: its own sentence', () => {
    const e = errorOfDesktopAnswer(409, { error: 'signin_pending' })
    expect(e.code).toBe('pending')
    expect(e.message).toBe('Your computer is already asking. Answer it there.')
  })

  it('the phone waits 150 s for the answer, longer than the 2 minutes the computer asks its user', async () => {
    const src = await import('node:fs').then((fs) => fs.readFileSync(new URL('../../../../src-tauri/src/commands/remote_sealed_phone.rs', import.meta.url), 'utf8'))
    const ms = Number(/pub const SIGNIN_TIMEOUT_MS: u64 = ([\d_]+);/.exec(src)?.[1].replace(/_/g, ''))
    expect(ms).toBe(150_000)
    expect(ms).toBeGreaterThan(120_000 + 25_000)
  })

  it('a malformed code from the computer is never signed', async () => {
    const r = await rig()
    r.desk.create!.signin = { status: 200, body: { code: 'short' } }
    const web = fakeWeb(r.phone)
    const err = await signInWithComputer({ channel: r.store.useStore.getState().desktopChannel()!, fetch: web.fetchWeb, verifyOtp: async () => ({ error: null }), enabled: true }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ComputerSigninError)
    expect(web.seen).toEqual([])
  })
})
