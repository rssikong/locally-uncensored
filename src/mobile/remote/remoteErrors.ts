/**
 * Fehlerklassen des Remote-Clients.
 *
 * Jede Klasse traegt einen stabilen `code` (fuer die Oberflaeche und fuer
 * Tests) und einen englischen `userMessage`, der so, wie er ist, angezeigt
 * werden kann. Die Texte nennen immer den naechsten Schritt und enthalten
 * keine Gedankenstriche. `message` (das Feld von Error) ist derselbe Text,
 * technische Einzelheiten stehen in `detail`.
 */

export type RemoteErrorCode =
  | 'invalid-address'
  | 'unreachable'
  | 'timeout'
  | 'not-lu'
  | 'invalid-code'
  | 'rate-limited'
  | 'session-expired'
  | 'memory-revoked'
  | 'permission-denied'
  | 'backend'
  | 'connection-lost'
  | 'aborted'
  | 'protocol'
  /** Das gewaehlte Modell kann keine Werkzeuge. */
  | 'tools-unsupported'
  // ── Versiegelter Kanal (REMOTE-PROTOKOLL v2) ──
  /** Ueber das Internet nur versiegelt, und der Desktop kann das nicht (aelter als 3.0.7). */
  | 'update-desktop'
  /** Ueber das Internet nur mit dem QR-Code, nie mit dem sechsstelligen Code (E2). */
  | 'scan-needed'
  /** Ein gekoppelter Desktop bot den versiegelten Weg nicht an: kein Rueckfall auf Klartext (M2). */
  | 'downgrade'
  /** Der Desktop kennt dieses Handy nicht (mehr). */
  | 'unpaired'
  /** Der Desktop hat einen neuen Schluessel oder es antwortet ein anderer. */
  | 'new-key'
  /** Der Nutzer am Desktop hat abgelehnt oder nicht geantwortet. */
  | 'pairing-denied'
  /** Ticket aus dem QR-Code abgelaufen oder schon benutzt. */
  | 'scan-again'
  /** Im WLAN-Status fehlen Schluessel und Name: am Desktop ist das Kopplungsfenster zu (H1). */
  | 'open-pairing'
  /** Ein gekoppelter Desktop antwortet unter dieser Adresse nicht mehr (404): Adresse veraltet. */
  | 'stale-address'

/** Was ein Store oder eine Oberflaeche von einem Fehler behalten darf. */
export interface RemoteErrorInfo {
  code: RemoteErrorCode
  message: string
  status?: number
  retryAfterSeconds?: number
  detail?: string
}

export class RemoteError extends Error {
  readonly code: RemoteErrorCode
  /** Text fuer den Nutzer, englisch, mit naechstem Schritt. */
  readonly userMessage: string
  /** HTTP-Status, falls der Fehler aus einer Antwort stammt. */
  readonly status?: number
  /** Rohtext der Gegenseite oder der Transportschicht, nie fuer die Anzeige. */
  readonly detail?: string

  constructor(code: RemoteErrorCode, userMessage: string, opts: { status?: number; detail?: string } = {}) {
    super(userMessage)
    this.name = new.target.name
    this.code = code
    this.userMessage = userMessage
    this.status = opts.status
    this.detail = opts.detail
  }

  toInfo(): RemoteErrorInfo {
    const info: RemoteErrorInfo = { code: this.code, message: this.userMessage }
    if (this.status !== undefined) info.status = this.status
    if (this.detail) info.detail = this.detail.slice(0, 500)
    return info
  }
}

export class RemoteInvalidAddressError extends RemoteError {
  constructor(detail?: string) {
    super(
      'invalid-address',
      'That address does not look right. Enter the address shown on your desktop, for example 192.168.1.20:11435.',
      { detail },
    )
  }
}

/**
 * Der Schritt im WLAN, an dem der Desktop nicht antwortete (Davids Fund
 * A17): probe = Status lesen, auth = koppeln, bootstrap = Einstellungen,
 * Modelle und Rechte nach dem Koppeln. Der Schritt und der Aufruf stehen in
 * `detail`, die Meldung nennt den naechsten Schritt dazu.
 */
export type PairStep = 'probe' | 'auth' | 'bootstrap'

/** Hinweis, wenn eine Adresse keine WLAN-Adresse ist (Hamachi, Tailscale, CGNAT). */
export const NOT_WIFI_TEXT =
  'This is not the Wi-Fi address of your computer, it belongs to a VPN such as Hamachi or Tailscale. Use the Wi-Fi address shown under Remote Access on your computer, usually 192.168.x.x.'

