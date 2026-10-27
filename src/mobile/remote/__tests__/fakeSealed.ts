/**
 * Attrappe des versiegelten Kanals fuer vitest und Playwright.
 *
 * Die echte Kryptographie (Noise, Saetze, Wiederholfenster) laeuft in Rust
 * und ist dort gegen einen Desktop im selben Prozess getestet
 * (`src-tauri/src/commands/remote_sealed_tests.rs`, `remote_seal/tests.rs`).
 * Ohne Rust gibt es hier eine Attrappe mit GLEICHEM Verhalten nach aussen:
 *   - dieselben Kommandos (`remote_sealed_pair`, `_request`, `_cancel`,
 *     `_forget`, `_fetch_result`, `_signin`) mit denselben Argumenten und Antworten,
 *   - dieselben Fehlertexte `remote_sealed: <code>[: detail]`,
 *   - derselbe Ablauf: Handschlag, Rueckfrage am Desktop, Aufdecken beim
 *     Code-Weg, ein stiller neuer Handschlag nach `session_unknown`, 202 mit
 *     `x-lu-pending` und Nachfragen, Pfadsperre, nur eine Route im Netz.
 * Der "Rahmen" ist KEINE Verschluesselung, nur ein Umschlag
 * (`LUFAKE1` + base64 JSON), damit der Nachbau des Desktops ihn lesen kann.
 *
 * `desktopSealed` ist die Seite des Desktops und wird von fakeDesktop.ts
 * benutzt; `createFakeSealedInvoke` ist die Seite des Handys.
 */
import { createHash, randomBytes } from 'node:crypto'
import { classifyHost, parsePairingInput } from '../pairingLink'

export const FAKE_FRAME_PREFIX = 'LUFAKE1'

export function encodeFrame(value: unknown): Uint8Array {
  return new TextEncoder().encode(FAKE_FRAME_PREFIX + Buffer.from(JSON.stringify(value)).toString('base64'))
}

