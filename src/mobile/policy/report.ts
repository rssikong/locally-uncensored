/**
 * Reporting generated content to the maker (switch reportContent; Google
 * Play demands it inside the app, Apple for chatbots and generated media).
 *
 *   openReport({ kind: 'message', id, model, source: 'local', excerpt })
 *
 * opens the sheet "report". Sending puts the report into a queue on the
 * phone first and then tries to deliver it. The user is told which of the
 * two happened: sent, or saved and sent later.
 *
 * A build without the address says so on the sheet ("saved on this phone,
 * sent once the report service is available"), and a store build (preset
 * play or appstore) without the address is refused when it is built
 * (src/dev/store-build-check.ts, durchsicht-mobile M4).
 *
 * Delivery: lu-labs.ai takes reports at POST /api/reports since 14.10.2026
 * (the release builds set VITE_LU_REPORT_URL=https://lu-labs.ai/api/reports;
 * the form is held by policy/__tests__/report-server-form.test.ts). The
 * address comes from the Vite variable VITE_LU_REPORT_URL. While it is not
 * set nothing leaves the phone and every report waits in the queue. Once it
 * is set, the queue is sent at start, on return and when the network is
 * back. No sign in is needed and no account is attached.
 */
import { navApi } from '../nav/api'
import type { ReportReason } from '../strings/policy'
import { onSavedChange, readSaved, writeSaved } from './saved'
import { storePolicy } from './storePolicy'

export type ReportKind = 'message' | 'image' | 'video' | 'audio'

/** What is reported. `excerpt` is the text of an answer; media travel by id only. */
export interface ReportTarget {
  kind: ReportKind
  id: string
  model: string
  source: 'local' | 'cloud'
  /** Only for the sheet's sentence: made on the user's computer ("My computer" in Create). Not sent. */
  origin?: 'phone' | 'computer'
  excerpt?: string
}

export interface ReportInput extends ReportTarget {
  reason: ReportReason
  note?: string
}

/** One report as it waits in the queue and as it is posted. */
export interface QueuedReport {
  reportId: string
  createdAt: string
  kind: ReportKind
  contentId: string
  model: string
  source: 'local' | 'cloud'
  reason: ReportReason
  note: string
  excerpt: string
  preset: string
  platform: string
}

export type ReportOutcome = 'sent' | 'queued'
/** sent: delivered. keep: try again later. drop: the server will never take it. */
export type TransportAnswer = 'sent' | 'keep' | 'drop'
export type ReportTransport = (report: QueuedReport) => Promise<TransportAnswer>

export const REPORT_SHEET = 'report'
export const REPORT_QUEUE_KEY = 'lu-mobile-report-queue'
export const REPORT_QUEUE_MAX = 50
export const REPORT_EXCERPT_MAX = 500
export const REPORT_NOTE_MAX = 500
/** The website keeps 200 characters of the content id and of the model name (lib/content-report.ts). */
export const REPORT_FIELD_MAX = 200
const SEND_TIMEOUT_MS = 15_000

/** Open the report sheet for one answer or one medium. Does nothing in a build without the switch. */
export function openReport(target: ReportTarget): void {
  if (!storePolicy().reportContent) return
  navApi.openSheet(REPORT_SHEET, target)
}

/** Pure: the report as it is stored, texts cut to their limits. */
export function buildReport(input: ReportInput, now: Date = new Date(), id: string = newId()): QueuedReport {
  return {
    reportId: id,
    createdAt: now.toISOString(),
    kind: input.kind,
    // Cut like the website cuts them, so no report grows past its body limit (8 KB) and is dropped with a 413.
    contentId: input.id.slice(0, REPORT_FIELD_MAX),
    model: input.model.slice(0, REPORT_FIELD_MAX),
    source: input.source,
    reason: input.reason,
    note: (input.note ?? '').trim().slice(0, REPORT_NOTE_MAX),
    excerpt: (input.excerpt ?? '').trim().slice(0, REPORT_EXCERPT_MAX),
    preset: storePolicy().preset,
    platform: typeof document === 'undefined' ? '' : (document.documentElement.dataset.os ?? 'web'),
  }
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  }
}

export function queuedReports(): QueuedReport[] {
  const raw = readSaved(REPORT_QUEUE_KEY)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as QueuedReport[]).filter((r) => r && typeof r.reportId === 'string') : []
  } catch {
    return []
  }
}

function saveQueue(queue: QueuedReport[]): boolean {
  // An empty queue stays as "[]", not as a removed key. The queue is in the native backup (gap L7), and the
  // backup keeps the last value of a key that went missing: a removed key would bring sent reports back.
  return writeSaved(REPORT_QUEUE_KEY, JSON.stringify(queue.slice(-REPORT_QUEUE_MAX)))
}

/** The address reports are posted to, or null while the server has none. */
export function reportEndpoint(): string | null {
  let raw: unknown
  try {
    raw = import.meta.env.VITE_LU_REPORT_URL
  } catch {
    raw = undefined
  }
  return typeof raw === 'string' && /^https:\/\//.test(raw) ? raw : null
}

/** Pure: what an HTTP status means for a report. */
export function answerForStatus(status: number): TransportAnswer {
  if (status >= 200 && status < 300) return 'sent'
  // The server understood and refuses this report for good; sending it again changes nothing.
  if (status === 400 || status === 413 || status === 422) return 'drop'
  return 'keep'
}

async function postReport(report: QueuedReport): Promise<TransportAnswer> {
  const url = reportEndpoint()
  if (!url) return 'keep'
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), SEND_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(report),
      signal: ac.signal,
      credentials: 'omit',
    })
    return answerForStatus(res.status)
  } catch {
    return 'keep'
  } finally {
    clearTimeout(timer)
  }
}

let transport: ReportTransport | null = null
let flushing: Promise<void> | null = null

/** Hand in a transport for a test, null to go back to the real one. */
export function setReportTransportForTests(next: ReportTransport | null): void {
  transport = next
}

/** Try to deliver everything that waits. Never throws. */
export function flushReports(): Promise<void> {
  if (flushing) return flushing
  flushing = (async () => {
    const send = transport ?? postReport
    for (const report of queuedReports()) {
      let answer: TransportAnswer = 'keep'
      try {
        answer = await send(report)
      } catch {
        answer = 'keep'
      }
      if (answer === 'keep') break
      saveQueue(queuedReports().filter((r) => r.reportId !== report.reportId))
    }
  })().finally(() => {
    flushing = null
  })
  return flushing
}

/**
 * Save a report and try to deliver it. Resolves 'sent' when it reached the
 * server and 'queued' when it waits on the phone. Rejects only when it could
 * not even be saved, so the user is never told "saved" for a lost report.
 */
export async function sendReport(input: ReportInput): Promise<ReportOutcome> {
  const report = buildReport(input)
  if (!saveQueue([...queuedReports(), report])) throw new Error('The report could not be saved on this phone.')
  await flushReports()
  return queuedReports().some((r) => r.reportId === report.reportId) ? 'queued' : 'sent'
}

let installed = false

/** Send what waits: now, when the network is back and when the app returns. Called once from boot. */
export function installReports(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  const flush = () => {
    if (queuedReports().length > 0 && (transport || reportEndpoint())) void flushReports()
  }
  window.addEventListener('online', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') flush()
  })
  flush()
}

/** How many reports wait, live (for a line in Troubleshooting). */
export function onReportQueueChange(fn: () => void): () => void {
  return onSavedChange(fn)
}

/** Only for tests. */
export function __resetReportsForTests(): void {
  transport = null
  flushing = null
  installed = false
  writeSaved(REPORT_QUEUE_KEY, null)
}