const STEP_TEXT: Record<PairStep, string> = {
  probe:
    'Your desktop did not answer at this address. Check that LU is open there with Remote Access on, that this phone is on the same Wi-Fi, and that the address matches the one under Remote Access on your desktop.',
  auth: 'Your desktop answered, then stopped answering while pairing. Check that the pairing window is still open on your desktop, then tap Try again.',
  bootstrap:
    'Pairing worked, but your desktop stopped answering while sending its models and settings. Tap Try again. If it happens again, restart Remote Access on your desktop.',
}

export interface StepInfo {
  step: PairStep
  /** Der Aufruf, etwa "GET /remote-api/status". */
  call: string
  /** Die Adresse ist keine WLAN-Adresse (25.0.0.0/8, 100.64.0.0/10): Hinweis anhaengen. */
  notWifi?: boolean
}

function stepped(base: string, info: StepInfo | undefined): string {
  if (!info) return base
  return info.notWifi ? `${STEP_TEXT[info.step]} ${NOT_WIFI_TEXT}` : STEP_TEXT[info.step]
}

function stepDetail(info: StepInfo | undefined, detail: string | undefined): string | undefined {
  if (!info) return detail
  return `${info.step}: ${info.call}${detail ? `: ${detail}` : ''}`
}

export class RemoteUnreachableError extends RemoteError {
  readonly step?: PairStep

  constructor(viaTunnel: boolean, detail?: string, step?: StepInfo) {
    super(
      'unreachable',
      viaTunnel
        ? 'Cannot reach your desktop over the internet link. The link changes every time Remote Access restarts, so scan the new QR code on your desktop.'
        : stepped('Cannot reach your desktop. Check that LU is open there with Remote Access turned on and that this phone is on the same Wi-Fi.', step),
      { detail: stepDetail(step, detail) },
    )
    this.step = step?.step
  }
}

/**
 * No answer at all on the Wi-Fi way (Windows box, 21.10.2026): the Windows
 * firewall blocks a new LU.exe silently, and the phone waited for nothing.
 */
export const WIFI_TIMEOUT_TEXT =
  'Your computer did not answer on Wi-Fi. On Windows this is usually the firewall: open Remote Access in LU on the computer and choose Allow LU. Or use the internet link.'

/** Pure: is a timeout of this step one where nothing answered at all (the firewall), not one after an answer. */
function silentOnWifi(step: StepInfo | undefined): boolean {
  if (!step) return true
  if (step.notWifi) return false
  // The QR way starts with the pairing itself; the code way asks the status first.
  return step.step === 'probe' || (step.step === 'auth' && step.call.includes('/remote-api/sealed'))
}

export class RemoteTimeoutError extends RemoteError {
  readonly step?: PairStep
  /** The timeout was on the Wi-Fi way: the text names the firewall. */
  readonly wifi: boolean

  constructor(detail?: string, step?: StepInfo, opts: { wifi?: boolean } = {}) {
    const wifi = (opts.wifi === true || (!!step && !step.notWifi)) && silentOnWifi(step)
    super('timeout', wifi ? WIFI_TIMEOUT_TEXT : stepped('Your desktop took too long to answer. Check the connection and try again.', step), { detail: stepDetail(step, detail) })
    this.step = step?.step
    this.wifi = wifi
  }
}

/**
 * Pure: ein Fehler "antwortet nicht" eines Schritts im WLAN mit Schritt und
 * Aufruf. Andere Fehler, Tunnel-Fehler und schon zugeordnete bleiben, wie sie sind;
 * eine Hamachi- oder Tailscale-Adresse sieht wie das Internet aus und bekommt den Satz trotzdem.
 */
export function atPairStep(err: unknown, info: StepInfo): unknown {
  if (err instanceof RemoteUnreachableError && !err.step && (info.notWifi || !/internet link/.test(err.userMessage))) return new RemoteUnreachableError(false, err.detail, info)
  if (err instanceof RemoteTimeoutError && !err.step) return new RemoteTimeoutError(err.detail, info, { wifi: err.wifi })
  return err
}

export class RemoteNotLuError extends RemoteError {
  constructor(status?: number, detail?: string) {
    super(
      'not-lu',
      'Something answered at that address, but it is not LU Remote Access. Check the address on your desktop and try again.',
      { status, detail },
    )
  }
}

