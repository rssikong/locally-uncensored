import { afterEach, describe, expect, it } from 'vitest'
import { RemoteInvalidCodeError, RemoteSessionExpiredError, RemoteUnreachableError, createRemoteClient } from '../remoteClient'
import { createProxyLocalhostFetch, type TauriInvoke } from '../tauriProxyTransport'
import { JWT_TTL_SECS, startFakeDesktop, type FakeDesktop } from './fakeDesktop'

/**
 * Nachbau der drei Rust-Kommandos aus `src-tauri/src/commands/proxy.rs`, so wie
 * sie sich von JavaScript aus verhalten: Erfolg gibt den Koerper als Text,
 * jeder andere Status wird zu Err("HTTP <status>: <text>"), ein Abbruch zu
 * Err("proxy_localhost: cancelled"), ein Netzfehler zu einem anderen Text.
 * Antwort-Kopfzeilen gehen dabei verloren, genau wie im Original.
 */
function fakeInvoke(opts: { refuseHost?: boolean } = {}) {
  const calls: Array<{ cmd: string; args: Record<string, unknown> }> = []
  const running = new Map<string, AbortController>()
  const invoke: TauriInvoke = async (cmd, args = {}) => {
    calls.push({ cmd, args })
    if (cmd === 'register_openai_host') {
      if (opts.refuseHost) throw `refused: '${String(args.host)}' is not a usable backend host`
      return null
    }
    if (cmd === 'cancel_proxy_call') {
      running.get(String(args.callId))?.abort()
      return null
    }
    if (cmd === 'proxy_localhost') {
      const ctrl = new AbortController()
      running.set(String(args.callId), ctrl)
      try {
        const res = await fetch(String(args.url), {
          method: String(args.method),
          headers: (args.headers as Record<string, string> | null) ?? undefined,
          body: (args.body as string | null) ?? undefined,
          signal: ctrl.signal,
        })
        const text = await res.text()
        if (!res.ok) throw `HTTP ${res.status}: ${text}`
        return text
      } catch (err) {
        if (typeof err === 'string') throw err
        if (ctrl.signal.aborted) throw 'proxy_localhost: cancelled'
        throw `proxy_localhost: error sending request for url (${String(args.url)})`
      } finally {
        running.delete(String(args.callId))
      }
    }
    throw `unknown command ${cmd}`
  }
  return { invoke, calls }
}

let desktop: FakeDesktop | null = null
afterEach(async () => {
  await desktop?.stop()
  desktop = null
})

function clientOver(invoke: TauriInvoke, baseUrl: string) {
  const session = { token: '' }
  const client = createRemoteClient({
    baseUrl,
    fetch: createProxyLocalhostFetch({ invoke }),
    getToken: () => session.token,
    onToken: (t) => {
      session.token = t
    },
  })
  return { client, session }
}

describe('Transport ueber proxy_localhost', () => {
  it('koppelt, liest Modelle und chattet ueber die vorhandenen Kommandos', async () => {
    desktop = await startFakeDesktop({ reply: 'Through the proxy.' })
    const { invoke, calls } = fakeInvoke()
    const { client } = clientOver(invoke, desktop.url)

    await client.probe()
    await client.pair('123456')
    expect(await client.listModels()).toEqual(['qwen3:8b', 'gemma4:e4b'])
    const result = await client.streamChat({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }] })
    expect(result).toMatchObject({ content: 'Through the proxy.', completed: true })

    const chat = calls.find((c) => c.cmd === 'proxy_localhost' && String(c.args.url).endsWith('/api/chat'))
    expect(chat?.args.method).toBe('POST')
    expect((chat?.args.headers as Record<string, string>).Authorization).toMatch(/^Bearer /)
    // Loopback steht schon auf der Freigabeliste, eine Anmeldung waere ueberfluessig.
    expect(calls.some((c) => c.cmd === 'register_openai_host')).toBe(false)
  })

  it('uebersetzt die Fehlertexte von Rust zurueck in Statuscodes', async () => {
    desktop = await startFakeDesktop()
    const { invoke } = fakeInvoke()
    const { client } = clientOver(invoke, desktop.url)
    await expect(client.pair('000000')).rejects.toBeInstanceOf(RemoteInvalidCodeError)
    await client.pair('123456')
    desktop.advance(JWT_TTL_SECS + 1)
    await expect(client.listModels()).rejects.toBeInstanceOf(RemoteSessionExpiredError)
  })

  it('meldet einen Host einmal an, bevor er ihn anspricht, und einen abgelehnten Host als nicht erreichbar', async () => {
    const seen: string[] = []
    const invoke: TauriInvoke = async (cmd, args = {}) => {
      seen.push(cmd === 'register_openai_host' ? `register ${String(args.host)}` : cmd)
      if (cmd === 'proxy_localhost') return '{"status":"ok"}'
      return null
    }
    const lan = createRemoteClient({ baseUrl: 'http://192.168.1.20:11435', fetch: createProxyLocalhostFetch({ invoke }) })
    await lan.probe()
    await lan.probe()
    expect(seen).toEqual(['register 192.168.1.20', 'proxy_localhost', 'proxy_localhost'])

    const refused = createRemoteClient({
      baseUrl: 'http://192.168.1.20:11435',
      fetch: createProxyLocalhostFetch({ invoke: fakeInvoke({ refuseHost: true }).invoke }),
    })
    await expect(refused.probe()).rejects.toBeInstanceOf(RemoteUnreachableError)
  })

  it('gibt einen Abbruch an Rust weiter', async () => {
    desktop = await startFakeDesktop({ delayMs: 2_000 })
    const { invoke, calls } = fakeInvoke()
    const { client } = clientOver(invoke, desktop.url)
    await client.pair('123456')
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 30)
    const result = await client.streamChat({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], signal: ctrl.signal })
    expect(result).toMatchObject({ completed: false, stopReason: 'aborted' })
    const chatCall = calls.find((c) => c.cmd === 'proxy_localhost' && String(c.args.url).endsWith('/api/chat'))
    expect(calls.some((c) => c.cmd === 'cancel_proxy_call' && c.args.callId === chatCall?.args.callId)).toBe(true)
    await expect.poll(() => desktop!.chatRequests[0].clientGone).toBe(true)
  })

  it('belegt die Luecke: ohne Antwort-Kopfzeilen kommt das verlaengerte Token nie an', async () => {
    desktop = await startFakeDesktop()
    const { invoke } = fakeInvoke()
    const { client, session } = clientOver(invoke, desktop.url)
    const first = await client.pair('123456')
    desktop.advance(40 * 60)
    await client.checkSession()
    // Der Desktop hat ein neues Token ausgestellt, aber es stand in einer Kopfzeile.
    expect(session.token).toBe(first)
    desktop.advance(21 * 60)
    await expect(client.checkSession()).rejects.toBeInstanceOf(RemoteSessionExpiredError)
  })
})
