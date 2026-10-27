/**
 * Nachbau des Desktop-Servers aus `src-tauri/src/commands/remote.rs` fuer die
 * Tests des Remote-Clients. Ein echter node:http-Server auf 127.0.0.1, damit
 * der Client ueber einen echten Socket spricht: Abbruch, Verbindungsverlust
 * und ein verschwundener Server sind dann keine Attrappen.
 *
 * Nachgebildet sind die Regeln, auf die der Client reagieren muss, mit den
 * Statuscodes und Texten des Originals. `protocolPin.test.ts` liest remote.rs
 * und schlaegt an, wenn eine dieser Regeln dort verschwindet.
 *
 * Nicht nachgebildet: ComfyUI, WebSocket, Tunnel, die echten Werkzeuge.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { randomBytes } from 'node:crypto'
import { createDesktopSealedState, desktopSealed, type DesktopSealedState, type InnerAnswer, type InnerCall } from './fakeSealed'
import { createFakeCreate, fakeCreateRoute, fakeV2Features, type FakeCreate } from './fakeDesktopCreate'
import { createFakeChats, fakeChatsRoute, type FakeChats } from './fakeDesktopChats'

// Konstanten aus remote.rs.
export const PASSCODE_TTL_SECS = 900
export const JWT_TTL_SECS = 60 * 60
export const MAX_SESSION_SECS = 24 * 60 * 60
export const MAX_FAILED_ATTEMPTS = 3
export const COOLDOWN_SECS = 60
export const CHAT_EVENT_MAX_CONTENT = 100 * 1024

// Der Originaltext enthaelt einen Geviertstrich; hier als Escape, damit die
// Datei selbst keinen traegt.
const SESSION_ENDED_TEXT = 'Session ended \u2014 re-pair from the desktop.'
const MEMORY_REVOKED_TEXT =
  'Remote memory context was revoked. Restart Remote Access and reconnect before sending another request.'

interface TokenClaims {
  sub: string
  iat: number
  exp: number
}

interface Device {
  id: string
  ip: string
  user_agent: string
  last_seen: number
}

export interface FakeChatRequest {
  body: Record<string, unknown>
  /** Der Client hat die Verbindung geschlossen, bevor die Antwort fertig war. */
  clientGone: boolean
}

export interface FakeDesktopOptions {
  passcode?: string
  models?: string[]
  dispatchedModel?: string
  systemPrompt?: string
  /** Rechnername in /remote-api/status/full. 3.0.5 schickt keinen; ein spaeterer Desktop darf. */
  hostname?: string
  /** Antworttext fuer /api/chat. */
  reply?: string
  /**
   * 'buffered' (Vorgabe) ist das Verhalten von 3.0.5: der Desktop sammelt die
   * ganze Antwort und schickt sie am Stueck. 'chunked' schickt Zeile fuer Zeile
   * mit Pause, wie es ein Desktop mit echtem Streaming taete.
   */
  delivery?: 'buffered' | 'chunked'
  /** Wartezeit vor der Antwort (buffered) oder zwischen zwei Zeilen (chunked). */
  delayMs?: number
  /**
   * Desktop 3.0.7 mit versiegeltem Kanal (Attrappe aus fakeSealed.ts):
   * `POST /remote-api/sealed`, `features` im Status, Rechte je Geraet.
   */
  sealed?: boolean
  /**
   * Desktop 3.0.7 mit Create ueber den Kanal (fakeDesktopCreate.ts) und der
   * Anmeldung "Sign this phone in". `status/full` nennt im Kanal `signin` und,
   * mit Schalter und Recht `create`, `create-image` und `create-video`.
   */
  create?: boolean
  /**
   * A17: geteilte Chats (CHATS-V1.md, fakeDesktopChats.ts). Im Kanal nennt
   * der Status mit dem Recht `chat` die Merkmale chats, stream, approvals,
   * tasks. Bringt die Upload-Route von Create mit (Anhaenge).
   */
  chats?: boolean
}

