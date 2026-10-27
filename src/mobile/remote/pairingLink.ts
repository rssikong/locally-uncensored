/**
 * Kopplungsdaten lesen: reine Funktionen, kein Netz, kein Zustand.
 *
 * Was der Desktop in 3.0.5 wirklich anzeigt (remote.rs, `remote_qr_code` und
 * `start_remote_server`):
 *   - im WLAN       http://<LAN-IP>:11435/mobile
 *   - ueber Tunnel  https://<zufall>.trycloudflare.com/mobile
 *   - daneben, getrennt, den sechsstelligen Code. Er steht NICHT im QR-Bild.
 *
 * Zusaetzlich wird das Format `lu://remote?url=...&code=...` verstanden. Der
 * Desktop erzeugt es heute nicht; es ist die Form, in der ein kuenftiger
 * Desktop Adresse und Code in einem Bild uebergeben kann, und die Form, in der
 * das Betriebssystem der App einen Link zustellt.
 */

/** Port, auf dem der Desktop lauscht (remote.rs, `RemoteServer::new`). */
export const REMOTE_DEFAULT_PORT = 11435

/** Laenge des Kopplungscodes (remote.rs, `generate_passcode`). */
export const PASSCODE_LENGTH = 6

export type RemoteRoute =
  /** Derselbe Rechner, nur fuer Entwicklung und Tests. */
  | 'loopback'
  /** Privates Netz: Klartext-http im WLAN. */
  | 'lan'
  /** Cloudflare-Schnelltunnel, immer https. */
  | 'tunnel'
  /** Irgendeine andere oeffentliche Adresse. */
  | 'public'

export interface PairingTarget {
  /** Ursprung ohne Pfad, zum Beispiel `http://192.168.1.20:11435`. */
  baseUrl: string
  /** Sechs Ziffern, falls die Eingabe einen Code mitbrachte. */
  code: string | null
  route: RemoteRoute
  /** https oder nicht. Klartext geht aus der WebView nicht ins WLAN. */
  secure: boolean
  host: string
  /** Woraus die Angaben stammen, fuer die Anzeige "Link erkannt". */
  source: 'deep-link' | 'url' | 'address'
  /**
   * Nur beim QR-Code von 3.0.7 (`lu://remote?v=2&...`): der versiegelte
   * Kanal mit festgenageltem Schluessel. `baseUrl` ist dann die WLAN-Adresse,
   * sonst die Tunnel-Adresse.
   */
  sealed?: SealedLink
}

/**
 * Inhalt des QR-Codes v2 (PROTOKOLL 5.1). Alles darin ist oeffentlich bis auf
 * das Ticket, das genau einmal und nur 5 Minuten gilt. Die Rust-Seite liest
 * den Link (`uri`) beim Koppeln selbst noch einmal und prueft streng; diese
 * Pruefung hier entscheidet nur, ob die App ihn anbietet.
 */
export interface SealedLink {
  /** Der Link, wie er gescannt wurde. Geht nur an `remote_sealed_pair`. */
  uri: string
  desktopId: string
  x25519: string
  name: string
  lan: string | null
  tunnel: string | null
}

function isIpv4(host: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return null
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as [number, number, number, number]
  return o.every((n) => n <= 255) ? o : null
}

/**
 * Pure: eine Adresse, die keine WLAN-Adresse ist, obwohl sie wie eine
 * aussieht: 25.0.0.0/8 (Hamachi) und 100.64.0.0/10 (Tailscale, CGNAT). Ein
 * Desktop meldet sie manchmal als seine Adresse, und Nutzer tippen sie ab.
 * Nimmt eine Adresse, einen Ursprung oder eine ganze URL.
 */
export function isNotWifiAddress(input: string | null | undefined): boolean {
  const raw = (input ?? '').trim()
  if (!raw) return false
  const host = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#:]*)/i.exec(raw)?.[1] ?? raw.split(/[/:?#]/)[0]).toLowerCase()
  const v4 = isIpv4(host)
  if (!v4) return false
  return v4[0] === 25 || (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127)
}

/** Einordnung des Hosts, deckungsgleich mit `is_registerable_lan_host` in proxy.rs. */
export function classifyHost(hostname: string): RemoteRoute {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h === '::1' || h.endsWith('.localhost')) return 'loopback'
  const v4 = isIpv4(h)
  if (v4) {
    if (v4[0] === 127) return 'loopback'
    if (v4[0] === 10) return 'lan'
    if (v4[0] === 172 && v4[1] >= 16 && v4[1] <= 31) return 'lan'
    if (v4[0] === 192 && v4[1] === 168) return 'lan'
    if (v4[0] === 100 && v4[1] >= 64 && v4[1] <= 127) return 'lan'
    return 'public'
  }
  if (h.includes(':')) {
    // IPv6: fc00::/7 und fe80::/10 sind lokal.
    return /^(fc|fd)[0-9a-f]{2}:/.test(h) || /^fe[89ab][0-9a-f]:/.test(h) ? 'lan' : 'public'
  }
  if (/\.(local|lan|internal|intra|home|home\.arpa)$/.test(h)) return 'lan'
  if (!h.includes('.')) return 'lan'
  if (h.endsWith('.trycloudflare.com')) return 'tunnel'
  return 'public'
}

