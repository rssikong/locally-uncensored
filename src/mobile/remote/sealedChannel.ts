/**
 * Der versiegelte Kanal zum Desktop (REMOTE-PROTOKOLL v2), von TypeScript aus
 * gesehen. Die eine duenne Schicht ueber den Rust-Kommandos aus
 * `src-tauri/src/commands/remote_sealed.rs`; aendert sich dort etwas, aendert
 * sich nur diese Datei.
 *
 * Was hier steht:
 *   - `createSealedFetch`: ein RemoteFetch, der jede Anfrage versiegelt ueber
 *     `remote_sealed_request` schickt. Der Remote-Client merkt keinen
 *     Unterschied, ausser dass er kein Token braucht.
 *   - `guardPlainFetch`: der Waechter fuer den alten Klartextweg. Ueber eine
 *     Internet-Adresse geht im Klartext nur `GET /remote-api/status` ohne
 *     Token, alles andere wird geworfen, bevor es den Transport erreicht.
 *     Rust prueft dasselbe noch einmal (`plain_route_allowed`).
 *   - `chooseChannel`: welcher Weg fuer welchen Desktop, nach `features` aus
 *     dem Status. Fuer einen festgenagelten Desktop nie Klartext (M2).
 *   - `sealedPair`, `sealedForget`: Koppeln und Entkoppeln.
 *
 * Kein Schluessel geht durch diese Datei: der Schluessel des Desktops ist
 * oeffentlich (er steht im QR), das Geheimnis des Handys bleibt in Rust.
 */
import { classifyHost, type RemoteRoute } from './pairingLink'
export { deviceFingerprint } from './fingerprint'
import type { RemoteFetch, RemoteFetchInit } from './remoteClient'
import {
  RemoteAbortedError,
  RemoteDowngradeError,
  RemoteError,
  RemoteInvalidAddressError,
  RemoteInvalidCodeError,
  RemoteNewKeyError,
  RemotePairingDeniedError,
  RemoteProtocolError,
  RemoteRateLimitedError,
  RemoteScanAgainError,
  RemoteScanNeededError,
  RemoteStaleAddressError,
  RemoteTimeoutError,
  RemoteUnpairedError,
  RemoteUnreachableError,
  RemoteUpdateDesktopError,
} from './remoteErrors'

export type SealedInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/** Das Wort im Status, an dem der Kanal haengt. */
export const FEATURE_SEALED = 'sealed'

/** Ein festgenagelter Desktop, wie die App ihn neben den Chats speichert. Nichts davon ist geheim. */
export interface SealedPin {
  desktopId: string
  /** X25519-Schluessel des Desktops, base64url, 43 Zeichen. */
  x25519: string
  /** Rechnername aus dem Handschlag. */
  name: string
  /** Zuletzt bekannte WLAN-Adresse. */
  lan: string | null
  /** Zuletzt bekannte Tunnel-Adresse. */
  tunnel: string | null
}

/** Was `remote_sealed_pair` antwortet. */
export interface SealedPairOutcome {
  desktopId: string
  x25519: string
  name: string
  state: 'paired' | 'pending'
  features: string[]
  /** Vergleichscode, sechs Ziffern. Auf dem Code-Weg erst nach dem Aufdecken gueltig. */
  sas: string | null
  lan: string | null
  tunnel: string | null
  deviceId: string
}

/** Was `remote_sealed_request` antwortet. */
interface SealedAnswer {
  status: number
  headers?: Record<string, string>
  bodyBase64?: string
}

/** Was aus dem Status (`GET /remote-api/status`) fuer die Wahl zaehlt. */
export interface DesktopStatus {
  features: string[]
  protocol: number
  /** Nur auf dem WLAN-Listener (Code-Weg). */
  desktopId: string | null
  x25519: string | null
  name: string | null
}

export function readDesktopStatus(raw: unknown): DesktopStatus {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const features = Array.isArray(o.features) ? o.features.filter((f): f is string => typeof f === 'string') : []
  const str = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : null)
  return {
    features,
    protocol: typeof o.protocol === 'number' ? o.protocol : 1,
    desktopId: str(o.desktop_id, /^[A-Za-z0-9_-]{22}$/),
    x25519: str(o.x25519, /^[A-Za-z0-9_-]{43}$/),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 64) : null,
  }
}

export function isInternetRoute(route: RemoteRoute): boolean {
  return route === 'tunnel' || route === 'public'
}

function routeOf(url: string): RemoteRoute | null {
  try {
    return classifyHost(new URL(url).hostname)
  } catch {
    return null
  }
}

// ── Wahl des Wegs ────────────────────────────────────────────────