export class RemoteInvalidCodeError extends RemoteError {
  constructor(detail?: string) {
    super(
      'invalid-code',
      'That code is not correct. Check the 6 digit code on your desktop and try again. After 3 wrong tries you have to wait a minute.',
      { status: 403, detail },
    )
  }
}

export class RemoteRateLimitedError extends RemoteError {
  readonly retryAfterSeconds: number

  constructor(retryAfterSeconds: number, detail?: string) {
    const secs = Math.max(1, Math.round(retryAfterSeconds))
    super('rate-limited', `Too many wrong codes. Try again in ${secs} ${secs === 1 ? 'second' : 'seconds'}.`, {
      status: 429,
      detail,
    })
    this.retryAfterSeconds = secs
  }

  override toInfo(): RemoteErrorInfo {
    return { ...super.toInfo(), retryAfterSeconds: this.retryAfterSeconds }
  }
}

/**
 * Desktop 3.0.7 beendet die Sitzung der App, sobald dasselbe Handy die
 * Handy-Webseite desselben Rechners im Browser koppelt (eine Sitzung je
 * Adresse). Genau bei diesem 401 ("Session ended") sagt die App das.
 */
export const SESSION_ENDED_BROWSER =
  'This also happens when the same computer is open in the browser of this phone at the same time, so close that page first.'

/** Warum der Server ein Token nicht mehr annimmt. */
export type SessionEndReason = 'missing' | 'expired' | 'ended'

export class RemoteSessionExpiredError extends RemoteError {
  readonly reason: SessionEndReason

  constructor(reason: SessionEndReason, detail?: string) {
    super(
      'session-expired',
      reason === 'ended'
        ? `Your desktop ended this session. ${SESSION_ENDED_BROWSER} Enter the current code from your desktop to pair again.`
        : 'Your session has expired. Enter the current code from your desktop to pair again.',
      { status: 401, detail },
    )
    this.reason = reason
  }
}

export class RemoteMemoryRevokedError extends RemoteError {
  constructor(detail?: string) {
    super(
      'memory-revoked',
      'Memory was changed on your desktop during this session. Restart Remote Access on the desktop, then pair again.',
      { status: 409, detail },
    )
  }
}

export class RemotePermissionError extends RemoteError {
  /** Name des Schalters am Desktop, falls der Server ihn nennt. */
  readonly permission?: string

  /**
   * `right` ist ein Recht je Geraet aus dem versiegelten Kanal (PROTOKOLL 12):
   * chat, agent, files, terminal, create. Dann sagt der Text ehrlich, dass es
   * am Rechner fuer dieses Handy aus ist.
   */
  constructor(permission: string | undefined, detail?: string, right?: string) {
    super(
      'permission-denied',
      right
        ? `${RIGHT_WORDS[right] ?? 'This'} is not allowed on your computer for this phone. Turn it on for this phone in the Remote settings of LU on your computer.`
        : 'Your desktop does not allow this for remote devices. Turn it on under Remote Permissions on the desktop and try again.',
      { status: 403, detail },
    )
    this.permission = permission ?? right
  }
}

const RIGHT_WORDS: Record<string, string> = {
  chat: 'Chat',
  agent: 'Agent mode',
  files: 'File access',
  terminal: 'The terminal',
  create: 'Create',
}

export class RemoteBackendError extends RemoteError {
  constructor(status: number | undefined, detail?: string) {
    super(
      'backend',
      status === 502 || status === 504
        ? 'Your desktop could not reach its model backend. Check that a model is loaded on the desktop and try again.'
        : 'Your desktop reported an error while answering. Check that the model is loaded there and try again.',
      { status, detail },
    )
  }
}

/** Was vom Stream schon da war, als er abbrach. */
export interface PartialReply {
  content: string
  thinking: string
}

export class RemoteConnectionLostError extends RemoteError {
  readonly partial: PartialReply

  constructor(partial: PartialReply, detail?: string) {
    super(
      'connection-lost',
      'The connection dropped while the answer was coming in. What arrived so far is saved. Check the connection and send again.',
      { detail },
    )
    this.partial = partial
  }
}

export class RemoteAbortedError extends RemoteError {
  constructor() {
    super('aborted', 'Stopped.')
  }
}

export class RemoteProtocolError extends RemoteError {
  constructor(status?: number, detail?: string) {
    super(
      'protocol',
      'Your desktop sent an answer this app does not understand. Update LU on the desktop and on this phone.',
      { status, detail },
    )
  }
}