/**
 * Aus dem, was getippt oder gescannt wurde, den Server-Ursprung machen.
 * Nimmt `192.168.1.20`, `192.168.1.20:11435`, ganze http(s)-Adressen samt
 * `/mobile` und Tunnel-Adressen. Eine nackte Adresse bekommt http und den
 * Standardport, https behaelt seinen eigenen. Zugangsdaten in der Adresse
 * werden abgelehnt.
 */
export function normalizeRemoteBase(input: string): string | null {
  let raw = (input || '').trim()
  if (!raw || /\s/.test(raw)) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `http://${raw}`
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
  if (u.username || u.password) return null
  const host = u.hostname
  if (!host) return null
  // Der URL-Parser rechnet Zahlenformen in IPv4 um: aus `1.2.3` wird 1.2.0.3,
  // aus `3232235796` wird 192.168.1.20, aus `123456` wird 0.1.226.64. Wer so
  // etwas eintippt, meint keine Adresse (meist ist es der Code im falschen
  // Feld), und als Umgehung von Adressfiltern sind diese Formen bekannt.
  // Deshalb muss eine IPv4-Adresse genau so dastehen, wie sie gemeint ist.
  const typedHost = (/^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(raw)?.[1] ?? '').replace(/:\d*$/, '').toLowerCase()
  if (isIpv4(host) && typedHost !== host) return null
  if (/^[\d.]+$/.test(typedHost) && !isIpv4(typedHost)) return null
  // Cloud-Metadaten und link-local: die Rust-Seite lehnt sie ohnehin ab.
  const v4 = isIpv4(host)
  if (v4 && ((v4[0] === 169 && v4[1] === 254) || v4[0] === 0)) return null
  let port = u.port
  if (!port && u.protocol === 'http:') port = String(REMOTE_DEFAULT_PORT)
  return `${u.protocol}//${host}${port ? `:${port}` : ''}`
}

/** Code aus einer Eingabe wie "123 456" oder "123-456". Null, wenn es keine sechs Ziffern sind. */
export function normalizePasscode(input: string | null | undefined): string | null {
  if (!input) return null
  const digits = input.replace(/[\s-]/g, '')
  return new RegExp(`^\\d{${PASSCODE_LENGTH}}$`).test(digits) ? digits : null
}

function build(baseUrl: string, code: string | null, source: PairingTarget['source']): PairingTarget {
  const u = new URL(baseUrl)
  return {
    baseUrl,
    code,
    route: classifyHost(u.hostname),
    secure: u.protocol === 'https:',
    host: u.hostname,
    source,
  }
}

function codeFromParams(...sets: URLSearchParams[]): string | null {
  for (const p of sets) {
    const c = normalizePasscode(p.get('code') ?? p.get('passcode') ?? p.get('c'))
    if (c) return c
  }
  return null
}

const B64URL = /^[A-Za-z0-9_-]+$/

/** base64url ohne Padding mit genau `chars` Zeichen und kanonischen Endbits. */
function isB64url(text: string | null, chars: number): text is string {
  if (!text || text.length !== chars || !B64URL.test(text)) return false
  // 22 Zeichen tragen 16 Byte (die letzten 4 Bits null), 43 Zeichen 32 Byte (die letzten 2 Bits null).
  const last = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.indexOf(text[text.length - 1])
  return chars === 22 ? (last & 0b1111) === 0 : chars === 43 ? (last & 0b11) === 0 : true
}

/** Tunnel-Adresse nach PROTOKOLL 14.2: `https://<label>.trycloudflare.com`, klein, ohne Port und Pfad. */
export function isTunnelAddress(text: string | null | undefined): text is string {
  if (!text) return false
  const m = /^https:\/\/([a-z0-9-]{1,63})\.trycloudflare\.com$/.exec(text)
  return !!m && !m[1].startsWith('-') && !m[1].endsWith('-')
}

/** WLAN-Adresse im QR: `http://<host>:<port>`, nichts dahinter. */
function isLanOrigin(text: string | null): text is string {
  if (!text || text.endsWith('/')) return false
  try {
    const u = new URL(text)
    return u.protocol === 'http:' && !!u.hostname && !!u.port && u.pathname === '/' && !u.search && !u.hash && !u.username && `${u.protocol}//${u.host}` === text
  } catch {
    return false
  }
}