export interface FakeDesktop {
  readonly url: string
  readonly port: number
  passcode: string
  permissions: { filesystem: boolean; downloads: boolean; process_control: boolean; shell: boolean }
  readonly devices: Device[]
  readonly chatRequests: FakeChatRequest[]
  readonly chatEvents: Array<Record<string, unknown>>
  readonly toolCalls: Array<Record<string, unknown>>
  /** Alle angenommenen Anfragen als "METHOD pfad". */
  readonly log: string[]
  reply: string
  delivery: 'buffered' | 'chunked'
  delayMs: number
  /** Lehnt Anfragen mit `think`-Feld mit 400 ab, wie ein altes Ollama. */
  rejectThink: boolean
  /** Das Modell-Backend des Desktops ist nicht erreichbar: 502. */
  backendDown: boolean
  /** Naechste Antwort auf einen Aufruf mit Werkzeugen. */
  nextToolCalls: Array<{ function: { name: string; arguments: unknown } }>
  /** Bricht den naechsten gestreamten Chat nach so vielen Zeilen hart ab. */
  killStreamAfterLines: number | null
  /** Der Code, den der Desktop gerade anzeigt. Ersetzt einen abgelaufenen, wie `remote_server_status`. */
  shownPasscode(): string
  /** Zeit des Servers vorstellen, in Sekunden. */
  advance(seconds: number): void
  /** Wie "Speicher geaendert" am Desktop: alles Geschuetzte antwortet 409. */
  revokeMemory(): void
  /** Wie Stop und erneutes Freigeben: neues Geheimnis, neue Liste, neuer Code. */
  restart(passcode?: string): void
  /** Wie "Trennen" in der Geraeteliste des Desktops. */
  dropAllDevices(): void
  /** Server weg: Port schliessen und alle Verbindungen kappen. */
  stop(): Promise<void>
  /** Nur mit `sealed`: die Seite des Kanals (Geraete, Tickets, Code, Rueckfrage). */
  readonly sealed: DesktopSealedState | null
  /** Nur mit `sealed`: der Status zeigt die Schluessel (WLAN-Listener). Aus = Tunnel-Listener. */
  statusKeys: boolean
  /** Der Desktop meldet im angemeldeten Status `lan_blocked: true` (sein WLAN ist gesperrt, etwa die Windows-Firewall). */
  lanBlocked: boolean
  /** Nur mit `create`: Auftraege, Uploads, Schalter, Antwort auf die Anmeldung. */
  readonly create: FakeCreate | null
  /** Nur mit `chats`. */
  readonly chats: FakeChats | null
}

function chunkText(text: string): string[] {
  const words = text.split(/(?<=\s)/)
  return words.length ? words : [text]
}