export function isRemoteError(err: unknown): err is RemoteError {
  return err instanceof RemoteError
}

/** Beliebigen Wurf in eine anzeigbare Form bringen, ohne je zu werfen. */
export function toRemoteErrorInfo(err: unknown): RemoteErrorInfo {
  if (err instanceof RemoteError) return err.toInfo()
  return new RemoteProtocolError(undefined, String(err)).toInfo()
}

/** Agentenmodus mit einem Modell, das keine Werkzeuge kann. */
export class RemoteToolsUnsupportedError extends RemoteError {
  constructor(detail?: string) {
    super(
      'tools-unsupported',
      'This model cannot use tools. Choose another model on your desktop, or turn Agent mode off for this chat.',
      { detail },
    )
  }
}

// ── Versiegelter Kanal ───────────────────────────────────────────

export class RemoteUpdateDesktopError extends RemoteError {
  constructor(detail?: string) {
    super(
      'update-desktop',
      'Update LU on your computer to connect over the internet. Until then this phone connects on the same Wi-Fi only.',
      { detail },
    )
  }
}

export class RemoteScanNeededError extends RemoteError {
  constructor(detail?: string) {
    super(
      'scan-needed',
      'Over the internet this phone pairs with the QR code only. Scan the QR code shown on your computer, or connect on the same Wi-Fi to use the 6 digit code.',
      { detail },
    )
  }
}

export class RemoteDowngradeError extends RemoteError {
  constructor(detail?: string) {
    super(
      'downgrade',
      'Your computer did not offer the secure connection this phone was paired with, so nothing was sent. Check that LU on your computer is up to date and try again.',
      { detail },
    )
  }
}

export class RemoteUnpairedError extends RemoteError {
  constructor(detail?: string) {
    super('unpaired', 'This computer no longer knows this phone. Pair again.', { status: 401, detail })
  }
}

export class RemoteNewKeyError extends RemoteError {
  constructor(detail?: string) {
    super(
      'new-key',
      'This computer has a new key, or another device answered at its address. Nothing was sent. If you reset LU on your computer, pair again.',
      { status: 401, detail },
    )
  }
}

export class RemotePairingDeniedError extends RemoteError {
  constructor(detail?: string) {
    super('pairing-denied', 'Pairing was not allowed on your computer. Try again and choose Allow there.', { status: 403, detail })
  }
}

export class RemoteScanAgainError extends RemoteError {
  /**
   * `byCode`: der sechsstellige Code wird am Desktop nicht mehr gezeigt (verbraucht,
   * verfallen oder das Fenster ist zu). Sonst ein alter QR-Code: am Desktop gilt
   * immer nur der zuletzt gezeigte, ein neuer entwertet den alten.
   */
  constructor(detail?: string, byCode = false) {
    super(
      'scan-again',
      byCode
        ? 'This code is no longer valid on your computer. Open pairing there again and enter the new code.'
        : 'This QR code is no longer valid. Show a new QR code on your computer and scan that one.',
      { status: 401, detail },
    )
  }
}

/**
 * Der Desktop ist neu genug, zeigt aber gerade kein Kopplungsfenster: dann nennt
 * sein WLAN-Status weder Schluessel noch Namen (H1, Desktop `f72041dab`).
 */
export class RemoteOpenPairingError extends RemoteError {
  constructor(detail?: string) {
    super(
      'open-pairing',
      'Open pairing on your computer: in LU, go to Remote Access and show the QR code or the 6 digit code. Then tap Try again.',
      { detail },
    )
  }
}

/**
 * Ein gekoppelter Desktop gab unter seiner bekannten Adresse 404 auf Status oder
 * Kanal: die Adresse gehoert ihm nicht mehr (neuer Tunnel, anderer Name im WLAN).
 * Kein Grund zum Aktualisieren, die App sucht ihn neu.
 */
export class RemoteStaleAddressError extends RemoteError {
  constructor(viaTunnel: boolean, detail?: string) {
    super(
      'stale-address',
      viaTunnel
        ? 'Your computer has a new internet link. On the same Wi-Fi this phone finds it again by itself. Away from home, scan the new QR code on your computer.'
        : 'Your computer is no longer at the address this phone knows. Check that LU is open there with Remote Access on, then tap Try again.',
      { status: 404, detail },
    )
  }
}
