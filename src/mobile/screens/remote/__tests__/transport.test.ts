import { afterEach, describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { MEMORY_REVOKED_HEADER, REFRESH_HEADER } from '../../../remote/remoteClient'
import { createRemoteClientStore } from '../../../remote/remoteClientStore'
import type { TauriInvoke } from '../../../remote/tauriProxyTransport'
import { startFakeDesktop, type FakeDesktop } from '../../../remote/__tests__/fakeDesktop'
import { bearerFrom, createDeviceFetch, createRemoteRequestFetch, isMissingRemoteCommand, timeoutForPath } from '../parts/transport'

/**
 * The Rust side as JavaScript sees it, rebuilt for the test.
 *
 * remote_client_request follows the command of the branch feat/android: it
 * takes baseUrl, path, method, token, body and timeoutMs, and answers every
 * HTTP status with { status, body, refreshedToken }. Only a call that got no
 * answer rejects. proxy_localhost follows src-tauri/src/commands/proxy.rs: a
 * status that is not 2xx becomes Err("HTTP <status>: <text>") and every
 * response header is lost.
 */
function fakeRust(opts: { withRemoteCommand: boolean }) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const invoke: TauriInvoke = async (cmd, args = {}) => {
    calls.push({ cmd, args })
    if (cmd === 'remote_client_request') {
      if (!opts.withRemoteCommand) throw 'Command remote_client_request not found'
      const headers: Record<string, string> = {}
      if (typeof args.token === 'string' && args.token) headers.authorization = `Bearer ${args.token}`
      if (typeof args.body === 'string') headers['content-type'] = 'application/json'
      let res: Response
      try {
        res = await fetch(`${String(args.baseUrl)}${String(args.path)}`, {
          method: String(args.method),
          headers,
          body: (args.body as string | null) ?? undefined,
        })
      } catch {
        throw `remote_client_request: error sending request for url (${String(args.baseUrl)})`
      }
      return {
        status: res.status,
        body: await res.text(),
        refreshedToken: res.headers.get(REFRESH_HEADER),
        memoryRevoked: res.headers.get(MEMORY_REVOKED_HEADER) === '1',
      }
    }
    if (cmd === 'register_openai_host' || cmd === 'cancel_proxy_call') return null
    if (cmd === 'proxy_localhost') {
      try {
        const res = await fetch(String(args.url), {
          method: String(args.method),
          headers: (args.headers as Record<string, string> | null) ?? undefined,
          body: (args.body as string | null) ?? undefined,
        })
        const text = await res.text()
        if (!res.ok) throw `HTTP ${res.status}: ${text}`
        return text
      } catch (err) {
        if (typeof err === 'string') throw err
        throw `proxy_localhost: error sending request for url (${String(args.url)})`
      }
    }
    throw `unknown command ${cmd}`
  }
  return { invoke, calls }
}

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  }
}

let desktop: FakeDesktop | null = null
afterEach(async () => {
  await desktop?.stop()
  desktop = null
})

async function storeOver(invoke: TauriInvoke) {
  const transport = createDeviceFetch({ invoke, isMissingCommand: isMissingRemoteCommand })
  const store = createRemoteClientStore({ fetch: transport, storage: memoryStorage(), autoResume: false })
  await store.ready
  return { store, transport, s: () => store.useStore.getState() }
}

describe('small parts', () => {
  it('reads the token out of the header the client built, whatever its case', () => {
    expect(bearerFrom({ Authorization: 'Bearer abc.def' })).toBe('abc.def')
    expect(bearerFrom({ authorization: 'bearer  xyz' })).toBe('xyz')
    expect(bearerFrom({ 'Content-Type': 'application/json' })).toBeNull()
    expect(bearerFrom(undefined)).toBeNull()
  })

  it('gives a chat far more time than a status call', () => {
    expect(timeoutForPath('/api/chat')).toBeGreaterThan(600_000)
    expect(timeoutForPath('/remote-api/agent-tool')).toBeGreaterThan(300_000)
    expect(timeoutForPath('/remote-api/status')).toBe(30_000)
  })

  it('tells a missing command from a host that was not found', () => {
    expect(isMissingRemoteCommand('Command remote_client_request not found')).toBe(true)
    expect(isMissingRemoteCommand(new Error('command "remote_client_request" not found'))).toBe(true)
    expect(isMissingRemoteCommand('remote_client_request not allowed by ACL')).toBe(true)
    expect(isMissingRemoteCommand('unknown command remote_client_request')).toBe(true)
    // The command exists and says that the network failed.
    expect(isMissingRemoteCommand('remote_client_request: host not found')).toBe(false)
    expect(isMissingRemoteCommand('remote_client_request: error sending request')).toBe(false)
    expect(isMissingRemoteCommand('dns error: name not found')).toBe(false)
    expect(isMissingRemoteCommand(null)).toBe(false)
  })
})