export type ChannelChoice =
  /** Versiegelt, der Desktop ist festgenagelt. */
  | { kind: 'sealed' }
  /** Im WLAN mit dem sechsstelligen Code versiegelt koppeln (Vergleichscode). */
  | { kind: 'pair-code' }
  /** Alter Klartextweg im WLAN (Desktop bis 3.0.6). */
  | { kind: 'plain' }
  /** Nicht verbinden, mit diesem Fehler. */
  | { kind: 'refuse'; error: RemoteError }

/**
 * Welcher Weg zu einem Desktop. Der Status ist nicht authentisiert, also nur
 * ein Hinweis: er darf einen gekoppelten Desktop nie auf Klartext
 * zurueckstufen (R50-PRUEFUNG M2), und ueber das Internet gibt es ohne
 * Kanal gar nichts.
 */
export function chooseChannel(input: { route: RemoteRoute; features: string[] | null; pinned: boolean }): ChannelChoice {
  const sealed = !!input.features?.includes(FEATURE_SEALED)
  if (input.pinned) return sealed ? { kind: 'sealed' } : { kind: 'refuse', error: new RemoteDowngradeError() }
  if (isInternetRoute(input.route)) {
    return sealed ? { kind: 'refuse', error: new RemoteScanNeededError() } : { kind: 'refuse', error: new RemoteUpdateDesktopError() }
  }
  return sealed ? { kind: 'pair-code' } : { kind: 'plain' }
}

// ── Der Waechter fuer den Klartextweg ───────────────────────────

/** Geworfen, wenn etwas im Klartext an eine Internet-Adresse sollte. */
export class SealedOnlyError extends RemoteError {
  constructor(detail?: string) {
    super(
      'update-desktop',
      'Over the internet this phone only uses the secure connection. Update LU on your computer, or connect on the same Wi-Fi.',
      { detail },
    )
  }
}

function hasAuthorization(init: RemoteFetchInit | undefined): boolean {
  return Object.keys(init?.headers ?? {}).some((h) => h.toLowerCase() === 'authorization')
}

/**
 * Darf diese Anfrage im Klartext raus? Im WLAN ja (alter Weg), ueber eine
 * Internet-Adresse nur der nackte Status ohne Token, damit die App die
 * `features` lesen kann.
 */
export function plainAllowed(url: string, init?: RemoteFetchInit): boolean {
  const route = routeOf(url)
  if (route === null) return false
  if (!isInternetRoute(route)) return true
  let path = ''
  try {
    const u = new URL(url)
    path = `${u.pathname}${u.search}`
  } catch {
    return false
  }
  const method = (init?.method ?? 'GET').toUpperCase()
  return path === '/remote-api/status' && method === 'GET' && !hasAuthorization(init) && init?.body === undefined
}

/** Der Klartext-Transport hinter dem Waechter. */
export function guardPlainFetch(inner: RemoteFetch): RemoteFetch {
  return (url, init) => {
    if (!plainAllowed(url, init)) {
      let where = ''
      try {
        where = new URL(url).pathname
      } catch {
        /* nichts */
      }
      return Promise.reject(new SealedOnlyError(`refused plain ${init?.method ?? 'GET'} ${where}`))
    }
    return inner(url, init)
  }
}

// ── Fehler aus Rust ──────────────────────────────────────────────

/** `remote_sealed: <code>[: detail]` aus dem Fehlertext eines Kommandos. */
export function sealedErrorCode(err: unknown): { code: string; detail: string } | null {
  const text = String((err as { message?: unknown } | null)?.message ?? err ?? '')
  const m = /^remote_sealed: ([a-z0-9_]+)(?::\s?([\s\S]*))?$/.exec(text.trim())
  return m ? { code: m[1], detail: m[2] ?? '' } : null
}