export async function startFakeDesktop(options: FakeDesktopOptions = {}): Promise<FakeDesktop> {
  let nowSecs = 1_800_000_000
  let secret = 1
  let tokenSeq = 0
  let memoryRevoked = false
  let passcodeExpiresAt = nowSecs + PASSCODE_TTL_SECS
  const tokens = new Map<string, TokenClaims & { secret: number }>()
  const failed = new Map<string, { count: number; until: number }>()
  const sockets = new Set<Socket>()
  const models = options.models ?? ['qwen3:8b', 'gemma4:e4b']
  // Innere Anfragen des Kanals gehen an den eigenen Router, mit dieser Marke statt eines Tokens.
  const internal = randomBytes(16).toString('hex')

  const state: FakeDesktop = {
    url: '',
    port: 0,
    passcode: options.passcode ?? '123456',
    permissions: { filesystem: false, downloads: false, process_control: false, shell: false },
    devices: [],
    chatRequests: [],
    chatEvents: [],
    toolCalls: [],
    log: [],
    reply: options.reply ?? 'Hello from the desktop model.',
    delivery: options.delivery ?? 'buffered',
    delayMs: options.delayMs ?? 0,
    rejectThink: false,
    backendDown: false,
    nextToolCalls: [],
    killStreamAfterLines: null,
    sealed: options.sealed ? createDesktopSealedState() : null,
    statusKeys: true,
    lanBlocked: false,
    create: options.create || options.chats ? createFakeCreate() : null,
    chats: options.chats ? createFakeChats() : null,
    shownPasscode() {
      rotateExpiredPasscode()
      return state.passcode
    },
    advance(seconds) {
      nowSecs += seconds
    },
    revokeMemory() {
      memoryRevoked = true
    },
    restart(passcode) {
      secret += 1
      memoryRevoked = false
      state.devices.length = 0
      failed.clear()
      state.passcode = passcode ?? state.passcode
      passcodeExpiresAt = nowSecs + PASSCODE_TTL_SECS
    },
    dropAllDevices() {
      state.devices.length = 0
    },
    stop() {
      // Gehaltene Long-Polls freigeben, sonst haelt ihre Uhr den Prozess.
      if (state.chats) for (const w of [...state.chats.waiters]) w()
      return new Promise<void>((resolve) => {
        for (const s of sockets) s.destroy()
        server.close(() => resolve())
      })
    },
  }

  /** Der abgelaufene Code wird ersetzt, der alte gilt nicht mehr. */
  function rotateExpiredPasscode(): void {
    if (nowSecs < passcodeExpiresAt) return
    let next = state.passcode
    while (next === state.passcode) next = String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')
    state.passcode = next
    passcodeExpiresAt = nowSecs + PASSCODE_TTL_SECS
  }

  function mint(sub: string, iat: number): string {
    tokenSeq += 1
    const token = `fake.${secret}.${tokenSeq}.${Math.random().toString(36).slice(2)}`
    tokens.set(token, { sub, iat, exp: nowSecs + JWT_TTL_SECS, secret })
    return token
  }

  function send(res: ServerResponse, status: number, body: string, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers })
    res.end(body)
  }

  function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'content-type': 'application/json', ...headers })
    res.end(JSON.stringify(body))
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      const parts: Buffer[] = []
      req.on('data', (c: Buffer) => parts.push(c))
      req.on('end', () => resolve(Buffer.concat(parts).toString('utf8')))
      req.on('error', () => resolve(''))
    })
  }

  function readBytes(req: IncomingMessage): Promise<Uint8Array> {
    return new Promise((resolve) => {
      const parts: Buffer[] = []
      req.on('data', (c: Buffer) => parts.push(c))
      req.on('end', () => resolve(new Uint8Array(Buffer.concat(parts))))
      req.on('error', () => resolve(new Uint8Array()))
    })
  }

  /** Eine innere Anfrage an den eigenen Router, wie der Desktop sie im Prozess weiterreicht. */
  async function routeInner(call: InnerCall): Promise<InnerAnswer> {
    const res = await fetch(`${state.url}${call.path}`, {
      method: call.method,
      headers: { ...call.headers, 'x-fake-sealed': internal },
      body: call.method === 'GET' || call.method === 'DELETE' || call.body.length === 0 ? undefined : Buffer.from(call.body),
    })
    const headers: Record<string, string> = {}
    for (const name of ['content-type', 'retry-after', 'x-lu-pending', 'x-lu-remote-memory-revoked', 'x-lu-offset', 'x-lu-total-bytes', 'x-lu-sha256']) {
      const v = res.headers.get(name)
      if (v) headers[name] = v
    }
    return { status: res.status, headers, body: new Uint8Array(await res.arrayBuffer()) }
  }

  function tokenFrom(req: IncomingMessage, url: URL): string {
    const auth = req.headers.authorization ?? ''
    if (auth.startsWith('Bearer ')) return auth.slice(7)
    const cookie = (req.headers.cookie ?? '')
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('lu-remote-token='))
    if (cookie) return cookie.slice('lu-remote-token='.length)
    return url.searchParams.get('token') ?? ''
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://fake')
    const path = url.pathname
    const method = req.method ?? 'GET'
    const ip = req.socket.remoteAddress ?? 'unknown'
    state.log.push(`${method} ${path}`)

    const requiresAuth =
      path.startsWith('/api/') ||
      path.startsWith('/comfyui/') ||
      path === '/ws' ||
      (path.startsWith('/remote-api/') && path !== '/remote-api/auth' && path !== '/remote-api/status' && path !== '/remote-api/sealed')

    // ── auth_middleware ──
    let caller = ''
    const extra: Record<string, string> = {}
    // Eine innere Anfrage des Kanals: die Kennung setzt der Desktop selbst. Ein x-lu-device aus dem Netz zaehlt nie.
    const sealedCaller =
      state.sealed && req.headers['x-fake-sealed'] === internal && typeof req.headers['x-lu-device'] === 'string' ? req.headers['x-lu-device'] : ''
    if (sealedCaller) {
      caller = sealedCaller
    } else if (requiresAuth) {
      const token = tokenFrom(req, url)
      if (!token) return send(res, 401, 'Missing authorization')
      const claims = tokens.get(token)
      if (!claims || claims.secret !== secret || claims.exp <= nowSecs) {
        return send(res, 401, 'Invalid or expired token')
      }
      const dev = state.devices.find((d) => d.id === claims.sub)
      if (!dev) return send(res, 401, SESSION_ENDED_TEXT)
      dev.last_seen = nowSecs
      caller = claims.sub
      // should_slide_session: ueber der Haelfte der Lebensdauer und unter der Obergrenze.
      const pastHalf = claims.exp > nowSecs && claims.exp - nowSecs < JWT_TTL_SECS / 2
      if (nowSecs - claims.iat < MAX_SESSION_SECS && pastHalf) {
        const fresh = mint(claims.sub, claims.iat)
        extra['x-lu-refreshed-token'] = fresh
        extra['set-cookie'] = `lu-remote-token=${fresh}; Path=/; Max-Age=${JWT_TTL_SECS}; SameSite=Strict`
      }
    }

    // ── memory_revocation_middleware (liegt hinter der Anmeldung) ──
    if (requiresAuth && memoryRevoked) {
      return send(res, 409, MEMORY_REVOKED_TEXT, { ...extra, 'x-lu-remote-memory-revoked': '1' })
    }

    // ── Oeffentliche Routen ──
    if (path === '/remote-api/status' && method === 'GET') {
      const sc = state.sealed
      if (!sc || sc.features === null) return sendJson(res, 200, { status: 'ok' })
      return sendJson(res, 200, {
        status: 'ok',
        protocol: 2,
        features: sc.features,
        ...(state.statusKeys ? { desktop_id: sc.desktopId, x25519: sc.x25519, name: sc.name } : {}),
      })
    }
    if (path === '/remote-api/sealed' && method === 'POST') {
      const sc = state.sealed
      if (!sc) {
        res.writeHead(302, { location: '/mobile' })
        return void res.end()
      }
      const body = await readBytes(req)
      const out = await desktopSealed(sc, body, (call) => routeInner(call))
      res.writeHead(out.status, { 'content-type': out.status === 200 ? 'application/octet-stream' : 'application/json', ...(out.headers ?? {}) })
      return void res.end(Buffer.from(out.body))
    }
    if (path === '/mobile' && method === 'GET') {
      return send(res, 200, '<!doctype html><title>LU Remote</title>', { 'content-type': 'text/html' })
    }

    if (path === '/remote-api/auth' && method === 'POST') {
      const parsed = safeJson(await readBody(req))
      if (!parsed || typeof parsed.passcode !== 'string') {
        return send(res, 422, 'Failed to deserialize the JSON body into the target type')
      }
      const f = failed.get(ip)
      if (f && f.count >= MAX_FAILED_ATTEMPTS) {
        if (nowSecs < f.until) return send(res, 429, `Too many attempts. Try again in ${f.until - nowSecs}s`)
        failed.delete(ip)
      }
      rotateExpiredPasscode()
      if (!state.passcode || parsed.passcode !== state.passcode) {
        const entry = failed.get(ip) ?? { count: 0, until: 0 }
        entry.count += 1
        if (entry.count >= MAX_FAILED_ATTEMPTS) entry.until = nowSecs + COOLDOWN_SECS
        failed.set(ip, entry)
        return send(res, 403, 'Invalid code')
      }
      failed.delete(ip)
      const id = `dev-${nowSecs}-${Math.random().toString(16).slice(2)}`
      const token = mint(id, nowSecs)
      // upsert_device: eine Zeile je Adresse. Ein zweites Koppeln von derselben
      // Adresse uebernimmt die Zeile, und damit endet die aeltere Sitzung.
      const ua = String(req.headers['user-agent'] ?? 'unknown')
      const existing = state.devices.find((d) => d.ip === ip)
      if (existing) Object.assign(existing, { id, user_agent: ua, last_seen: nowSecs })
      else state.devices.push({ id, ip, user_agent: ua, last_seen: nowSecs })
      return sendJson(res, 200, { token }, {
        'set-cookie': `lu-remote-token=${token}; Path=/; Max-Age=${JWT_TTL_SECS}; SameSite=Strict`,
      })
    }

    // ── Geschuetzte Routen ──
    if (path === '/remote-api/status/full' && method === 'GET') {
      // status_features: im Kanal sealed, pending, signin; Create nur mit Schalter und Recht des Geraets.
      const device = sealedCaller ? state.sealed?.devices.get(sealedCaller) : undefined
      const features: string[] = sealedCaller ? ['sealed', 'pending', ...(state.create ? ['signin'] : [])] : state.sealed ? ['sealed'] : []
      if (state.create?.enabled && (!sealedCaller || device?.rights.has('create'))) features.push('create-image', 'create-video', ...fakeV2Features(state.create))
      if (sealedCaller && state.chats?.enabled && device?.rights.has('chat')) features.push(...state.chats.features)
      return sendJson(res, 200, {
        app: 'LU',
        version: '3.0.5',
        connected_devices: state.devices.length,
        auth_required: true,
        ...(options.hostname ? { hostname: options.hostname } : {}),
        ...(state.sealed || state.create ? { features } : {}),
        ...(state.lanBlocked ? { lan_blocked: true } : {}),
      }, extra)
    }
    if (state.chats && sealedCaller && (path.startsWith('/remote-api/chats') || path.startsWith('/remote-api/approvals/') || path === '/remote-api/tasks' || path === '/remote-api/chat-models')) {
      const raw = method === 'GET' ? Buffer.alloc(0) : Buffer.from(await readBytes(req))
      const a = await fakeChatsRoute(state.chats, state.create, method, path, url.searchParams, raw)
      if (a) return sendJson(res, a.status, a.json ?? {}, { ...(a.headers ?? {}), ...extra })
    }
    if (state.create && caller && (path.startsWith('/remote-api/create/') || path === '/remote-api/signin/request')) {
      // Anmeldung nur fuer gekoppelte Geraete im Kanal.
      if (path === '/remote-api/signin/request' && !sealedCaller) return send(res, 404, '', extra)
      const raw = method === 'GET' ? Buffer.alloc(0) : Buffer.from(await readBytes(req))
      const a = fakeCreateRoute(state.create, method, path, url.searchParams, caller, raw, String(req.headers['content-type'] ?? ''), String(req.headers['x-lu-filename'] ?? ''))
      if (a) {
        if (a.body) {
          res.writeHead(a.status, { ...(a.headers ?? {}), ...extra })
          return void res.end(a.body)
        }
        return sendJson(res, a.status, a.json ?? {}, { ...(a.headers ?? {}), ...extra })
      }
    }
    if (path === '/remote-api/config' && method === 'GET') {
      return sendJson(res, 200, {
        model: options.dispatchedModel ?? models[0] ?? '',
        systemPrompt: options.systemPrompt ?? '',
        platformLine: 'This machine runs macOS and shell_execute runs bash.',
      }, extra)
    }
    if (path === '/remote-api/permissions') {
      if (method === 'POST') await readBody(req) // merge_remote_permissions: der Koerper aendert nichts
      return sendJson(res, 200, state.permissions, extra)
    }
    if (path === '/remote-api/devices' && method === 'GET') {
      return sendJson(res, 200, state.devices.filter((d) => d.id === caller), extra)
    }
    if (path === '/remote-api/disconnect' && method === 'POST') {
      const parsed = safeJson(await readBody(req))
      if (!parsed || parsed.id !== caller) return send(res, 403, '', extra)
      const i = state.devices.findIndex((d) => d.id === caller)
      if (i >= 0) state.devices.splice(i, 1)
      return send(res, 200, '', extra)
    }
    if (path === '/remote-api/chat-event' && method === 'POST') {
      const parsed = safeJson(await readBody(req))
      if (!parsed) return send(res, 422, 'Failed to deserialize the JSON body', extra)
      if (parsed.role !== 'user' && parsed.role !== 'assistant') {
        return send(res, 400, "Invalid role (must be 'user' or 'assistant')", extra)
      }
      if (Buffer.byteLength(String(parsed.content ?? ''), 'utf8') > CHAT_EVENT_MAX_CONTENT) {
        return send(res, 413, `Content exceeds ${CHAT_EVENT_MAX_CONTENT} bytes`, extra)
      }
      state.chatEvents.push(parsed)
      res.writeHead(204, extra)
      return void res.end()
    }
    if (path === '/remote-api/agent-tool' && method === 'POST') {
      const parsed = safeJson(await readBody(req))
      if (!parsed || typeof parsed.tool !== 'string') return send(res, 422, 'Failed to deserialize the JSON body', extra)
      state.toolCalls.push(parsed)
      const tool = parsed.tool
      const needs: Record<string, keyof FakeDesktop['permissions']> = {
        shell_execute: 'shell', code_execute: 'shell',
        file_read: 'filesystem', file_write: 'filesystem', file_list: 'filesystem', file_search: 'filesystem', screenshot: 'filesystem',
        image_generate: 'process_control', process_list: 'process_control',
      }
      const open = ['web_search', 'web_fetch', 'system_info', 'get_current_time']
      if (needs[tool]) {
        if (!state.permissions[needs[tool]]) {
          return sendJson(res, 200, {
            error: `Tool \`${tool}\` is gated behind the \`${needs[tool]}\` permission. Open the Menu, tap Settings, and turn it on under Remote Permissions.`,
            permission: needs[tool],
            needs_permission: true,
          }, extra)
        }
        if (tool === 'file_read') return sendJson(res, 200, { content: 'file body' }, extra)
        return sendJson(res, 200, { status: 'saved', path: 'out.txt' }, extra)
      }
      if (open.includes(tool)) return sendJson(res, 200, { time: '2026-10-08T12:00:00Z' }, extra)
      return sendJson(res, 200, { error: `\`${tool}\` is not available to remote clients.` }, extra)
    }

    // ── Proxy auf das Modell-Backend ──
    if (path === '/api/tags' && method === 'GET') {
      if (state.backendDown) return send(res, 502, 'Proxy error: error sending request', extra)
      return sendJson(res, 200, { models: models.map((name) => ({ name, model: name, modified_at: '', size: 0 })) }, extra)
    }
    if (path === '/api/chat' && method === 'POST') {
      const body = safeJson(await readBody(req)) ?? {}
      const record: FakeChatRequest = { body, clientGone: false }
      state.chatRequests.push(record)
      let finished = false
      res.on('close', () => {
        if (!finished) record.clientGone = true
      })
      if (state.backendDown) {
        finished = true
        return send(res, 502, 'Proxy error: error sending request for url', extra)
      }
      if (state.rejectThink && 'think' in body) {
        finished = true
        return sendJson(res, 400, { error: 'registry.ollama.ai/library/x does not support thinking' }, extra)
      }
      if (!models.includes(String(body.model))) {
        finished = true
        return sendJson(res, 404, { error: `model '${String(body.model)}' not found` }, extra)
      }

      if (body.stream !== true) {
        if (Array.isArray(body.tools) && String(body.model).startsWith('notools')) {
          finished = true
          return sendJson(res, 400, { error: `${String(body.model)} does not support tools` }, extra)
        }
        await sleep(state.delayMs)
        const message: Record<string, unknown> = { role: 'assistant', content: state.reply }
        if (state.nextToolCalls.length) {
          message.content = ''
          message.tool_calls = state.nextToolCalls
          state.nextToolCalls = []
        }
        finished = true
        return sendJson(res, 200, { model: body.model, created_at: '', message, done: true, done_reason: 'stop' }, extra)
      }

      const lines = chunkText(state.reply).map((piece) =>
        JSON.stringify({ model: body.model, created_at: '', message: { role: 'assistant', content: piece }, done: false }),
      )
      lines.push(JSON.stringify({ model: body.model, created_at: '', message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop' }))

      if (state.delivery === 'buffered') {
        // proxy_to_target liest die ganze Antwort des Backends, bevor es dem
        // Handy auch nur die Kopfzeilen schickt.
        await sleep(state.delayMs)
        if (record.clientGone) return
        finished = true
        res.writeHead(200, { 'content-type': 'application/x-ndjson', ...extra })
        return void res.end(lines.join('\n') + '\n')
      }

      res.writeHead(200, { 'content-type': 'application/x-ndjson', ...extra })
      let sent = 0
      for (const ln of lines) {
        if (record.clientGone) return
        if (state.killStreamAfterLines !== null && sent >= state.killStreamAfterLines) {
          state.killStreamAfterLines = null
          finished = true
          res.socket?.destroy()
          return
        }
        res.write(ln + '\n')
        sent += 1
        await sleep(state.delayMs)
      }
      finished = true
      return void res.end()
    }
    if (path.startsWith('/api/')) return sendJson(res, 200, {}, extra)

    // ── Alles andere: Umleitung auf die Handy-Seite ──
    res.writeHead(302, { location: '/mobile' })
    res.end()
  }

  const server: Server = createServer((req, res) => {
    handle(req, res).catch((err) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(err))
    })
  })
  server.on('connection', (s) => {
    sockets.add(s)
    s.on('close', () => sockets.delete(s))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  Object.assign(state, { url: `http://127.0.0.1:${port}`, port })
  return state
}

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
}
