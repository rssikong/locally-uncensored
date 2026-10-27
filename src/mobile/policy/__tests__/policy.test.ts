// @vitest-environment jsdom
/**
 * The store building blocks: the three presets, the consent to LU Cloud,
 * the report queue and the age declaration.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __setNavSaveForTests, navApi } from '../../nav/api'
import { useNavStore } from '../../nav/store'
import { SHEETS } from '../../nav/sheets'
import { SHEET_LOADERS } from '../../nav/loaders'
import { POLICY, REPORT_REASONS } from '../../strings/policy'
import { AGE_KEY, __resetAgeForTests, ageState, declareAge } from '../age'
import {
  AI_CONSENT_KEY,
  AI_CONSENT_SHEET,
  CONSENT_VERSION,
  __resetAiConsentForTests,
  answerAiConsent,
  ensureAiConsent,
  hasAiConsent,
  revokeAiConsent,
} from '../consent'
import {
  REPORT_EXCERPT_MAX,
  REPORT_QUEUE_KEY,
  REPORT_QUEUE_MAX,
  REPORT_SHEET,
  __resetReportsForTests,
  answerForStatus,
  buildReport,
  flushReports,
  openReport,
  queuedReports,
  reportEndpoint,
  sendReport,
  setReportTransportForTests,
  type QueuedReport,
} from '../report'
import { STORE_PRESETS, applyDevStorePreset, parseStorePreset, setStorePresetForTests, storePolicy } from '../storePolicy'

const topSheet = () => {
  const top = useNavStore.getState().overlays.at(-1)
  return top?.kind === 'sheet' ? top.sheet : null
}

beforeEach(() => {
  localStorage.clear()
  __setNavSaveForTests(false)
  while (navApi.depth() > 0) navApi.back()
  setStorePresetForTests(null)
  __resetAiConsentForTests()
  __resetReportsForTests()
  __resetAgeForTests()
})

afterEach(() => {
  setStorePresetForTests(null)
  vi.restoreAllMocks()
})

describe('store presets', () => {
  it('a build without the variable is open', () => {
    expect(storePolicy()).toBe(STORE_PRESETS.open)
    expect(storePolicy()).toMatchObject({ ageGate: 'none', contentLevels: 'all', purchase: 'links', unfilteredCatalog: true, customModelUrl: true })
  })

  it('play and appstore are what was agreed', () => {
    expect(STORE_PRESETS.play).toMatchObject({ ageGate: 'declare-18', contentLevels: 'no-off', purchase: 'text-only', unfilteredCatalog: false, customModelUrl: false, directBadge: false })
    expect(STORE_PRESETS.appstore).toMatchObject({ ageGate: 'declare-18', contentLevels: 'fixed-filter', purchase: 'none', unfilteredCatalog: false, customModelUrl: false })
  })

  it('the four decisions of 10.10.2026, one line each', () => {
    // 1. Sign in through a third party. Round 14 took it out of the App Store build (rule 4.8). David decided on
    //    10.10.2026 that Google and GitHub stay there, and round 15 built "Sign in with Apple" next to them.
    expect([STORE_PRESETS.open.thirdPartySignIn, STORE_PRESETS.play.thirdPartySignIn, STORE_PRESETS.appstore.thirdPartySignIn]).toEqual([true, true, true])
    expect([STORE_PRESETS.open.appleSignIn, STORE_PRESETS.play.appleSignIn, STORE_PRESETS.appstore.appleSignIn]).toEqual([true, true, true])
    // Rule 4.8: the App Store build never offers a third party without "Sign in with Apple".
    expect(STORE_PRESETS.appstore.thirdPartySignIn && !STORE_PRESETS.appstore.appleSignIn).toBe(false)
    // 2. The open search at the model hub: in the open build only. Since r56 (18.10.2026) the Play build has no foreign files either (other packings, import).
    expect([STORE_PRESETS.open.hubSearch, STORE_PRESETS.play.hubSearch, STORE_PRESETS.appstore.hubSearch]).toEqual([true, false, false])
    expect([STORE_PRESETS.open.customModelUrl, STORE_PRESETS.play.customModelUrl, STORE_PRESETS.appstore.customModelUrl]).toEqual([true, false, false])
    // 3. Search keys of one's own: not in the App Store build.
    expect([STORE_PRESETS.open.webSearchKeys, STORE_PRESETS.play.webSearchKeys, STORE_PRESETS.appstore.webSearchKeys]).toEqual([true, true, false])
    // A search needs foreign files: no preset has the one without the other.
    for (const preset of Object.values(STORE_PRESETS)) expect(preset.hubSearch && !preset.customModelUrl, preset.preset).toBe(false)
    // The token field follows foreign files: the fixed catalogue names no repository that asks for a sign in (r56).
    for (const preset of Object.values(STORE_PRESETS)) expect(preset.gatedModelToken && !preset.customModelUrl, preset.preset).toBe(false)
  })

  it('r56, decided 18.10.2026: the Play package offers the models of the App Store package, and keeps the rest', () => {
    // Google's policy forbids apps that make sexual content: no catalogue without refusals, no foreign files, no mark "Direct".
    for (const name of ['unfilteredCatalog', 'customModelUrl', 'hubSearch', 'gatedModelToken'] as const) expect(STORE_PRESETS.play[name], name).toBe(STORE_PRESETS.appstore[name])
    expect(STORE_PRESETS.play.directBadge).toBe(false)
    // The open APK keeps everything.
    expect(STORE_PRESETS.open).toMatchObject({ unfilteredCatalog: true, customModelUrl: true, hubSearch: true, directBadge: true })
    // The rest of the Play preset stays: the sentence about buying, Remote, Create over the computer.
    expect(STORE_PRESETS.play).toMatchObject({ purchase: 'text-only', remoteDesktop: true, remoteCreate: true, externalProviders: true, webSearchKeys: true })
  })

  it('the open preset has every switch on, as before', () => {
    const { preset, ageGate, contentLevels, purchase, externalLinks, ...switches } = STORE_PRESETS.open
    expect({ preset, ageGate, contentLevels, purchase, externalLinks }).toEqual({ preset: 'open', ageGate: 'none', contentLevels: 'all', purchase: 'links', externalLinks: 'all' })
    for (const [name, value] of Object.entries(switches)) expect(value, name).toBe(true)
  })

  it('report, account deletion, contact and consent are on in every preset', () => {
    for (const preset of Object.values(STORE_PRESETS)) {
      expect(preset, preset.preset).toMatchObject({ reportContent: true, accountDeletion: true, contactInfo: true, aiDisclosureConsent: true })
    }
  })

  it('a preset is set for a test and given back', () => {
    setStorePresetForTests('appstore')
    expect(storePolicy().preset).toBe('appstore')
    setStorePresetForTests(null)
    expect(storePolicy().preset).toBe('open')
  })

  it('only the three names are presets', () => {
    expect(parseStorePreset('play')).toBe('play')
    expect(parseStorePreset('Play')).toBeNull()
    expect(parseStorePreset('')).toBeNull()
    expect(parseStorePreset(undefined)).toBeNull()
  })

  it('an address changes the preset in a developer build and never in a shipped one', () => {
    expect(applyDevStorePreset('?store=appstore', false)).toBeNull()
    expect(storePolicy().preset).toBe('open')
    expect(applyDevStorePreset('?store=nonsense', true)).toBeNull()
    expect(storePolicy().preset).toBe('open')
    expect(applyDevStorePreset('?store=appstore', true)).toBe('appstore')
    expect(storePolicy().preset).toBe('appstore')
  })
})

describe('consent before content goes to LU Cloud', () => {
  it('the two sheets are in the table and have a file', () => {
    expect(SHEETS[AI_CONSENT_SHEET].owner).toBe('shell')
    expect(SHEETS[REPORT_SHEET].owner).toBe('shell')
    expect(typeof SHEET_LOADERS[AI_CONSENT_SHEET]).toBe('function')
    expect(typeof SHEET_LOADERS[REPORT_SHEET]).toBe('function')
  })

  it('asks once, saves the yes and does not ask again', async () => {
    expect(hasAiConsent()).toBe(false)
    const asked = ensureAiConsent()
    expect(topSheet()).toBe(AI_CONSENT_SHEET)
    answerAiConsent(true)
    navApi.closeSheet()
    expect(await asked).toBe(true)
    expect(hasAiConsent()).toBe(true)
    expect(JSON.parse(localStorage.getItem(AI_CONSENT_KEY) ?? '{}')).toMatchObject({ v: CONSENT_VERSION })
    expect(await ensureAiConsent()).toBe(true)
    expect(topSheet()).toBeNull()
  })

  it('a no saves nothing and the next send asks again', async () => {
    const asked = ensureAiConsent()
    answerAiConsent(false)
    navApi.closeSheet()
    expect(await asked).toBe(false)
    expect(localStorage.getItem(AI_CONSENT_KEY)).toBeNull()
    const again = ensureAiConsent()
    expect(topSheet()).toBe(AI_CONSENT_SHEET)
    answerAiConsent(false)
    navApi.closeSheet()
    expect(await again).toBe(false)
  })

  it('closing the sheet without an answer is a no', async () => {
    const asked = ensureAiConsent()
    expect(topSheet()).toBe(AI_CONSENT_SHEET)
    navApi.back()
    expect(await asked).toBe(false)
    expect(hasAiConsent()).toBe(false)
  })

  it('several senders share the one sheet and its one answer', async () => {
    const first = ensureAiConsent()
    const second = ensureAiConsent()
    expect(useNavStore.getState().overlays).toHaveLength(1)
    answerAiConsent(true)
    navApi.closeSheet()
    expect(await Promise.all([first, second])).toEqual([true, true])
  })

  it('can be taken back, then it asks again', async () => {
    const asked = ensureAiConsent()
    answerAiConsent(true)
    navApi.closeSheet()
    await asked
    revokeAiConsent()
    expect(hasAiConsent()).toBe(false)
    const again = ensureAiConsent()
    expect(topSheet()).toBe(AI_CONSENT_SHEET)
    answerAiConsent(false)
    navApi.closeSheet()
    expect(await again).toBe(false)
  })

  it('a yes to an older text does not count', () => {
    localStorage.setItem(AI_CONSENT_KEY, JSON.stringify({ v: CONSENT_VERSION - 1, agreedAt: '2026-01-01T00:00:00.000Z' }))
    expect(hasAiConsent()).toBe(false)
    localStorage.setItem(AI_CONSENT_KEY, 'not json')
    expect(hasAiConsent()).toBe(false)
  })

  it('the text names what is sent and to whom, and no provider by name', () => {
    const text = `${POLICY.consentTitle} ${POLICY.consentText}`
    for (const word of ['messages', 'images', 'voice recordings', 'LU Cloud', 'third-party AI providers']) expect(text).toContain(word)
    expect(text).not.toMatch(/fal\b|OpenAI|Anthropic|Google|RunPod|Together|Replicate/i)
  })
})

describe('reporting content', () => {
  const input = { kind: 'message', id: 'm1', model: 'Gemma 3 4B', source: 'local', excerpt: 'bad text', reason: 'hate', note: ' why ' } as const

  it('opens the sheet with what is reported', () => {
    openReport({ kind: 'image', id: 'img-1', model: 'Flux', source: 'cloud' })
    const top = useNavStore.getState().overlays.at(-1)
    expect(top).toMatchObject({ kind: 'sheet', sheet: REPORT_SHEET, props: { kind: 'image', id: 'img-1', model: 'Flux', source: 'cloud' } })
  })

  it('builds the stored report and cuts long texts', () => {
    const report = buildReport({ ...input, excerpt: 'x'.repeat(2000) }, new Date('2026-10-08T10:00:00Z'), 'r1')
    expect(report).toMatchObject({ reportId: 'r1', createdAt: '2026-10-08T10:00:00.000Z', kind: 'message', contentId: 'm1', model: 'Gemma 3 4B', source: 'local', reason: 'hate', note: 'why', preset: 'open' })
    expect(report.excerpt).toHaveLength(REPORT_EXCERPT_MAX)
  })

  it('there is no address in this build, so nothing is fetched and the report waits', async () => {
    expect(reportEndpoint()).toBeNull()
    const fetched = vi.spyOn(globalThis, 'fetch')
    expect(await sendReport(input)).toBe('queued')
    expect(fetched).not.toHaveBeenCalled()
    expect(queuedReports()).toHaveLength(1)
    expect(queuedReports()[0]).toMatchObject({ contentId: 'm1', reason: 'hate' })
  })

  it('a report that was delivered leaves the queue and is told as sent', async () => {
    const seen: QueuedReport[] = []
    setReportTransportForTests(async (report) => {
      seen.push(report)
      return 'sent'
    })
    expect(await sendReport(input)).toBe('sent')
    expect(seen).toHaveLength(1)
    expect(queuedReports()).toEqual([])
    // Empty, not removed: the native backup keeps the last value of a removed key (gap L7).
    expect(localStorage.getItem(REPORT_QUEUE_KEY)).toBe('[]')
  })

  it('a report that could not be delivered stays and goes out with the next try, oldest first', async () => {
    setReportTransportForTests(async () => {
      throw new Error('offline')
    })
    expect(await sendReport(input)).toBe('queued')
    expect(await sendReport({ ...input, id: 'm2' })).toBe('queued')
    const order: string[] = []
    setReportTransportForTests(async (report) => {
      order.push(report.contentId)
      return 'sent'
    })
    await flushReports()
    expect(order).toEqual(['m1', 'm2'])
    expect(queuedReports()).toEqual([])
  })

  it('a report the server refuses for good is dropped and does not block the rest', async () => {
    await sendReport(input)
    await sendReport({ ...input, id: 'm2' })
    setReportTransportForTests(async (report) => (report.contentId === 'm1' ? 'drop' : 'sent'))
    await flushReports()
    expect(queuedReports()).toEqual([])
  })

  it('reads the answer of the server', () => {
    expect(answerForStatus(200)).toBe('sent')
    expect(answerForStatus(204)).toBe('sent')
    expect(answerForStatus(422)).toBe('drop')
    expect(answerForStatus(404)).toBe('keep')
    expect(answerForStatus(429)).toBe('keep')
    expect(answerForStatus(503)).toBe('keep')
  })

  it('the queue never grows without end', async () => {
    for (let i = 0; i < REPORT_QUEUE_MAX + 5; i += 1) await sendReport({ ...input, id: `m${i}` })
    expect(queuedReports()).toHaveLength(REPORT_QUEUE_MAX)
    expect(queuedReports().at(-1)?.contentId).toBe(`m${REPORT_QUEUE_MAX + 4}`)
  })

  it('a report that cannot be saved is not called saved', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    await expect(sendReport(input)).rejects.toThrow('could not be saved')
  })

  it('offers reasons and each has a name', () => {
    expect(REPORT_REASONS.length).toBeGreaterThanOrEqual(5)
    expect(new Set(REPORT_REASONS.map((r) => r.id)).size).toBe(REPORT_REASONS.length)
    expect(REPORT_REASONS.at(-1)?.id).toBe('other')
  })
})

describe('age declaration', () => {
  it('a build without the gate lets everyone in', () => {
    expect(ageState()).toBe('open')
    declareAge('minor')
    expect(ageState()).toBe('open')
  })

  it('with the gate: ask, then in for good, or blocked for good', () => {
    setStorePresetForTests('play')
    expect(ageState()).toBe('ask')
    declareAge('adult')
    expect(ageState()).toBe('open')
    expect(localStorage.getItem(AGE_KEY)).toBe('adult')
    declareAge('minor')
    expect(ageState()).toBe('blocked')
    expect(localStorage.getItem(AGE_KEY)).toBe('minor')
  })

  it('saves one word and no date of birth', () => {
    setStorePresetForTests('appstore')
    declareAge('adult')
    expect(Object.keys(localStorage)).toEqual([AGE_KEY])
    expect(localStorage.getItem(AGE_KEY)).not.toMatch(/\d/)
  })

  it('a damaged value asks again', () => {
    setStorePresetForTests('play')
    localStorage.setItem(AGE_KEY, '17')
    expect(ageState()).toBe('ask')
  })
})