/** True, wenn der Bau das Kommando nicht hat (App aelter als 3.0.7 oder Browser). */
export function isMissingSealedCommand(err: unknown): boolean {
  const text = String((err as { message?: unknown } | null)?.message ?? err ?? '')
  if (/^remote_sealed:/.test(text.trim())) return false
  return /remote_sealed_[a-z_]+["'`]?\s+(not found|not allowed)/i.test(text) || /unknown (backend )?command/i.test(text)
}

/** Ein Fehler des Kanals als Fehlerklasse des Clients. */
export function sealedError(err: unknown, viaTunnel: boolean, onWifi = false): RemoteError {
  if (err instanceof RemoteError) return err
  const parsed = sealedErrorCode(err)
  if (!parsed) return new RemoteUnreachableError(viaTunnel, String((err as { message?: unknown })?.message ?? err))
  const { code, detail } = parsed
  switch (code) {
    case 'cancelled':
      return new RemoteAbortedError()
    case 'timeout':
      // No answer on the Wi-Fi way: the text names the firewall (A17, Windows box).
      return new RemoteTimeoutError(detail, undefined, { wifi: onWifi })
    case 'unreachable':
      return new RemoteUnreachableError(viaTunnel, detail)
    case 'rate_limited':
      return new RemoteRateLimitedError(Number(detail) > 0 ? Number(detail) : 60, code)
    case 'unknown_device':
      return new RemoteUnpairedError(code)
    case 'handshake_failed':
    case 'wrong_desktop':
      return new RemoteNewKeyError(code)
    case 'unknown_ticket':
      return new RemoteScanAgainError(code)
    case 'pairing_denied':
      return new RemotePairingDeniedError(code)
    case 'not_supported':
      return new RemoteUpdateDesktopError(code)
    case 'address_refused':
      return /wi-?fi/i.test(detail) ? new RemoteScanNeededError(detail) : new RemoteInvalidAddressError(detail)
    case 'bad_encoding':
      return new RemoteInvalidCodeError(code)
    default:
      // bad_frame, version_unsupported, bad_reveal, decrypt_failed nach dem Wiederholen, ...
      return new RemoteProtocolError(undefined, `${code}${detail ? `: ${detail}` : ''}`)
  }
}

/**
 * Wie `sealedError`, aber fuer einen festgenagelten Desktop. Dort heisst
 * `not_supported` (404 auf `/remote-api/sealed`) nicht "Desktop zu alt": den
 * Kanal hatte er ja schon. Die Adresse ist veraltet (neuer Tunnel, ein Name im
 * WLAN zeigt woandershin), und die App sucht ihn neu.
 */
export function sealedErrorPinned(err: unknown, viaTunnel: boolean, onWifi = false): RemoteError {
  if (!(err instanceof RemoteError) && sealedErrorCode(err)?.code === 'not_supported') return new RemoteStaleAddressError(viaTunnel, 'not_supported')
  return sealedError(err, viaTunnel, onWifi)
}

// ── Kommandos ────────────────────────────────────────────────────

function decodeBase64(text: string): Uint8Array {
  const bin = atob(text)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

let callCounter = 0
function nextCallId(): string {
  callCounter += 1
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)
  return `sealed-${callCounter}-${random}`
}

/** Laengste Wartezeit je Pfad, deferred answers inbegriffen. */
export function sealedTimeoutFor(path: string): number {
  if (path.startsWith('/api/chat')) return 660_000
  if (path.startsWith('/remote-api/agent-tool')) return 330_000
  return 30_000
}

export interface SealedFetchOptions {
  invoke: SealedInvoke
  /** Der festgenagelte Desktop. Null heisst: nicht gekoppelt, jede Anfrage scheitert. */
  pin: () => SealedPin | null
  /** Die Adresse, ueber die der Desktop gerade erreicht wird (WLAN oder Tunnel). */
  address: () => string | null
  deviceName?: () => string | undefined
}

/**
 * RemoteFetch ueber den versiegelten Kanal. Der Ursprung der URL ist egal,
 * es zaehlt nur der Pfad: die Anfrage geht an die Adresse, unter der der
 * festgenagelte Desktop gerade erreichbar ist. Ein `Authorization` wird nie
 * mitgeschickt, die Kennung des Handys beweist der Kanal selbst.
 */
export function createSealedFetch(options: SealedFetchOptions): RemoteFetch {
  return (url: string, init: RemoteFetchInit = {}) => {
    const signal = init.signal
    if (signal?.aborted) return Promise.reject(abortError())
    const pin = options.pin()
    const base = options.address()
    if (!pin || !base) return Promise.reject(new RemoteUnpairedError('no pin'))
    let path: string
    try {
      const u = new URL(url)
      path = `${u.pathname}${u.search}`
    } catch {
      return Promise.reject(new TypeError('remote_sealed: address not readable'))
    }
    const viaTunnel = isInternetRoute(routeOf(base) ?? 'lan')
    const headers: Record<string, string> = { accept: 'application/json' }
    for (const [k, v] of Object.entries(init.headers ?? {})) {
      if (k.toLowerCase() === 'content-type') headers['content-type'] = v
    }
    return new Promise<Response>((resolve, reject) => {
      let settled = false
      const callId = nextCallId()
      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        fn()
      }
      const onAbort = () =>
        finish(() => {
          void options.invoke('remote_sealed_cancel', { callId }).catch(() => {})
          reject(abortError())
        })
      signal?.addEventListener('abort', onAbort, { once: true })
      options
        .invoke('remote_sealed_request', {
          baseUrl: base,
          desktopId: pin.desktopId,
          x25519: pin.x25519,
          path,
          method: init.method ?? 'GET',
          headers,
          body: init.body ?? null,
          timeoutMs: sealedTimeoutFor(path),
          callId,
          deviceName: options.deviceName?.() ?? null,
        })
        .then(
          (raw) =>
            finish(() => {
              const answer = raw as SealedAnswer
              const status = Number(answer?.status)
              if (!Number.isInteger(status) || status < 200 || status > 599) {
                reject(new RemoteProtocolError(undefined, `sealed status ${String(answer?.status)}`))
                return
              }
              const noBody = status === 204 || status === 205 || status === 304
              const bytes = decodeBase64(answer.bodyBase64 ?? '')
              resolve(new Response(noBody ? null : (bytes as BodyInit), { status, headers: answer.headers ?? {} }))
            }),
          (err) =>
            finish(() => {
              const e = sealedErrorPinned(err, viaTunnel, routeOf(base) === 'lan')
              reject(e instanceof RemoteAbortedError ? abortError() : e)
            }),
        )
    })
  }
}