describe('createRemoteRequestFetch', () => {
  it('hands the token over as an argument and never inside the address', async () => {
    const seen: Array<Record<string, unknown>> = []
    const fetchLike = createRemoteRequestFetch(async (_cmd, args = {}) => {
      seen.push(args)
      return { status: 200, body: '{"ok":true}', refreshedToken: 'new-token' }
    })
    const res = await fetchLike('http://192.168.1.20:11435/remote-api/config?x=1', {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-token', 'Content-Type': 'application/json' },
      body: '{"a":1}',
    })
    expect(seen).toEqual([
      { baseUrl: 'http://192.168.1.20:11435', path: '/remote-api/config?x=1', method: 'POST', token: 'secret-token', body: '{"a":1}', timeoutMs: 30_000, callId: expect.stringMatching(/^remote-\d+-/) },
    ])
    expect(JSON.stringify([seen[0].baseUrl, seen[0].path])).not.toContain('secret-token')
    expect(res.status).toBe(200)
    expect(res.headers.get(REFRESH_HEADER)).toBe('new-token')
    expect(await res.json()).toEqual({ ok: true })
  })

  it('turns every status into a response, with the mark for revoked memory', async () => {
    const answers = [
      { status: 401, body: 'Unauthorized' },
      { status: 409, body: 'Memory was revoked', memoryRevoked: true },
      { status: 204, body: '' },
    ]
    const fetchLike = createRemoteRequestFetch(async () => answers.shift())
    const first = await fetchLike('http://h:1/a')
    expect([first.status, await first.text()]).toEqual([401, 'Unauthorized'])
    const second = await fetchLike('http://h:1/a')
    expect([second.status, second.headers.get(MEMORY_REVOKED_HEADER)]).toEqual([409, '1'])
    expect((await fetchLike('http://h:1/a')).status).toBe(204)
  })

  it('rejects an answer that is no HTTP answer, and an address it cannot read', async () => {
    const fetchLike = createRemoteRequestFetch(async () => ({ status: 0, body: '' }))
    await expect(fetchLike('http://h:1/a')).rejects.toBeInstanceOf(TypeError)
    await expect(fetchLike('not an address')).rejects.toBeInstanceOf(TypeError)
  })

  it('an abort ends the wait at once, also when it came before the call', async () => {
    let asked = 0
    const fetchLike = createRemoteRequestFetch((cmd) => {
      if (cmd === 'remote_client_request') asked += 1
      return cmd === 'remote_client_request' ? new Promise(() => {}) : Promise.resolve(true)
    })
    const ctrl = new AbortController()
    const waiting = fetchLike('http://h:1/api/chat', { signal: ctrl.signal })
    ctrl.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    await expect(fetchLike('http://h:1/api/chat', { signal: ctrl.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(asked).toBe(1)
  })

  it('an abort closes the connection in Rust, under the call id of exactly that request', async () => {
    const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
    const fetchLike = createRemoteRequestFetch((cmd, args = {}) => {
      calls.push({ cmd, args })
      return cmd === 'remote_client_request' ? new Promise(() => {}) : Promise.resolve(true)
    })
    const first = new AbortController()
    const second = new AbortController()
    const a = fetchLike('http://h:1/api/chat', { signal: first.signal, headers: { authorization: 'Bearer secret-token' } })
    const b = fetchLike('http://h:1/api/chat', { signal: second.signal })
    const ids = calls.filter((c) => c.cmd === 'remote_client_request').map((c) => String(c.args.callId))
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
    // The name of a call tells nothing about the token or the address.
    expect(ids.join(' ')).not.toContain('secret-token')
    expect(ids.join(' ')).not.toContain('h:1')
    second.abort()
    await expect(b).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls.filter((c) => c.cmd === 'remote_client_cancel').map((c) => c.args.callId)).toEqual([ids[1]])
    first.abort()
    await expect(a).rejects.toMatchObject({ name: 'AbortError' })
    expect(calls.filter((c) => c.cmd === 'remote_client_cancel').map((c) => c.args.callId)).toEqual([ids[1], ids[0]])
  })

  it('a finished call is not cancelled afterwards, and a build without the cancel command changes nothing', async () => {
    const calls: string[] = []
    const fetchLike = createRemoteRequestFetch(async (cmd) => {
      calls.push(cmd)
      if (cmd === 'remote_client_cancel') throw 'Command remote_client_cancel not found'
      return { status: 200, body: 'ok' }
    })
    const ctrl = new AbortController()
    const res = await fetchLike('http://h:1/remote-api/status', { signal: ctrl.signal })
    expect(res.status).toBe(200)
    ctrl.abort()
    expect(calls).toEqual(['remote_client_request'])
    const hanging = createRemoteRequestFetch((cmd) => (cmd === 'remote_client_cancel' ? Promise.reject('Command remote_client_cancel not found') : new Promise(() => {})))
    const late = new AbortController()
    const waiting = hanging('http://h:1/api/chat', { signal: late.signal })
    late.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('the transport of the phone against the stand in for the desktop', () => {
  it('pairs, chats and renews the session over remote_client_request', async () => {
    desktop = await startFakeDesktop({ passcode: '482913', reply: 'Hello from the desktop.' })
    const rust = fakeRust({ withRemoteCommand: true })
    const { transport, s } = await storeOver(rust.invoke)

    await s().connect(desktop.url, '482913')
    expect(s().status).toBe('connected')
    expect(transport.via()).toBe('request')
    const chatId = s().newChat()
    await s().sendMessage('Hi')
    const chat = s().chats.find((c) => c.id === chatId)!
    expect(chat.messages.map((m) => [m.role, m.state, m.content])).toEqual([
      ['user', 'done', 'Hi'],
      ['assistant', 'done', 'Hello from the desktop.'],
    ])

    // Past the half of the token's life the desktop sends a new one in a header; this transport carries it.
    const before = desktop.devices.length
    desktop.advance(45 * 60)
    await s().keepalive()
    desktop.advance(30 * 60)
    await s().verifyConnection()
    expect(s().status).toBe('connected')
    expect(desktop.devices.length).toBe(before)
    // Not one call went through the general proxy, and no address ever held the token or the code.
    expect(rust.calls.every((call) => call.cmd === 'remote_client_request')).toBe(true)
    expect(desktop.log.some((line) => line.includes('482913') || line.includes('token='))).toBe(false)
  })

  it('says "wrong code" and "ended on the desktop" in the words of the client', async () => {
    desktop = await startFakeDesktop({ passcode: '482913' })
    const { s } = await storeOver(fakeRust({ withRemoteCommand: true }).invoke)
    await s().connect(desktop.url, '000000')
    expect(s().status).toBe('needs-code')
    expect(s().error?.code).toBe('invalid-code')
    await s().submitCode('482913')
    expect(s().status).toBe('connected')
    desktop.dropAllDevices()
    await s().verifyConnection()
    expect(s().status).toBe('needs-code')
    expect(s().error?.code).toBe('session-expired')
  })

  it('a desktop that is gone is "unreachable", not a missing command', async () => {
    desktop = await startFakeDesktop({ passcode: '482913' })
    const url = desktop.url
    const { transport, s } = await storeOver(fakeRust({ withRemoteCommand: true }).invoke)
    await desktop.stop()
    desktop = null
    await s().connect(url, '482913')
    expect(s().error?.code).toBe('unreachable')
    expect(transport.via()).toBe('undecided')
  })

  it('falls back to the general proxy in a build without the command, and stays there', async () => {
    desktop = await startFakeDesktop({ passcode: '482913', reply: 'Over the proxy.' })
    const rust = fakeRust({ withRemoteCommand: false })
    const { transport, s } = await storeOver(rust.invoke)
    await s().connect(desktop.url, '482913')
    expect(s().status).toBe('connected')
    expect(transport.via()).toBe('proxy')
    const chatId = s().newChat()
    await s().sendMessage('Hi')
    expect(s().chats.find((c) => c.id === chatId)!.messages.at(-1)?.content).toBe('Over the proxy.')
    // The missing command was asked exactly once.
    expect(rust.calls.filter((call) => call.cmd === 'remote_client_request')).toHaveLength(1)
  })
})
