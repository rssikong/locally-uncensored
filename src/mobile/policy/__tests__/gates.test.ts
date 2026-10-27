/**
 * The store switches of round 4 and everything that hangs on them: the
 * table per preset, closed pages and sheets, the one door for links, the
 * personas, the provider slots, the lines of the notes and the pickers.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_PERSONAS } from '../../../lib/constants'
import { CLOUD_BASE } from '../../../api/cloud/config'
import { foreignProvidersOn } from '../../boot/providers'
import { useChatsSegment } from '../../nav/chats-segment'
import { currentLinkOffer, linkNoticesReady, receiveDeepLink, setLinkUnavailableNotice, useLinkOfferStore, __resetDeepLinksForTests } from '../../nav/deeplink'
import { ROUTE_LOADERS, SHEET_LOADERS, routeLoader, sheetLoader } from '../../nav/loaders'
import { restoredState } from '../../nav/restore'
import { offeredCloudRows, offeredPickerFilters } from '../../screens/chat/parts/logic/policy'
import { offeredCreateModels } from '../../screens/create/parts/policy'
import { contactSupport } from '../../screens/settings/parts/contact'
import { cloudBenefitLines } from '../../screens/settings/parts/store-rules'
import { POLICY } from '../../strings/policy'
import { MOBILE_RELEASE_NOTES, noteItems } from '../../strings/release-notes'
import { externalProvidersOffered, hubNamed, linked, marketed, priced, remoteCreateOffered, remoteDesktopOffered, routeGate, sheetGate } from '../gates'
import { LEGAL_LINKS, SUPPORT_EMAIL, appLinkAllowed, isLegalLink, openAppLink } from '../links'
import { PLAIN_PERSONA_ID, STORE_HIDDEN_PERSONAS, allowedActivePersona, dropsLimits, offeredPersonas, shownPersona } from '../personas'
import { STORE_PRESETS, setStorePresetForTests, storePolicy } from '../storePolicy'

const openExternalMock = vi.hoisted(() => vi.fn(async (_url: string) => ({ opened: true })))
vi.mock('../../platform/open-external', async (original) => ({ ...(await original<typeof import('../../platform/open-external')>()), openExternal: openExternalMock }))

const MOBILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

afterEach(() => {
  setStorePresetForTests(null)
  setLinkUnavailableNotice(null)
  __resetDeepLinksForTests()
  useChatsSegment.setState({ segment: 'phone' })
  vi.restoreAllMocks()
  openExternalMock.mockClear()
})

describe('the switches of round 4, per preset', () => {
  it('open keeps everything', () => {
    expect(STORE_PRESETS.open).toMatchObject({
      externalProviders: true,
      remoteDesktop: true,
      gatedModelToken: true,
      unfilteredMarketing: true,
      unfilteredPersonas: true,
      externalLinks: 'all',
      pricingWords: true,
    })
  })

  it('play keeps providers and Remote desktop, and drops advertising, links, price words and, since r56, the token', () => {
    expect(STORE_PRESETS.play).toMatchObject({
      externalProviders: true,
      remoteDesktop: true,
      gatedModelToken: false,
      unfilteredMarketing: false,
      unfilteredPersonas: false,
      externalLinks: 'legal-only',
      pricingWords: false,
    })
  })

  it('appstore has every one of them off', () => {
    expect(STORE_PRESETS.appstore).toMatchObject({
      externalProviders: false,
      remoteDesktop: false,
      gatedModelToken: false,
      unfilteredMarketing: false,
      unfilteredPersonas: false,
      externalLinks: 'legal-only',
      pricingWords: false,
    })
  })

  it('price words belong to buy links and to nothing else', () => {
    for (const preset of Object.values(STORE_PRESETS)) {
      expect(preset.pricingWords, preset.preset).toBe(preset.purchase === 'links')
      if (preset.purchase === 'links') expect(preset.externalLinks, preset.preset).toBe('all')
    }
  })

  it('the one sentence a build without buy links may say names the website and carries no link', () => {
    expect(POLICY.plansOnWebsite).toBe('Plans and credits are available on lu-labs.ai.')
    expect(POLICY.plansOnWebsite).not.toMatch(/https?:/)
  })
})

describe('closed pages and sheets', () => {
  const closedInAppstore = Object.keys(ROUTE_LOADERS).filter((route) => routeGate(route, STORE_PRESETS.appstore))

  it('appstore closes the provider pages and everything of Remote desktop', () => {
    expect(closedInAppstore.sort()).toEqual(
      Object.keys(ROUTE_LOADERS)
        .filter((r) => r.startsWith('/settings/providers') || r === '/settings/remote' || r.startsWith('/remote/'))
        .sort(),
    )
    expect(closedInAppstore).toContain('/settings/providers')
    expect(closedInAppstore).toContain('/settings/remote')
    expect(closedInAppstore).toContain('/remote/scan')
    expect(closedInAppstore).toContain('/remote/connect')
    expect(routeGate('/settings/providers/:id', STORE_PRESETS.appstore)).toBe('externalProviders')
    expect(routeGate('/remote/scan', STORE_PRESETS.appstore)).toBe('remoteDesktop')
    const sheets = Object.keys(SHEET_LOADERS).filter((sheet) => sheetGate(sheet, STORE_PRESETS.appstore))
    expect(sheets).toContain('link-offer')
    expect(sheets.every((s) => s === 'link-offer' || s.startsWith('remote-'))).toBe(true)
  })

  it('play and open close nothing', () => {
    for (const preset of [STORE_PRESETS.play, STORE_PRESETS.open]) {
      expect(Object.keys(ROUTE_LOADERS).filter((route) => routeGate(route, preset))).toEqual([])
      expect(Object.keys(SHEET_LOADERS).filter((sheet) => sheetGate(sheet, preset))).toEqual([])
    }
  })

  it('a closed route loads the page "not part of this version", whatever asks for it', async () => {
    const real = routeLoader('/settings/remote')
    expect(real).toBe(ROUTE_LOADERS['/settings/remote' as keyof typeof ROUTE_LOADERS])
    setStorePresetForTests('appstore')
    for (const route of closedInAppstore) {
      const load = routeLoader(route)
      expect(load, route).not.toBe((ROUTE_LOADERS as Record<string, unknown>)[route])
      expect(load, route).toBe(routeLoader('/settings/providers'))
    }
    const page = (await routeLoader('/remote/scan')!()) as { default?: unknown }
    expect((await import('../UnavailablePage')).default).toBe(page.default)
    expect(sheetLoader('link-offer')).not.toBe(SHEET_LOADERS['link-offer' as keyof typeof SHEET_LOADERS])
    expect(routeLoader('/settings/account')).toBe(ROUTE_LOADERS['/settings/account' as keyof typeof ROUTE_LOADERS])
    expect(routeLoader('/was/never/there')).toBeUndefined()
  })

  it('a stack saved by another build does not bring a closed page back', () => {
    const page = (route: string, params: Record<string, string> = {}) => ({ route, params })
    const roots = { chat: [page('/chats')], create: [page('/create')], models: [page('/models')], settings: [page('/settings')] }
    const read = () => JSON.stringify({ v: 1, tab: 'settings', flow: null, flowStack: [], stacks: { ...roots, settings: [page('/settings'), page('/settings/remote'), page('/settings/about')] } })
    // The settings tab keeps its saved pages behind the new chat a start opens (round 57); the gate cuts them there.
    const routes = () => restoredState({ onboardingDone: true, devPages: false, read }).stacks.settings.map((p) => p.route)
    expect(routes()).toContain('/settings/remote')
    setStorePresetForTests('appstore')
    expect(routes()).toEqual(['/settings'])
  })

  it('lu://remote is taken and has no effect: no offer is kept, one neutral notice is said', () => {
    const say = vi.fn()
    setLinkUnavailableNotice(say)
    setStorePresetForTests('appstore')
    // The shell is drawn: the notice is said at once (before that it waits, nav/__tests__/deeplink-unavailable.test.ts).
    linkNoticesReady()
    expect(receiveDeepLink('lu://remote?address=192.168.0.12%3A8080')).toBe(true)
    expect(useLinkOfferStore.getState().stored).toBeNull()
    expect(currentLinkOffer()).toBeNull()
    expect(say).toHaveBeenCalledTimes(1)
    expect(POLICY.unavailableRemote).not.toMatch(/store|apple|google|review/i)
  })

  it('the Remote segment cannot be chosen', () => {
    setStorePresetForTests('appstore')
    useChatsSegment.getState().setSegment('remote')
    expect(useChatsSegment.getState().segment).toBe('phone')
    expect(remoteDesktopOffered()).toBe(false)
    expect(externalProvidersOffered()).toBe(false)
    setStorePresetForTests('play')
    useChatsSegment.getState().setSegment('remote')
    expect(useChatsSegment.getState().segment).toBe('remote')
  })

  it('"My computer" in Create (remoteCreate): open and play on, appstore off, never without Remote (R53, E5 to E7)', () => {
    expect([STORE_PRESETS.open.remoteCreate, STORE_PRESETS.play.remoteCreate, STORE_PRESETS.appstore.remoteCreate]).toEqual([true, true, false])
    for (const p of Object.values(STORE_PRESETS)) if (p.remoteCreate) expect(p.remoteDesktop).toBe(true)
    setStorePresetForTests('open')
    expect(remoteCreateOffered()).toBe(true)
    setStorePresetForTests('play')
    expect(remoteCreateOffered()).toBe(true)
    setStorePresetForTests('appstore')
    expect(remoteCreateOffered()).toBe(false)
  })

  it('a text in two wordings follows its switch when it is read', () => {
    expect([priced('a', 'b'), marketed('a', 'b'), linked('a', 'b'), hubNamed('a', 'b')]).toEqual(['a', 'a', 'a', 'a'])
    // Since r56 (18.10.2026) the Play build takes no file from outside the catalogue, so it names the download server, not the hub.
    setStorePresetForTests('play')
    expect([priced('a', 'b'), marketed('a', 'b'), linked('a', 'b'), hubNamed('a', 'b')]).toEqual(['b', 'b', 'b', 'b'])
    setStorePresetForTests('appstore')
    expect([priced('a', 'b'), marketed('a', 'b'), linked('a', 'b'), hubNamed('a', 'b')]).toEqual(['b', 'b', 'b', 'b'])
  })
})

describe('the one door for links', () => {
  it('the legal links are four: privacy, terms, support, deleting the account', () => {
    expect(LEGAL_LINKS).toEqual({
      privacy: `${CLOUD_BASE}/privacy`,
      terms: `${CLOUD_BASE}/terms`,
      support: `mailto:${SUPPORT_EMAIL}`,
      deleteAccount: `${CLOUD_BASE}/delete-account`,
    })
  })

  it('legal-only lets these four through and nothing near them', () => {
    const p = { externalLinks: 'legal-only' } as const
    for (const url of Object.values(LEGAL_LINKS)) expect(appLinkAllowed(url, p), url).toBe(true)
    expect(appLinkAllowed(`${LEGAL_LINKS.privacy}/`, p)).toBe(true)
    for (const url of [CLOUD_BASE, `${CLOUD_BASE}/pricing`, `${CLOUD_BASE}/account/billing`, `${CLOUD_BASE}/privacy/../pricing`, 'https://huggingface.co/x/y', 'https://github.com/x/y', 'mailto:someone@else.example']) {
      expect(appLinkAllowed(url, p), url).toBe(false)
      expect(isLegalLink(url), url).toBe(false)
    }
  })

  it('all lets everything through, none nothing', () => {
    expect(appLinkAllowed('https://huggingface.co/x', { externalLinks: 'all' })).toBe(true)
    expect(appLinkAllowed(LEGAL_LINKS.privacy, { externalLinks: 'none' })).toBe(false)
  })

  it('a link this build does not carry is not opened', async () => {
    setStorePresetForTests('appstore')
    expect(await openAppLink(`${CLOUD_BASE}/pricing`)).toEqual({ opened: false, reason: 'store' })
    setStorePresetForTests('play')
    expect(await openAppLink('https://huggingface.co/some/model')).toEqual({ opened: false, reason: 'store' })
    expect(openExternalMock).not.toHaveBeenCalled()
    setStorePresetForTests('appstore')
    expect(await openAppLink(LEGAL_LINKS.privacy)).toEqual({ opened: true })
    expect(openExternalMock).toHaveBeenCalledWith(LEGAL_LINKS.privacy)
  })

  it('nothing in the shell opens a browser past this door', () => {
    // Content links (an answer, a message) ask the user first and are the two files named here.
    const allowed = ['platform/open-external.ts', 'policy/links.ts', 'ui/Markdown.tsx', 'screens/chat/LinkSheet.tsx', 'dev/UiCatalogPage.tsx']
    const found: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full)
          continue
        }
        if (!/\.tsx?$/.test(entry.name)) continue
        const rel = path.relative(MOBILE, full).split(path.sep).join('/')
        const code = fs.readFileSync(full, 'utf8')
        if (/\bopenExternal\(|window\.open\(|location\.(href\s*=|assign\()|plugin-opener|plugin-shell/.test(code) && !allowed.includes(rel)) found.push(rel)
      }
    }
    walk(MOBILE)
    expect(found).toEqual([])
  })
})

describe('personas in a store build', () => {
  it('the hidden ones are exactly the built in personas whose instruction drops the limits', () => {
    const byText = BUILT_IN_PERSONAS.filter((p) => dropsLimits(p.systemPrompt)).map((p) => p.id)
    expect([...byText].sort()).toEqual([...STORE_HIDDEN_PERSONAS].sort())
  })

  it('the default persona sends no instruction, so it is renamed and not removed', () => {
    const plain = BUILT_IN_PERSONAS.find((p) => p.id === PLAIN_PERSONA_ID)
    expect(plain?.systemPrompt).toBe('')
    const off = { unfilteredPersonas: false, realPersonPersonas: true }
    expect(shownPersona(plain, off)?.name).toBe(POLICY.plainPersonaName)
    expect(POLICY.plainPersonaName).not.toMatch(/filter|uncensored|unrestricted/i)
    expect(shownPersona(plain, { unfilteredPersonas: true, realPersonPersonas: true })).toBe(plain)
  })

  it('lists none of the hidden ones, keeps the rest and keeps what the user wrote', () => {
    const own = { id: 'roast', name: 'My own roast', isBuiltIn: false }
    // The switch for names of real people has a test of its own (real-person-personas.test.ts); here it is on.
    const off = { unfilteredPersonas: false, realPersonPersonas: true }
    const shown = offeredPersonas(BUILT_IN_PERSONAS, off)
    expect(shown.map((p) => p.id)).toEqual(BUILT_IN_PERSONAS.map((p) => p.id).filter((id) => !STORE_HIDDEN_PERSONAS.includes(id)))
    expect(shown.some((p) => /no filter|unfiltered|uncensored/i.test(p.name))).toBe(false)
    expect(offeredPersonas([own], off)).toEqual([own])
    expect(offeredPersonas(BUILT_IN_PERSONAS, { unfilteredPersonas: true, realPersonPersonas: true })).toEqual([...BUILT_IN_PERSONAS])
  })

  it('a hidden persona that was active falls back to the default', () => {
    for (const id of STORE_HIDDEN_PERSONAS) expect(allowedActivePersona(id, { unfilteredPersonas: false, realPersonPersonas: true })).toBe(PLAIN_PERSONA_ID)
    expect(allowedActivePersona('coder', { unfilteredPersonas: false, realPersonPersonas: true })).toBe('coder')
    expect(allowedActivePersona('roast', { unfilteredPersonas: true, realPersonPersonas: true })).toBe('roast')
  })
})

describe('saved providers, notes and pickers', () => {
  it('every slot except the engine and LU Cloud counts as a provider of the user', () => {
    expect(
      foreignProvidersOn({
        openai: { enabled: true },
        'lu-cloud': { enabled: true },
        openrouter: { enabled: true },
        anthropic: { enabled: false },
        'custom-1': { enabled: true },
        gone: undefined,
      }),
    ).toEqual(['openrouter', 'custom-1'])
  })

  it('a note does not announce a feature the build does not carry and names no price', () => {
    const items = ['Plain line', { text: 'Remote desktop', needs: 'remoteDesktop' as const }, { text: 'Your own keys', needs: 'externalProviders' as const }, { text: 'See the price', unpriced: 'See the credits' }]
    expect(noteItems(items, STORE_PRESETS.open)).toEqual(['Plain line', 'Remote desktop', 'Your own keys', 'See the price'])
    expect(noteItems(items, STORE_PRESETS.play)).toEqual(['Plain line', 'Remote desktop', 'Your own keys', 'See the credits'])
    expect(noteItems(items, STORE_PRESETS.appstore)).toEqual(['Plain line', 'See the credits'])
    setStorePresetForTests('appstore')
    for (const note of MOBILE_RELEASE_NOTES) expect(note.items.join('\n')).not.toMatch(/remote desktop|your own key|price|plan\b/i)
  })

  it('the LU Cloud page counts models and promises nothing about refusals', () => {
    // The Play preset with the two lines of r56 turned back lists the whole catalogue and counts it.
    const lines = cloudBenefitLines({ ...STORE_PRESETS.play, unfilteredCatalog: true, directBadge: true })
    expect(lines).toHaveLength(3)
    expect(lines.join('\n')).not.toMatch(/uncensored|unfiltered|refus|no filter|nsfw/i)
    expect(cloudBenefitLines(STORE_PRESETS.open).join('\n')).not.toBe(lines.join('\n'))
    // Since r56 (18.10.2026) the Play build lists what the App Store build lists, and names no count it cannot keep.
    const play = cloudBenefitLines(STORE_PRESETS.play)
    expect(play).toEqual(cloudBenefitLines(STORE_PRESETS.appstore))
    expect(play).toHaveLength(1)
    expect(play.join('\n')).not.toMatch(/uncensored|unfiltered|refus|no filter|nsfw|\d/i)
  })

  it('pickers leave out what is marked as answering without refusals', () => {
    const rows = [{ id: 'a' }, { id: 'b', unfiltered: 'full' }, { id: 'c', unfiltered: false }]
    expect(offeredCloudRows(rows, true)).toEqual(rows)
    expect(offeredCloudRows(rows, false).map((r) => r.id)).not.toContain('b')
    // A picker row carries one mark for both kinds (lib/model-picker.ts): measured or the makers' statement.
    const marked = [{ id: 'a', mark: null }, { id: 'm', mark: 'measured' }, { id: 's', mark: 'statement' }]
    expect(offeredCloudRows(marked, true)).toEqual(marked)
    expect(offeredCloudRows(marked, false).map((r) => r.id)).toEqual(['a'])
    expect(offeredPickerFilters(['all', 'marked'], true)).toEqual(['all', 'marked'])
    expect(offeredPickerFilters(['all', 'marked'], false)).toEqual(['all'])
    const models = [{ id: 'x' }, { id: 'y', adult: true }]
    expect(offeredCreateModels(models)).toEqual(models)
    setStorePresetForTests('appstore')
    expect(offeredCreateModels(models)).toEqual([{ id: 'x' }])
    expect(storePolicy().unfilteredCatalog).toBe(false)
  })
})

describe('contact support', () => {
  const deps = (opened: boolean, left: boolean, copied: boolean) => ({
    open: vi.fn(async () => ({ opened })),
    copy: vi.fn(async () => copied),
    leftForeground: vi.fn(async () => left),
  })

  it('a mail app that came to the front is the answer', async () => {
    const d = deps(true, true, true)
    expect(await contactSupport(d)).toBe('mail-app')
    expect(d.open).toHaveBeenCalledWith(`mailto:${SUPPORT_EMAIL}`)
    expect(d.copy).not.toHaveBeenCalled()
  })

  it('"opened" with the app still in front means no mail app: the address is copied', async () => {
    const d = deps(true, false, true)
    expect(await contactSupport(d)).toBe('copied')
    expect(d.copy).toHaveBeenCalledWith(SUPPORT_EMAIL)
  })

  it('a link that could not be opened copies as well, and a failed copy says so', async () => {
    expect(await contactSupport(deps(false, false, true))).toBe('copied')
    expect(await contactSupport(deps(false, true, false))).toBe('shown')
    const broken = { open: vi.fn(async () => Promise.reject(new Error('x'))), copy: vi.fn(async () => Promise.reject(new Error('y'))), leftForeground: vi.fn(async () => false) }
    expect(await contactSupport(broken)).toBe('shown')
  })
})
