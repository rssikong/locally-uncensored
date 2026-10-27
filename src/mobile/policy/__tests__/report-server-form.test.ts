// @vitest-environment jsdom
/**
 * A report as the website takes it (round 32).
 *
 * lu-labs.ai accepts reports at POST /api/reports since 14.10.2026 (website
 * branch feat/web-307-store, lib/content-report.ts, parseReport, and
 * app/api/reports/route.ts). The rules of that parser and the statuses of
 * that route are written down here as they stand in the website, and the
 * report of the app is sent through the real transport (postReport via
 * flushReports) to a server that applies them. If the app changes a field,
 * a reason or the way it reads a status, this goes red before a store build
 * sends reports that the server drops for good.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/report-server-form.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REPORT_REASONS } from '../../strings/policy'
import { __resetReportsForTests, answerForStatus, buildReport, flushReports, queuedReports, reportEndpoint, sendReport, type QueuedReport, type ReportKind } from '../report'
import { STORE_PRESETS, setStorePresetForTests, type StorePreset } from '../storePolicy'

const ENDPOINT = 'https://lu-labs.ai/api/reports'

// The website, lib/content-report.ts.
const SERVER = {
  bodyMax: 8 * 1024,
  kinds: ['message', 'image', 'video', 'audio'],
  sources: ['local', 'cloud'],
  reasons: ['sexual', 'minors', 'violence', 'hate', 'self-harm', 'illegal', 'other'],
  reportId: /^[A-Za-z0-9-]{8,64}$/,
  token: /^[a-z0-9-]{0,24}$/,
}

/** parseReport of the website: null when it takes the report, else the reason it answers 422. */
function serverRefuses(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'invalid report'
  const r = raw as Record<string, unknown>
  if (typeof r.reportId !== 'string' || !SERVER.reportId.test(r.reportId)) return 'invalid reportId'
  if (typeof r.createdAt !== 'string' || !Number.isFinite(Date.parse(r.createdAt))) return 'invalid createdAt'
  if (!SERVER.kinds.includes(r.kind as string)) return 'invalid kind'
  if (!SERVER.sources.includes(r.source as string)) return 'invalid source'
  if (!SERVER.reasons.includes(r.reason as string)) return 'invalid reason'
  for (const field of ['contentId', 'model', 'note', 'excerpt']) {
    const v = r[field]
    if (v !== undefined && v !== null && typeof v !== 'string') return 'invalid text field'
  }
  for (const field of ['preset', 'platform']) {
    const v = r[field]
    const text = v === undefined || v === null ? '' : typeof v === 'string' ? v.trim().slice(0, 24) : null
    if (text === null || !SERVER.token.test(text)) return 'invalid preset or platform'
  }
  return null
}

/** The route of the website, app/api/reports/route.ts, as far as the app can meet it. */
function serverAnswer(init: RequestInit): number {
  const type = new Headers(init.headers).get('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) return 415
  const raw = String(init.body ?? '')
  if (raw.length > SERVER.bodyMax) return 413
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return 400
  }
  return serverRefuses(body) ? 422 : 200
}

const fetchMock = vi.fn()

beforeEach(() => {
  __resetReportsForTests()
  vi.stubEnv('VITE_LU_REPORT_URL', ENDPOINT)
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init: RequestInit) => new Response('{"ok":true}', { status: serverAnswer(init) }))
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  setStorePresetForTests(null)
  delete document.documentElement.dataset.os
  __resetReportsForTests()
})