export function decodeFrame(bytes: Uint8Array): Record<string, unknown> | null {
  const text = new TextDecoder().decode(bytes)
  if (!text.startsWith(FAKE_FRAME_PREFIX)) return null
  try {
    const v: unknown = JSON.parse(Buffer.from(text.slice(FAKE_FRAME_PREFIX.length), 'base64').toString('utf8'))
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

/** Sechs Ziffern aus Sitzung und (beim Code-Weg) der aufgedeckten Zahl. */
export function fakeSas(sid: string, nonce: string | null): string {
  const h = createHash('sha256').update(`sas\n${sid}\n${nonce ?? ''}`).digest()
  return String(h.readUInt32BE(0) % 1_000_000).padStart(6, '0')
}

export function fakeCommit(nonce: string): string {
  return createHash('sha256').update(`commit\n${nonce}`).digest('base64url')
}

/** Ein Desktop-Schluesselpaar der Attrappe: Kennung und "X25519" sind nur Zufall in der richtigen Form. */
export function fakeDesktopKeys(): { desktopId: string; x25519: string } {
  return { desktopId: b64url(randomBytes(16)), x25519: b64url(randomBytes(32)) }
}

// ── Seite des Desktops ───────────────────────────────────────────

export type SealedRight = 'chat' | 'agent' | 'files' | 'terminal' | 'create'

export interface SealedDevice {
  id: string
  name: string
  rights: Set<SealedRight>
}

export interface DesktopSealedState {
  desktopId: string
  x25519: string
  name: string
  /** Gekoppelte Geraete. */
  devices: Map<string, SealedDevice>
  /** Warten auf "Allow" am Desktop. */
  pending: Map<string, SealedDevice>
  tickets: Set<string>
  /** Der Code, den der Desktop im WLAN zeigt (Code-Weg). Ein Code, ein Handschlag. */
  code: string | null
  sessions: Map<string, { device: string; commit: string | null; revealed: string | null }>
  /** Was der Nutzer am Desktop auf die Rueckfrage antwortet: erst bei der n-ten Nachfrage. */
  answer: { allow: boolean; afterPolls: number } | null
  /** So viele kommende /api/chat-Anfragen werden zurueckgestellt (202), so viele Nachfragen bleibt es 202. */
  deferChats: number
  deferPolls: number
  /** Antwortet beim naechsten Handschlag mit 429. */
  rateLimitNext: boolean
  /** So viele Nachfragen bleibt die naechste Sign-in-Frage zurueckgestellt (202). */
  deferSignin: number
  /** Status-Liste der Faehigkeiten; `null` heisst: aelter als 3.0.7, kein Feld. */
  features: string[] | null
  /** Was im Netz ankam (Pfad je POST), fuer die Waechter. */
  wire: string[]
  /** Kopfzeilen, die der Router sah (nach dem Filter). */
  routed: Array<{ device: string; method: string; path: string; headers: Record<string, string> }>
  /** Wie Neustart des Desktops: alle Sitzungen weg. */
  restart(): void
  /** Ein Ticket ausstellen und den QR-Link bauen, wie der Desktop ihn zeigt. */
  qrLink(addresses: { lan?: string; net?: string }): string
  /** Der Vergleichscode, den der Desktop in seiner Rueckfrage zeigt (erst nach dem Aufdecken). */
  shownSas(): string | null
}

export function createDesktopSealedState(name = 'Studio PC'): DesktopSealedState {
  const keys = fakeDesktopKeys()
  const state: DesktopSealedState = {
    ...keys,
    name,
    devices: new Map(),
    pending: new Map(),
    tickets: new Set(),
    code: null,
    sessions: new Map(),
    answer: { allow: true, afterPolls: 1 },
    deferChats: 0,
    deferPolls: 0,
    rateLimitNext: false,
    deferSignin: 0,
    features: ['sealed', 'pending'],
    wire: [],
    routed: [],
    restart() {
      state.sessions.clear()
    },
    shownSas() {
      for (const [sid, sess] of state.sessions) if (sess.revealed) return fakeSas(sid, sess.revealed)
      return null
    },
    qrLink({ lan, net }) {
      const ticket = b64url(randomBytes(16))
      // Nur ein gueltiges Ticket: ein neuer QR-Code entwertet den alten (Desktop f06160672, pairing_link).
      state.tickets.clear()
      state.tickets.add(ticket)
      const q = new URLSearchParams({ v: '2', id: state.desktopId, k: state.x25519, t: ticket, n: state.name })
      if (lan) q.set('lan', lan)
      if (net) q.set('net', net)
      return `lu://remote?${q.toString()}`
    },
  }
  return state
}

export interface InnerCall {
  device: string
  method: string
  path: string
  headers: Record<string, string>
  body: Uint8Array
}

export interface InnerAnswer {
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

const RIGHT_OF_TOOL: Record<string, SealedRight> = {
  shell_execute: 'terminal',
  code_execute: 'terminal',
  process_list: 'terminal',
  file_read: 'files',
  file_write: 'files',
  file_list: 'files',
  file_search: 'files',
}

function jsonAnswer(status: number, value: unknown, headers: Record<string, string> = {}): InnerAnswer {
  return { status, headers: { 'content-type': 'application/json', ...headers }, body: new TextEncoder().encode(JSON.stringify(value)) }
}

/**
 * `POST /remote-api/sealed` am Desktop. `route` bekommt eine angemeldete
 * innere Anfrage (mit `x-lu-device`) und gibt die Antwort des Routers.
 */
export async function desktopSealed(
  state: DesktopSealedState,
  body: Uint8Array,
  route: (call: InnerCall) => Promise<InnerAnswer>,
): Promise<{ status: number; body: Uint8Array; headers?: Record<string, string> }> {
  const outer = (status: number, error: string, headers: Record<string, string> = {}) => ({
    status,
    body: new TextEncoder().encode(JSON.stringify({ error })),
    headers,
  })
  const f = decodeFrame(body)
  if (!f) return outer(400, 'bad_frame')
  if (f.k === 'init') {
    state.wire.push('handshake')
    if (state.rateLimitNext) {
      state.rateLimitNext = false
      return outer(429, 'rate_limited', { 'retry-after': '60' })
    }
    if (f.desktopX25519 !== state.x25519) return outer(401, 'handshake_failed')
    const device = String(f.device)
    const name = String(f.name ?? 'Phone')
    let st: 'paired' | 'pending'
    if (f.mode === 'ticket') {
      const t = String(f.ticket)
      if (!state.tickets.has(t)) return outer(401, 'unknown_ticket')
      state.tickets.delete(t)
      // Ein bekanntes Geraet mit Ticket gilt sofort als gekoppelt.
      if (state.devices.has(device)) st = 'paired'
      else {
        state.pending.set(device, { id: device, name, rights: new Set(['chat', 'agent']) })
        st = 'pending'
      }
    } else if (f.mode === 'code') {
      if (!state.code) return outer(401, 'unknown_ticket')
      if (f.code !== state.code) return outer(401, 'handshake_failed')
      if (typeof f.commit !== 'string') return outer(400, 'bad_inner')
      state.code = null
      state.pending.set(device, { id: device, name, rights: new Set(['chat', 'agent']) })
      st = 'pending'
    } else {
      if (state.devices.has(device)) st = 'paired'
      else if (state.pending.has(device)) st = 'pending'
      else return outer(401, 'unknown_device')
    }
    const sid = b64url(randomBytes(16))
    state.sessions.set(sid, { device, commit: f.mode === 'code' ? String(f.commit) : null, revealed: null })
    return {
      status: 200,
      body: encodeFrame({ k: 'resp', sid, desktopId: state.desktopId, name: state.name, state: st, features: state.features ?? [] }),
    }
  }
  if (f.k !== 'data') return outer(400, 'wrong_kind')
  state.wire.push('data')
  const sid = String(f.sid)
  const session = state.sessions.get(sid)
  if (!session) return outer(404, 'session_unknown')
  const id = String(f.id)
  const path = String(f.p)
  const method = String(f.m)
  // Am Desktop vor dem Router: nur drei Kopfzeilen bleiben, x-lu-device setzt der Desktop.
  const headers: Record<string, string> = {}
  for (const [k, v] of Object.entries((f.h as Record<string, string>) ?? {})) {
    if (['accept', 'content-type', 'x-lu-app-version', 'x-lu-filename'].includes(k)) headers[k] = v
  }
  headers['x-lu-device'] = session.device
  const reqBody = Buffer.from(String(f.b ?? ''), 'base64')
  state.routed.push({ device: session.device, method, path, headers })
  const answer = await innerRoute(state, session, { device: session.device, method, path, headers, body: reqBody }, route)
  return {
    status: 200,
    body: encodeFrame({ k: 'data', sid, id, s: answer.status, h: answer.headers, b: Buffer.from(answer.body).toString('base64') }),
  }
}

const deferred = new Map<string, { result: Promise<InnerAnswer>; polls: number; device: string }>()

async function innerRoute(
  state: DesktopSealedState,
  session: { device: string; commit: string | null; revealed: string | null },
  call: InnerCall,
  route: (call: InnerCall) => Promise<InnerAnswer>,
): Promise<InnerAnswer> {
  const { device, path, method } = call
  if (path === '/remote-api/pair/reveal' && method === 'POST') {
    const n = (JSON.parse(Buffer.from(call.body).toString('utf8') || '{}') as { n?: string }).n ?? ''
    if (!session.commit || fakeCommit(n) !== session.commit) {
      state.pending.delete(device)
      return jsonAnswer(400, { error: 'bad_reveal' })
    }
    session.revealed = n
    return jsonAnswer(200, { ok: true })
  }
  if (path === '/remote-api/pair/status') {
    const p = state.pending.get(device)
    if (state.devices.has(device)) return jsonAnswer(200, { state: 'paired' })
    if (!p) return jsonAnswer(200, { state: 'denied' })
    if (session.commit && !session.revealed) return jsonAnswer(403, { error: 'pairing_pending' })
    if (state.answer) {
      state.answer.afterPolls -= 1
      if (state.answer.afterPolls <= 0) {
        state.pending.delete(device)
        if (state.answer.allow) {
          state.devices.set(device, p)
          return jsonAnswer(200, { state: 'paired' })
        }
        return jsonAnswer(200, { state: 'denied' })
      }
    }
    return jsonAnswer(200, { state: 'pending' })
  }
  const dev = state.devices.get(device)
  if (!dev) return jsonAnswer(403, { error: 'pairing_pending' })
  if (path === '/remote-api/devices/self/forget' && method === 'POST') {
    state.devices.delete(device)
    for (const [sid, s] of state.sessions) if (s.device === device) state.sessions.delete(sid)
    return jsonAnswer(200, { ok: true })
  }
  if (path.startsWith('/remote-api/pending/')) {
    const token = path.slice('/remote-api/pending/'.length)
    const d = deferred.get(token)
    if (!d || d.device !== device) return jsonAnswer(404, { error: 'unknown_pending' })
    if (method === 'DELETE') {
      deferred.delete(token)
      return { status: 204, headers: {}, body: new Uint8Array() }
    }
    if (d.polls > 0) {
      d.polls -= 1
      return { status: 202, headers: { 'x-lu-pending': token }, body: new Uint8Array() }
    }
    deferred.delete(token)
    return d.result
  }
  // Rechte je Geraet (PROTOKOLL 12).
  if (path === '/api/chat' && !dev.rights.has('chat')) return jsonAnswer(403, { error: 'forbidden', right: 'chat' })
  // A17: Anhaenge im Chat laufen ueber die Upload-Route von Create, mit dem Recht chat oder create.
  if (path === '/remote-api/create/uploads' && (dev.rights.has('chat') || dev.rights.has('create'))) {
    /* erlaubt */
  } else if (path.startsWith('/remote-api/create/') && !dev.rights.has('create')) return jsonAnswer(403, { error: 'forbidden', right: 'create' })
  if ((path.startsWith('/remote-api/chats') || path.startsWith('/remote-api/approvals/') || path === '/remote-api/tasks' || path === '/remote-api/chat-models') && !dev.rights.has('chat')) return jsonAnswer(403, { error: 'forbidden', right: 'chat' })
  // Sign in: der Desktop haelt die Frage, nach 30 s als zurueckgestellte Antwort (hier: deferSignin Nachfragen).
  if (path === '/remote-api/signin/request' && state.deferSignin > 0) {
    const polls = state.deferSignin
    state.deferSignin = 0
    const token = b64url(randomBytes(16))
    deferred.set(token, { result: route(call), polls: polls - 1, device })
    return { status: 202, headers: { 'x-lu-pending': token }, body: new Uint8Array() }
  }
  if (path === '/remote-api/agent-tool') {
    const tool = String((JSON.parse(Buffer.from(call.body).toString('utf8') || '{}') as { tool?: string }).tool ?? '')
    const right = RIGHT_OF_TOOL[tool] ?? 'agent'
    if (!dev.rights.has(right)) return jsonAnswer(403, { error: 'forbidden', right })
  }
  if (path === '/api/chat' && state.deferChats > 0) {
    state.deferChats -= 1
    const token = b64url(randomBytes(16))
    deferred.set(token, { result: route(call), polls: state.deferPolls, device })
    return { status: 202, headers: { 'x-lu-pending': token }, body: new Uint8Array() }
  }
  return route(call)
}

// ── Seite des Handys (die Rust-Kommandos nachgebaut) ────────────

export interface FakeWireAnswer {
  status: number
  body: Uint8Array
  headers?: Record<string, string>
}

export interface FakeSealedPhone {
  invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
  /** Jede Adresse und jeder Pfad, die das "Handy" angesprochen hat. */
  readonly posts: string[]
  readonly deviceId: string
  /** Wie ein Neustart der App: alle Sitzungen weg (der Schluessel bleibt). */
  clearSessions(): void
}

const FORBIDDEN = ['/remote-api/sealed', '/remote-api/auth']

function forbiddenPath(path: string): boolean {
  if (!path.startsWith('/') || path.includes('//') || path.includes('\\') || /(^|\/)\.\.?(\/|$|\?)/.test(path)) return true
  const route = path.split('?')[0].toLowerCase().replace(/\/+$/, '')
  return FORBIDDEN.some((f) => route === f || route.startsWith(`${f}/`))
}

function isLan(baseUrl: string): boolean {
  try {
    const r = classifyHost(new URL(baseUrl).hostname)
    return r === 'lan'
  } catch {
    return false
  }
}

function sameOrigin(a: string | null | undefined, b: string): boolean {
  try {
    return !!a && new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

const fail = (code: string, detail?: string) => new Error(`remote_sealed: ${code}${detail ? `: ${detail}` : ''}`)

/**
 * Das Handy. `post(url, body)` traegt einen Rahmen zum Desktop; wirft es,
 * war der Desktop nicht erreichbar.
 */
export function createFakeSealedPhone(post: (url: string, body: Uint8Array) => Promise<FakeWireAnswer>): FakeSealedPhone {
  const deviceId = b64url(randomBytes(16))
  const sessions = new Map<string, { sid: string; x25519: string }>()
  const cancelled = new Set<string>()
  const posts: string[] = []

  async function send(baseUrl: string, frame: unknown): Promise<FakeWireAnswer> {
    const url = `${new URL(baseUrl).origin}/remote-api/sealed`
    posts.push(url)
    try {
      return await post(url, encodeFrame(frame))
    } catch {
      throw fail('unreachable', 'The desktop could not be reached.')
    }
  }

  function outerError(a: FakeWireAnswer): Error {
    let code = ''
    try {
      code = (JSON.parse(new TextDecoder().decode(a.body)) as { error?: string }).error ?? ''
    } catch {
      /* kein JSON */
    }
    if (code === 'rate_limited' || a.status === 429) return fail('rate_limited', a.headers?.['retry-after'] ?? '60')
    if (code && /^[a-z_]{1,40}$/.test(code)) return fail(code)
    if (a.status === 404 || (a.status >= 300 && a.status < 400)) return fail('not_supported')
    return fail('unreachable', `HTTP ${a.status}`)
  }

  async function handshake(
    baseUrl: string,
    desktopId: string,
    x25519: string,
    extra: Record<string, unknown>,
    deviceName: unknown,
  ): Promise<Record<string, unknown>> {
    const a = await send(baseUrl, { k: 'init', desktopX25519: x25519, device: deviceId, name: deviceName ?? 'Android phone', ...extra })
    if (a.status !== 200) throw outerError(a)
    const r = decodeFrame(a.body)
    if (!r || r.k !== 'resp') throw fail('bad_frame')
    if (r.desktopId !== desktopId) throw fail('wrong_desktop')
    sessions.set(desktopId, { sid: String(r.sid), x25519 })
    return r
  }

  async function roundTrip(baseUrl: string, desktopId: string, x25519: string, req: Record<string, unknown>): Promise<Record<string, unknown>> {
    let retried = false
    for (;;) {
      let s = sessions.get(desktopId)
      if (!s || s.x25519 !== x25519) {
        await handshake(baseUrl, desktopId, x25519, { mode: 'ik' }, undefined)
        s = sessions.get(desktopId)!
      }
      const a = await send(baseUrl, { k: 'data', sid: s.sid, ...req })
      if (a.status === 200) {
        const r = decodeFrame(a.body)
        if (!r || r.id !== req.id) throw fail('response_mismatch')
        return r
      }
      const err = outerError(a)
      const code = /^remote_sealed: ([a-z_]+)/.exec(err.message)?.[1] ?? ''
      if (['session_unknown', 'session_expired', 'decrypt_failed', 'unknown_device'].includes(code)) sessions.delete(desktopId)
      if (!retried && ['session_unknown', 'session_expired', 'decrypt_failed'].includes(code)) {
        retried = true
        continue
      }
      throw err
    }
  }

  function innerReq(method: string, path: string, headers: Record<string, string>, body: string | null, bodyBase64: string | null = null) {
    if (forbiddenPath(path)) throw fail('forbidden_path')
    const h: Record<string, string> = {}
    for (const [k, v] of Object.entries(headers)) {
      const name = k.toLowerCase()
      if (['accept', 'content-type', 'x-lu-app-version', 'x-lu-filename'].includes(name)) h[name] = v
    }
    if (body !== null && bodyBase64 !== null) throw fail('bad_inner')
    const b = bodyBase64 !== null ? Buffer.from(bodyBase64, 'base64').toString('base64') : Buffer.from(body ?? '', 'utf8').toString('base64')
    return { id: b64url(randomBytes(16)), m: method.toUpperCase(), p: path, h, b }
  }

  const invoke = async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
    switch (cmd) {
      case 'remote_sealed_pair': {
        const baseUrl = String(args.baseUrl)
        if (typeof args.link === 'string') {
          const target = parsePairingInput(args.link)
          const link = target?.sealed
          if (!link) throw fail('bad_link')
          if (!sameOrigin(link.lan, baseUrl) && !sameOrigin(link.tunnel, baseUrl)) throw fail('address_refused', 'the code does not name this address')
          const ticket = new URL(args.link).searchParams.get('t')
          sessions.delete(link.desktopId)
          const r = await handshake(baseUrl, link.desktopId, link.x25519, { mode: 'ticket', ticket }, args.deviceName)
          return {
            desktopId: link.desktopId,
            x25519: link.x25519,
            name: r.name,
            state: r.state,
            features: r.features,
            sas: fakeSas(String(r.sid), null),
            lan: link.lan,
            tunnel: link.tunnel,
            deviceId,
          }
        }
        if (typeof args.code === 'string') {
          if (!isLan(baseUrl)) throw fail('address_refused', 'the code works on Wi-Fi only')
          if (!/^\d{6}$/.test(args.code)) throw fail('bad_encoding')
          const desktopId = String(args.desktopId)
          const x25519 = String(args.x25519)
          const nonce = b64url(randomBytes(32))
          sessions.delete(desktopId)
          const r = await handshake(baseUrl, desktopId, x25519, { mode: 'code', code: args.code, commit: fakeCommit(nonce) }, args.deviceName)
          const rev = await roundTrip(baseUrl, desktopId, x25519, innerReq('POST', '/remote-api/pair/reveal', { 'content-type': 'application/json' }, JSON.stringify({ n: nonce })))
          if (Number(rev.s) < 200 || Number(rev.s) >= 300) {
            sessions.delete(desktopId)
            throw fail('bad_reveal')
          }
          return {
            desktopId,
            x25519,
            name: r.name,
            state: r.state,
            features: r.features,
            sas: fakeSas(String(r.sid), nonce),
            lan: baseUrl.replace(/\/+$/, ''),
            tunnel: null,
            deviceId,
          }
        }
        throw fail('bad_inner')
      }
      case 'remote_sealed_request': {
        const baseUrl = String(args.baseUrl)
        const desktopId = String(args.desktopId)
        const x25519 = String(args.x25519)
        const callId = typeof args.callId === 'string' ? args.callId : null
        const check = () => {
          if (callId && cancelled.has(callId)) {
            cancelled.delete(callId)
            throw fail('cancelled')
          }
        }
        let r = await roundTrip(
          baseUrl,
          desktopId,
          x25519,
          innerReq(
            String(args.method ?? 'GET'),
            String(args.path),
            (args.headers as Record<string, string>) ?? {},
            (args.body as string | null) ?? null,
            (args.bodyBase64 as string | null) ?? null,
          ),
        )
        for (;;) {
          check()
          const h = (r.h as Record<string, string>) ?? {}
          if (Number(r.s) !== 202 || !h['x-lu-pending']) break
          const token = h['x-lu-pending']
          r = await roundTrip(baseUrl, desktopId, x25519, innerReq('GET', `/remote-api/pending/${token}`, {}, null))
        }
        return { status: Number(r.s), headers: r.h ?? {}, bodyBase64: String(r.b ?? '') }
      }
      case 'remote_sealed_fetch_result': {
        // Wie Rust: Stuecke bis 4 MiB, Kopfzeilen pruefen, am Ende SHA-256; hoechstens 64 MiB.
        const baseUrl = String(args.baseUrl)
        const desktopId = String(args.desktopId)
        const x25519 = String(args.x25519)
        const resultId = String(args.resultId)
        const size = Number(args.size)
        const want = String(args.sha256).toLowerCase()
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(resultId) || !/^[0-9a-f]{64}$/.test(want)) throw fail('bad_inner')
        if (size > 64 * 1024 * 1024) throw fail('too_large')
        const parts: Buffer[] = []
        let have = 0
        while (have < size) {
          if (typeof args.callId === 'string' && cancelled.has(args.callId)) {
            cancelled.delete(args.callId)
            throw fail('cancelled')
          }
          const length = Math.min(size - have, 4 * 1024 * 1024)
          const r = await roundTrip(baseUrl, desktopId, x25519, innerReq('GET', `/remote-api/create/results/${resultId}?offset=${have}&length=${length}`, {}, null))
          const status = Number(r.s)
          if (status !== 200) throw fail(`http_${status}`)
          const h = (r.h as Record<string, string>) ?? {}
          if (h['x-lu-offset'] !== String(have) || h['x-lu-total-bytes'] !== String(size) || (h['x-lu-sha256'] ?? '').toLowerCase() !== want) throw fail('result_corrupt')
          const piece = Buffer.from(String(r.b ?? ''), 'base64')
          if (piece.length === 0 || piece.length > length) throw fail('result_corrupt')
          parts.push(piece)
          have += piece.length
        }
        const all = Buffer.concat(parts)
        if (createHash('sha256').update(all).digest('hex') !== want) throw fail('result_corrupt')
        return all.toString('base64')
      }
      case 'remote_sealed_signin': {
        const baseUrl = String(args.baseUrl)
        const desktopId = String(args.desktopId)
        const x25519 = String(args.x25519)
        let r = await roundTrip(baseUrl, desktopId, x25519, innerReq('POST', '/remote-api/signin/request', { 'content-type': 'application/json' }, '{}'))
        for (;;) {
          const h = (r.h as Record<string, string>) ?? {}
          if (Number(r.s) !== 202 || !h['x-lu-pending']) break
          r = await roundTrip(baseUrl, desktopId, x25519, innerReq('GET', `/remote-api/pending/${h['x-lu-pending']}`, {}, null))
        }
        const status = Number(r.s)
        const answer = { status, headers: r.h ?? {}, bodyBase64: String(r.b ?? '') }
        if (status !== 200) return { answer, proof: null }
        let body: { code?: unknown; expires?: unknown } = {}
        try {
          body = JSON.parse(Buffer.from(String(r.b ?? ''), 'base64').toString('utf8')) as typeof body
        } catch {
          throw fail('bad_inner')
        }
        if (typeof body.code !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(body.code)) throw fail('bad_inner')
        const time = Math.floor(Date.now() / 1000)
        // Keine echte Ed25519-Signatur: die Attrappe zeigt nur, dass genau dieser Code zu genau diesem Geraet signiert wurde.
        const signature = createHash('sha256').update(`signin\n${deviceId}\n${body.code}\n${time}`).digest('base64url')
        return { answer, proof: { code: body.code, expires: typeof body.expires === 'number' ? body.expires : null, time, signature } }
      }
      case 'remote_sealed_cancel':
        cancelled.add(String(args.callId))
        return false
      case 'remote_sealed_forget': {
        const desktopId = String(args.desktopId)
        let confirmed = false
        if (typeof args.baseUrl === 'string') {
          try {
            const r = await roundTrip(String(args.baseUrl), desktopId, String(args.x25519), innerReq('POST', '/remote-api/devices/self/forget', {}, null))
            confirmed = Number(r.s) >= 200 && Number(r.s) < 300
          } catch {
            confirmed = false
          }
        }
        sessions.delete(desktopId)
        return confirmed
      }
      default:
        throw new Error(`command ${cmd} not found`)
    }
  }

  return {
    invoke,
    posts,
    deviceId,
    clearSessions: () => sessions.clear(),
  }
}

/** Die "Signatur" der Attrappe fuer den Sign-in, damit eine Attrappe von lu-labs.ai sie pruefen kann. */
export function fakeSigninSignature(deviceId: string, code: string, time: number): string {
  return createHash('sha256').update(`signin\n${deviceId}\n${code}\n${time}`).digest('base64url')
}