export interface SealedPairArgs {
  baseUrl: string
  /** QR-Weg: der gescannte Link. */
  link?: string
  /** Code-Weg (nur WLAN): Code und der Schluessel aus dem WLAN-Status. */
  code?: string
  desktopId?: string
  x25519?: string
  deviceName?: string
}

export async function sealedPair(invoke: SealedInvoke, args: SealedPairArgs): Promise<SealedPairOutcome> {
  const viaTunnel = isInternetRoute(routeOf(args.baseUrl) ?? 'lan')
  try {
    const raw = (await invoke('remote_sealed_pair', {
      baseUrl: args.baseUrl,
      link: args.link ?? null,
      code: args.code ?? null,
      desktopId: args.desktopId ?? null,
      x25519: args.x25519 ?? null,
      deviceName: args.deviceName ?? null,
    })) as Record<string, unknown>
    const state = raw?.state === 'paired' ? 'paired' : raw?.state === 'pending' ? 'pending' : null
    if (!raw || typeof raw.desktopId !== 'string' || typeof raw.x25519 !== 'string' || !state) {
      throw new RemoteProtocolError(undefined, 'pair answer')
    }
    return {
      desktopId: raw.desktopId,
      x25519: raw.x25519,
      name: typeof raw.name === 'string' ? raw.name : '',
      state,
      features: Array.isArray(raw.features) ? raw.features.filter((f): f is string => typeof f === 'string') : [],
      sas: typeof raw.sas === 'string' && /^\d{6}$/.test(raw.sas) ? raw.sas : null,
      lan: typeof raw.lan === 'string' ? raw.lan : null,
      tunnel: typeof raw.tunnel === 'string' ? raw.tunnel : null,
      deviceId: typeof raw.deviceId === 'string' ? raw.deviceId : '',
    }
  } catch (err) {
    const code = sealedErrorCode(err)?.code
    // A wrong six digit code fails the handshake: that is "wrong code", not "new key".
    if (args.code && code === 'handshake_failed') throw new RemoteInvalidCodeError('handshake_failed')
    // The code is no longer shown on the computer (used up, expired, panel closed).
    if (args.code && code === 'unknown_ticket') throw new RemoteScanAgainError('unknown_ticket', true)
    // A QR code of 3.0.7 whose address no longer leads to its computer: a new QR code has the current one.
    if (args.link && code === 'not_supported') throw new RemoteScanAgainError('not_supported')
    throw sealedError(err, viaTunnel, routeOf(args.baseUrl) === 'lan')
  }
}

/** Am Desktop abmelden (wenn erreichbar) und die Sitzung vergessen. Wirft nie. */
export async function sealedForget(invoke: SealedInvoke, pin: SealedPin, baseUrl: string | null): Promise<boolean> {
  try {
    return (await invoke('remote_sealed_forget', { desktopId: pin.desktopId, x25519: pin.x25519, baseUrl })) === true
  } catch {
    return false
  }
}

/** Die Adressen eines festgenagelten Desktops in der Reihenfolge des Wiederfindens: WLAN, Auskunft, letzte Tunnel-Adresse. */
export function candidateAddresses(pin: SealedPin, lookedUp: string | null): string[] {
  const out: string[] = []
  for (const a of [pin.lan, lookedUp, pin.tunnel]) if (a && !out.includes(a)) out.push(a)
  return out
}