describe('the report of the app is one the website takes', () => {
  it('the address of the release builds is the live endpoint, and it counts as set', () => {
    expect(reportEndpoint()).toBe(ENDPOINT)
  })

  it('the reasons of the app are the reasons of the server, no more, no fewer', () => {
    expect(REPORT_REASONS.map((r) => r.id).sort()).toEqual([...SERVER.reasons].sort())
  })

  it('the fields are the ones the server reads', () => {
    const report = buildReport({ kind: 'message', id: 'm1', model: 'some-model', source: 'cloud', reason: 'other' }, new Date('2026-10-14T10:00:00Z'), '0b1c2d3e-0000-4000-8000-000000000001')
    expect(Object.keys(report).sort()).toEqual(['contentId', 'createdAt', 'excerpt', 'kind', 'model', 'note', 'platform', 'preset', 'reason', 'reportId', 'source'])
  })

  const presets = Object.keys(STORE_PRESETS) as StorePreset[]
  const kinds: ReportKind[] = ['message', 'image', 'video', 'audio']
  it.each(presets)('preset %s: every kind, source, reason and platform is taken (200), longest texts included', async (preset) => {
    setStorePresetForTests(preset)
    for (const os of ['ios', 'android', undefined]) {
      if (os) document.documentElement.dataset.os = os
      else delete document.documentElement.dataset.os
      for (const kind of kinds) {
        for (const source of ['local', 'cloud'] as const) {
          for (const { id: reason } of REPORT_REASONS) {
            const report = buildReport({ kind, id: 'c'.repeat(300), model: 'm'.repeat(300), source, reason, note: 'n'.repeat(5000), excerpt: 'ä'.repeat(5000) })
            const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }
            expect(serverRefuses(report), `${preset} ${os} ${kind} ${source} ${reason}`).toBeNull()
            expect(serverAnswer(init)).toBe(200)
          }
        }
      }
    }
  })

  it('the fallback id of a WebView without randomUUID is a valid reportId', () => {
    const spy = vi.spyOn(crypto, 'randomUUID').mockImplementation(() => {
      throw new Error('not here')
    })
    const report = buildReport({ kind: 'image', id: 'i1', model: 'flux', source: 'cloud', reason: 'violence' })
    spy.mockRestore()
    expect(report.reportId).toMatch(SERVER.reportId)
  })

  it('the real transport posts JSON to the endpoint, without cookies, and a 200 empties the queue', async () => {
    expect(await sendReport({ kind: 'message', id: 'm1', model: 'x', source: 'local', reason: 'hate', excerpt: 'text' })).toBe('sent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(ENDPOINT)
    expect(init.method).toBe('POST')
    expect(init.credentials).toBe('omit')
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(serverRefuses(JSON.parse(String(init.body)))).toBeNull()
    expect(queuedReports()).toEqual([])
  })
})

describe('no report outgrows the body limit of the website', () => {
  it('the largest report the app can build stays under 8 KB in UTF-8, whatever the id and the model name', () => {
    const report = buildReport({ kind: 'message', id: 'x'.repeat(20_000), model: '\u{1F600}'.repeat(10_000), source: 'cloud', reason: 'other', note: '\u20AC'.repeat(5000), excerpt: '\u20AC'.repeat(5000) })
    const bytes = new TextEncoder().encode(JSON.stringify(report)).length
    expect(bytes).toBeLessThan(SERVER.bodyMax)
    expect(report.contentId.length).toBeLessThanOrEqual(200)
    expect(report.model.length).toBeLessThanOrEqual(200)
  })
})

describe('the statuses of the website mean the same in the app', () => {
  // The route: 200 delivered (also a report sent twice), 400/413/422 never acceptable, 415/429/502 try later.
  it.each([
    [200, 'sent'],
    [400, 'drop'],
    [413, 'drop'],
    [422, 'drop'],
    [415, 'keep'],
    [429, 'keep'],
    [502, 'keep'],
  ] as const)('%i is %s', (status, answer) => {
    expect(answerForStatus(status)).toBe(answer)
  })

  it('a report the server keeps for later stays in the queue, one it refuses for good leaves it', async () => {
    const report = (id: string): QueuedReport => buildReport({ kind: 'message', id, model: 'x', source: 'local', reason: 'other' })
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 429 }))
    expect(await sendReport({ kind: 'message', id: 'a', model: 'x', source: 'local', reason: 'other' })).toBe('queued')
    expect(queuedReports()).toHaveLength(1)
    fetchMock.mockImplementationOnce(async () => new Response('', { status: 422 }))
    await flushReports()
    expect(queuedReports()).toEqual([])
    expect(report('b').reportId).toMatch(SERVER.reportId)
  })
})
