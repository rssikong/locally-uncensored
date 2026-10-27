/**
 * The transport of the remote client on the phone.
 *
 * The desktop server sends no CORS headers and speaks plain http in the
 * Wi-Fi, so the WebView cannot reach it itself: every call goes through
 * Rust. Two commands can carry it:
 *
 *   remote_client_request   one round trip that hands back status, body and
 *                           the renewed token (header x-lu-refreshed-token).
 *                           Written for exactly this, part of the native
 *                           layer (mobile-docs/NATIVE-SCHICHT.md). Every
 *                           call carries a `callId`, and an abort closes
 *                           the connection in Rust (remote_client_cancel).
 *   proxy_localhost         the general proxy of 3.0.5. It reaches the
 *                           desktop too, but loses every response header, so
 *                           a session ends hard 60 minutes after pairing.
 *
 * createDeviceFetch asks for the first and, when the build does not have it,
 * stays with the second for the rest of the session. In a plain browser
 * (developer server, Playwright) there is no Rust at all and the store uses
 * the fetch of the browser.
 *
 * Nothing here ever puts the token into an address or a log line.
 */
import { MEMORY_REVOKED_HEADER, REFRESH_HEADER, type RemoteFetch, type RemoteFetchInit } from '../../../remote/remoteClient'
import { createProxyLocalhostFetch, type TauriInvoke } from '../../../remote/tauriProxyTransport'

/** What remote_client_request answers. `memoryRevoked` is the field asked for in remote.md; older builds leave it out. */
export interface RemoteRequestAnswer {
  status: number
  body: string
  refreshedToken?: string | null
  memoryRevoked?: boolean | null
}

export interface DeviceFetchOptions {
  invoke: TauriInvoke
  /** True when the error says "this build has no such command". */
  isMissingCommand: (err: unknown) => boolean
}

/**
 * True when the build has no remote_client_request. Narrower on purpose than
 * the general check of the logic layer: that one also takes any "not found",
 * and a host that was not found is a network failure, not a missing command.
 */
export function isMissingRemoteCommand(err: unknown): boolean {
  const text = String((err as { message?: unknown } | null)?.message ?? err ?? '')
  if (/^remote_client_request:/i.test(text.trim())) return false
  return (
    /command\s+["'`]?remote_client_request["'`]?\s+not found/i.test(text) ||
    /remote_client_request["'`]?\s+not allowed/i.test(text) ||
    /unknown (backend )?command/i.test(text)
  )
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

/** Longest wait per path, in ms. The client cuts shorter calls off itself through the signal. */
export function timeoutForPath(path: string): number {
  if (path.startsWith('/api/chat')) return 660_000
  if (path.startsWith('/remote-api/agent-tool')) return 330_000
  return 30_000
}

/** "Bearer abc" from the header set the client built, or null. */
export function bearerFrom(headers: Record<string, string> | undefined): string | null {
  if (!headers) return null
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'authorization') continue
    const match = /^Bearer\s+(.+)$/i.exec(value.trim())
    return match ? match[1] : null
  }
  return null
}

function toResponse(answer: RemoteRequestAnswer): Response {
  const status = Number(answer.status)
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new TypeError(`remote_client_request: unusable status ${String(answer.status)}`)
  }
  const headers: Record<string, string> = {}
  if (typeof answer.refreshedToken === 'string' && answer.refreshedToken) headers[REFRESH_HEADER] = answer.refreshedToken
  if (answer.memoryRevoked === true) headers[MEMORY_REVOKED_HEADER] = '1'
  const noBody = status === 204 || status === 205 || status === 304
  return new Response(noBody ? null : (answer.body ?? ''), { status, headers })
}

let callCounter = 0

/** A name for one call, unique in this app run. Never derived from the token or the address. */
function nextCallId(): string {
  callCounter += 1
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `remote-${callCounter}-${random}`
}

/**
 * A RemoteFetch over remote_client_request. Every HTTP status comes back as
 * a Response; only a call that got no answer throws. An abort through the
 * signal rejects at once with an AbortError and closes the connection in
 * Rust through remote_client_cancel, so a stopped answer does not keep
 * streaming on the desktop until the time limit. A build without that
 * command simply lets the request run out, as before.
 */
export function createRemoteRequestFetch(invoke: TauriInvoke): RemoteFetch {
  return (url: string, init: RemoteFetchInit = {}) => {
    const signal = init.signal
    if (signal?.aborted) return Promise.reject(abortError())
    let target: URL
    try {
      target = new URL(url)
    } catch {
      return Promise.reject(new TypeError('remote_client_request: address not readable'))
    }
    const path = `${target.pathname}${target.search}`
    return new Promise<Response>((resolve, reject) => {
      let settled = false
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const callId = nextCallId()
      const onAbort = () =>
        finish(() => {
          void invoke('remote_client_cancel', { callId }).catch(() => {})
          reject(abortError())
        })
      signal?.addEventListener('abort', onAbort, { once: true })
      invoke('remote_client_request', {
        baseUrl: target.origin,
        path,
        method: init.method ?? 'GET',
        token: bearerFrom(init.headers),
        body: init.body ?? null,
        timeoutMs: timeoutForPath(target.pathname),
        callId,
      }).then(
        (answer) =>
          finish(() => {
            try {
              resolve(toResponse(answer as RemoteRequestAnswer))
            } catch (err) {
              reject(err)
            }
          }),
        (err) => finish(() => reject(err)),
      )
    })
  }
}

/**
 * The transport for the native app: remote_client_request while the build
 * has it, proxy_localhost otherwise. The choice is made by the first call
 * and kept.
 */
export function createDeviceFetch(options: DeviceFetchOptions): RemoteFetch & { via: () => 'request' | 'proxy' | 'undecided' } {
  const direct = createRemoteRequestFetch(options.invoke)
  const proxy = createProxyLocalhostFetch({ invoke: options.invoke })
  let via: 'request' | 'proxy' | 'undecided' = 'undecided'

  const fetchLike = async (url: string, init?: RemoteFetchInit): Promise<Response> => {
    if (via === 'proxy') return proxy(url, init)
    try {
      const res = await direct(url, init)
      via = 'request'
      return res
    } catch (err) {
      if (via === 'undecided' && options.isMissingCommand(err)) {
        via = 'proxy'
        return proxy(url, init)
      }
      // A failure of an existing command is a network failure for the client.
      if (err instanceof Error && (err.name === 'AbortError' || err instanceof TypeError)) throw err
      throw new TypeError(String(err))
    }
  }
  return Object.assign(fetchLike, { via: () => via })
}