function parseSealedLink(text: string, q: URLSearchParams): PairingTarget | null {
  for (const key of ['v', 'id', 'k', 't', 'n', 'lan', 'net']) if (q.getAll(key).length > 1) return null
  const desktopId = q.get('id')
  const x25519 = q.get('k')
  const ticket = q.get('t')
  const name = q.get('n')
  const lan = q.get('lan')
  const net = q.get('net')
  if (!isB64url(desktopId, 22) || !isB64url(x25519, 43) || !isB64url(ticket, 22)) return null
  // eslint-disable-next-line no-control-regex
  if (!name || [...name].length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(name)) return null
  if (lan !== null && !isLanOrigin(lan)) return null
  if (net !== null && !isTunnelAddress(net)) return null
  if (lan === null && net === null) return null
  const base = lan ?? net
  if (!base) return null
  return {
    ...build(base, null, 'deep-link'),
    sealed: { uri: text, desktopId, x25519, name, lan, tunnel: net },
  }
}

function parseDeepLink(text: string): PairingTarget | null {
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return null
  }
  if (u.protocol !== 'lu:') return null
  // lu://remote?url=... (Host-Form) und lu:///remote?url=... oder lu:remote?... (Pfad-Form).
  const where = (u.hostname || u.pathname.replace(/^\/+/, '')).toLowerCase()
  if (where !== 'remote' && !where.startsWith('remote/')) return null
  const q = u.searchParams
  // QR v2 (3.0.7): nur die Host-Form, genau so, wie der Desktop sie schreibt.
  if (q.has('v')) return q.get('v') === '2' && /^lu:\/\/remote\?/i.test(text) ? parseSealedLink(text, q) : null
  let base: string | null = null
  // `address` is the name an older form of the link used. One reader for all of them (review N3).
  const target = q.get('url') ?? q.get('u') ?? q.get('address')
  if (target) {
    base = normalizeRemoteBase(target)
  } else if (q.get('host')) {
    const tls = q.get('tls') === '1' || q.get('tls') === 'true' || q.get('scheme') === 'https'
    const port = q.get('port')
    if (port && !/^\d{1,5}$/.test(port)) return null
    base = normalizeRemoteBase(`${tls ? 'https' : 'http'}://${q.get('host')}${port ? `:${port}` : ''}`)
  }
  if (!base) return null
  return build(base, codeFromParams(q), 'deep-link')
}

/**
 * Alles lesen, was bei der Kopplung hereinkommen kann: QR-Inhalt, eingefuegter
 * Link, getippte Adresse, `lu://remote`-Link. Gibt null zurueck, wenn daraus
 * keine Adresse wird. Stellt nie eine Verbindung her.
 *
 * Auch "Adresse und Code in einer Zeile" wird verstanden, weil Menschen genau
 * das aus einer Nachricht kopieren: `http://192.168.1.20:11435/mobile 123456`.
 */
export function parsePairingInput(input: string): PairingTarget | null {
  const text = (input || '').trim()
  if (!text) return null

  if (/^lu:/i.test(text)) return parseDeepLink(text)

  // Adresse und Code in einem Text: genau ein Stueck ist die Adresse, der Rest
  // ergibt zusammen die sechs Ziffern ("123456" oder "123 456").
  const parts = text.split(/[\s,;]+/).filter(Boolean)
  let trailingCode: string | null = null
  let addressPart = text
  if (parts.length === 2 || parts.length === 3) {
    for (let i = 0; i < parts.length; i++) {
      if (normalizePasscode(parts[i]) || !normalizeRemoteBase(parts[i])) continue
      const rest = normalizePasscode(parts.filter((_, j) => j !== i).join(''))
      if (rest) {
        trailingCode = rest
        addressPart = parts[i]
        break
      }
    }
  }

  const base = normalizeRemoteBase(addressPart)
  if (!base) return null

  let code = trailingCode
  const hadScheme = /^https?:\/\//i.test(addressPart)
  if (!code) {
    try {
      const u = new URL(hadScheme ? addressPart : `http://${addressPart}`)
      code = codeFromParams(u.searchParams, new URLSearchParams(u.hash.replace(/^#/, '')))
    } catch {
      /* normalizeRemoteBase hat die Adresse schon angenommen */
    }
  }
  return build(base, code, hadScheme ? 'url' : 'address')
}

/** Kurzform fuer die Anzeige, ohne Schema: `192.168.1.20:11435`. */
export function displayAddress(baseUrl: string): string {
  try {
    const u = new URL(baseUrl)
    return u.host
  } catch {
    return baseUrl
  }
}
