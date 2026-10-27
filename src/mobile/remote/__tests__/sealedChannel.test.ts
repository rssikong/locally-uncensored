/**
 * Der versiegelte Kanal von der App aus: Wahl des Wegs, Waechter, Kopplung,
 * Fehlercodes, Wiederfinden. Gegen fakeDesktop mit der Attrappe des Kanals
 * (fakeSealed.ts); die Kryptographie selbst ist in Rust getestet.
 */
import { afterEach, describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { ADDRESS_LOOKUP_ENABLED, __resetAddressLookupForTests, lookupDesktopAddress } from '../addressLookup'
import { parsePairingInput } from '../pairingLink'
import { createRemoteClient, type RemoteFetch } from '../remoteClient'
import { createRemoteClientStore, type RemoteClientStore, type RemoteClientStoreDeps } from '../remoteClientStore'
import { RemotePermissionError, RemoteTimeoutError, WIFI_TIMEOUT_TEXT } from '../remoteErrors'
import {
  chooseChannel,
  createSealedFetch,
  guardPlainFetch,
  plainAllowed,
  readDesktopStatus,
  deviceFingerprint,
  sealedError,
  sealedErrorCode,
  sealedErrorPinned,
  type SealedPin,
} from '../sealedChannel'
import { createMemoryTokenVault } from '../tokenVault'
import { startFakeDesktop, type FakeDesktop } from './fakeDesktop'
import { createFakeSealedPhone, type FakeSealedPhone } from './fakeSealed'

const LAN = 'http://192.168.1.20:11435'
const NET = 'https://quiet-river-lamp.trycloudflare.com'
/** Ein Name im WLAN statt einer IP (Desktop f72041dab: Status und Kanal antworten auch darunter). */
const LAN_NAME = 'http://studio.local:11435'

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return {
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => void data.set(k, v),
    removeItem: async (k) => void data.delete(k),
  }
}

let desk: FakeDesktop | null = null
afterEach(async () => {
  await desk?.stop()
  desk = null
  __resetAddressLookupForTests()
})

interface Rig {
  store: RemoteClientStore
  s: () => ReturnType<RemoteClientStore['useStore']['getState']>
  phone: FakeSealedPhone
  /** Klartext-Aufrufe als "METHOD url". */
  plain: string[]
  /** Adressen, die gerade nicht antworten. */
  down: Set<string>
  /** Adressen, die gar nichts sagen, bis der Zeitablauf abbricht (Windows-Firewall). */
  silent: Set<string>
  /** Adressen, unter denen ein anderer antwortet: 404 auf alles (alter Tunnel-Name, fremdes Geraet im WLAN). */
  gone: Set<string>
  desk: FakeDesktop
}

async function rig(opts: { sealed?: boolean; deps?: Partial<RemoteClientStoreDeps>; storage?: StateStorage } = {}): Promise<Rig> {
  desk = desk ?? (await startFakeDesktop({ sealed: opts.sealed ?? true }))
  const d = desk
  const down = new Set<string>()
  const silent = new Set<string>()
  const gone = new Set<string>()
  const plain: string[] = []
  const toDesk = (url: string) => {
    const u = new URL(url)
    if (down.has(u.origin)) throw new TypeError('connection refused')
    if (u.origin !== LAN && u.origin !== NET && u.origin !== LAN_NAME) throw new TypeError('unknown host')
    return `${d.url}${u.pathname}${u.search}`
  }
  const isGone = (url: string) => gone.has(new URL(url).origin)
  const fetchPlain: RemoteFetch = async (url, init) => {
    plain.push(`${init?.method ?? 'GET'} ${url}`)
    if (isGone(url)) return new Response('', { status: 404 })
    if (silent.has(new URL(url).origin)) {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    }
    return fetch(toDesk(url), init)
  }
  const phone = createFakeSealedPhone(async (url, body) => {
    if (isGone(url)) return { status: 404, body: new Uint8Array() }
    const res = await fetch(toDesk(url), { method: 'POST', body: Buffer.from(body), headers: { 'content-type': 'application/octet-stream' } })
    const headers: Record<string, string> = {}
    const ra = res.headers.get('retry-after')
    if (ra) headers['retry-after'] = ra
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()), headers }
  })
  const store = createRemoteClientStore({
    storage: opts.storage ?? memoryStorage(),
    vault: createMemoryTokenVault(),
    autoResume: false,
    persistWaitMs: 60_000,
    fetch: fetchPlain,
    sealed: { invoke: phone.invoke },
    pairPollMs: 5,
    pairWaitMs: 2_000,
    ...opts.deps,
  })
  await store.ready
  return { store, s: () => store.useStore.getState(), phone, plain, down, silent, gone, desk: d }
}

/** Ueber das Internet ging nichts im Klartext ausser dem nackten Status. */
function onlyStatusOverTheInternet(plain: string[]): void {
  for (const call of plain) {
    if (call.includes('trycloudflare.com')) expect(call).toBe(`GET ${NET}/remote-api/status`)
  }
}

describe('Wahl des Wegs', () => {
  it('waehlt nach features, Route und Nagel', () => {
    expect(chooseChannel({ route: 'lan', features: ['sealed'], pinned: true }).kind).toBe('sealed')
    expect(chooseChannel({ route: 'tunnel', features: ['sealed'], pinned: true }).kind).toBe('sealed')
    expect(chooseChannel({ route: 'lan', features: ['sealed'], pinned: false }).kind).toBe('pair-code')
    expect(chooseChannel({ route: 'lan', features: [], pinned: false }).kind).toBe('plain')
    const tunnelOld = chooseChannel({ route: 'tunnel', features: null, pinned: false })
    expect(tunnelOld.kind === 'refuse' && tunnelOld.error.code).toBe('update-desktop')
    const tunnelNew = chooseChannel({ route: 'tunnel', features: ['sealed'], pinned: false })
    expect(tunnelNew.kind === 'refuse' && tunnelNew.error.code).toBe('scan-needed')
  })

  it('WAECHTER M2: ein gekoppelter Desktop faellt nie auf Klartext zurueck, auch nicht im WLAN', () => {
    for (const features of [null, [], ['create-image']]) {
      const c = chooseChannel({ route: 'lan', features, pinned: true })
      expect(c.kind).toBe('refuse')
      expect(c.kind === 'refuse' && c.error.code).toBe('downgrade')
    }
  })

  it('liest den Status von 3.0.7 und den alten', () => {
    expect(readDesktopStatus({ status: 'ok' }).features).toEqual([])
    const st = readDesktopStatus({ status: 'ok', protocol: 2, features: ['sealed', 7], desktop_id: 'x', x25519: 'A'.repeat(43), name: ' Studio ' })
    expect(st).toEqual({ features: ['sealed'], protocol: 2, desktopId: null, x25519: 'A'.repeat(43), name: 'Studio' })
  })
})

describe('WAECHTER: ueber eine Internet-Adresse nie Klartext', () => {
  it('laesst nur den nackten Status durch', () => {
    expect(plainAllowed(`${NET}/remote-api/status`)).toBe(true)
    expect(plainAllowed(`${NET}/remote-api/status`, { method: 'GET', headers: { Authorization: 'Bearer x' } })).toBe(false)
    expect(plainAllowed(`${NET}/remote-api/status?x=1`)).toBe(false)
    expect(plainAllowed(`${NET}/remote-api/auth`, { method: 'POST', body: '{}' })).toBe(false)
    expect(plainAllowed(`${NET}/api/chat`, { method: 'POST', body: '{}' })).toBe(false)
    expect(plainAllowed('https://lu.example.com/api/tags')).toBe(false)
    expect(plainAllowed(`${LAN}/api/chat`, { method: 'POST', body: '{}', headers: { Authorization: 'Bearer x' } })).toBe(true)
  })

  it('wirft, bevor der Transport etwas sieht', async () => {
    const seen: string[] = []
    const f = guardPlainFetch(async (url) => {
      seen.push(url)
      return new Response('{}')
    })
    await expect(f(`${NET}/api/tags`, { headers: { Authorization: 'Bearer t' } })).rejects.toMatchObject({ code: 'update-desktop' })
    await f(`${NET}/remote-api/status`)
    expect(seen).toEqual([`${NET}/remote-api/status`])
  })

  it('ein Desktop bis 3.0.6 ueber den Tunnel: ehrlicher Satz, kein Token, kein Code', async () => {
    const r = await rig({ sealed: false })
    await r.s().connect(NET, '123456')
    expect(r.s().status).toBe('needs-code')
    expect(r.s().error?.code).toBe('update-desktop')
    expect(r.plain).toEqual([`GET ${NET}/remote-api/status`])
    expect(r.desk.log.filter((l) => l.includes('/remote-api/auth'))).toEqual([])
  })

  it('ein Desktop 3.0.7 ueber den Tunnel ohne Kopplung: nur mit dem QR-Code (E2)', async () => {
    const r = await rig()
    r.desk.statusKeys = false
    await r.s().connect(NET, '123456')
    expect(r.s().error?.code).toBe('scan-needed')
    onlyStatusOverTheInternet(r.plain)
    expect(r.phone.posts).toEqual([])
  })
})

describe('QR-Code v2', () => {
  it('liest den Vektor-Link aus PROTOKOLL 18', () => {
    const link =
      'lu://remote?v=2&id=or24zD2Qk4Z7byxTVSh6WQ&k=BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4&t=MzMzMzMzMzMzMzMzMzMzMw&n=Studio+PC&lan=http%3A%2F%2F192.0.2.10%3A11435&net=https%3A%2F%2Fquiet-river-lamp.trycloudflare.com'
    const t = parsePairingInput(link)
    expect(t?.sealed).toEqual({
      uri: link,
      desktopId: 'or24zD2Qk4Z7byxTVSh6WQ',
      x25519: 'BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4',
      name: 'Studio PC',
      lan: 'http://192.0.2.10:11435',
      tunnel: 'https://quiet-river-lamp.trycloudflare.com',
    })
    expect(t?.baseUrl).toBe('http://192.0.2.10:11435')
    expect(t?.code).toBeNull()
  })

  it('weist kaputte Links ab', () => {
    const ok = 'v=2&id=or24zD2Qk4Z7byxTVSh6WQ&k=BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4&t=MzMzMzMzMzMzMzMzMzMzMw&n=PC'
    expect(parsePairingInput(`lu://remote?${ok}&net=${encodeURIComponent(NET)}`)?.sealed?.tunnel).toBe(NET)
    for (const bad of [
      `lu://remote?${ok}`,
      `lu://remote?${ok.replace('v=2', 'v=3')}&lan=${encodeURIComponent(LAN)}`,
      `lu://remote?${ok}&lan=${encodeURIComponent(LAN)}&lan=${encodeURIComponent(LAN)}`,
      `lu://remote?${ok}&net=${encodeURIComponent('http://x.trycloudflare.com')}`,
      `lu://remote?${ok}&net=${encodeURIComponent('https://evil.example')}`,
      `lu://remote?${ok}&lan=${encodeURIComponent(`${LAN}/mobile`)}`,
      `lu://remote?${ok.replace('id=or24zD2Qk4Z7byxTVSh6WQ', 'id=short')}&lan=${encodeURIComponent(LAN)}`,
      `lu://remote?${ok.replace('n=PC', 'n=%0A')}&lan=${encodeURIComponent(LAN)}`,
    ]) {
      expect(parsePairingInput(bad), bad).toBeNull()
    }
  })

  it('koppelt ueber den Tunnel, wartet auf Allow am Rechner und chattet versiegelt', async () => {
    const r = await rig()
    const link = r.desk.sealed!.qrLink({ net: NET })
    r.desk.sealed!.answer = { allow: true, afterPolls: 2 }
    const seen: Array<{ status: string; name: string | null }> = []
    r.store.useStore.subscribe((st) => seen.push({ status: st.status, name: st.confirmOnDesktop?.name ?? null }))
    await r.s().connect(link)
    expect(seen).toContainEqual({ status: 'pairing', name: 'Studio PC' })
    expect(r.s().status).toBe('connected')
    expect(r.s().confirmOnDesktop).toBeNull()
    const c = r.s().connection!
    expect(c.pin?.desktopId).toBe(r.desk.sealed!.desktopId)
    expect(c.pin?.tunnel).toBe(NET)
    expect(c.via).toBe(NET)
    expect(r.s().token).toBe('')
    r.s().newChat()
    expect(await r.s().sendMessage('hello over the internet')).toBe('sent')
    await expect.poll(() => r.s().streamingChatId).toBeNull()
    const answer = r.s().chats[0].messages.at(-1)
    expect(answer?.state).toBe('done')
    expect(answer?.content).toContain('Hello from the desktop model')
    // Nichts im Klartext an den Tunnel, kein Token, kein Code-Login.
    expect(r.plain).toEqual([])
    expect(r.phone.posts.every((p) => p === `${NET}/remote-api/sealed`)).toBe(true)
    expect(r.desk.sealed!.routed.every((x) => x.device === r.phone.deviceId)).toBe(true)
    expect(r.desk.sealed!.routed.some((x) => 'authorization' in x.headers)).toBe(false)
  })

  it('nimmt zuerst das WLAN und faellt bei Stille auf den Tunnel', async () => {
    const r = await rig()
    r.down.add(LAN)
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(NET)
    expect(r.s().connection?.pin?.lan).toBe(LAN)
  })

  it('Ablehnen am Rechner: klarer Satz, kein Nagel', async () => {
    const r = await rig()
    r.desk.sealed!.answer = { allow: false, afterPolls: 1 }
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN }))
    expect(r.s().status).toBe('needs-code')
    expect(r.s().error?.code).toBe('pairing-denied')
    expect(r.s().error?.message).toMatch(/not allowed on your computer/)
    expect(r.s().connection?.pin ?? null).toBeNull()
  })

  it('ein alter QR-Code (ein neuer am Rechner hat ihn entwertet): eigener Satz, neuen Code zeigen und scannen', async () => {
    const r = await rig()
    const old = r.desk.sealed!.qrLink({ lan: LAN })
    // Der Rechner zeigt einen neuen QR-Code: es gilt nur noch dieser (Desktop f06160672, pairing_link).
    r.desk.sealed!.qrLink({ lan: LAN })
    await r.s().connect(old)
    expect(r.s().error?.code).toBe('scan-again')
    expect(r.s().error?.message).toBe('This QR code is no longer valid. Show a new QR code on your computer and scan that one.')
    expect(r.s().connection?.pin ?? null).toBeNull()
  })

  it('zeigt Vergleichscode und Fingerabdruck auch beim QR-Weg, wie der Rechner (comparisonCode, fingerprint)', async () => {
    const r = await rig()
    r.desk.sealed!.answer = { allow: true, afterPolls: 2 }
    const shown: Array<{ sas: string | null; fingerprint: string }> = []
    r.store.useStore.subscribe((st) => {
      if (st.confirmOnDesktop) shown.push({ sas: st.confirmOnDesktop.sas, fingerprint: st.confirmOnDesktop.fingerprint })
    })
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN }))
    expect(r.s().status).toBe('connected')
    expect(shown[0].sas).toMatch(/^\d{6}$/)
    expect(shown[0].fingerprint).toBe(deviceFingerprint(r.phone.deviceId))
    expect(shown[0].fingerprint).toMatch(/^[0-9A-F]{4} [0-9A-F]{4}$/)
  })

  it('ein benutztes Ticket: neu scannen', async () => {
    const r = await rig()
    const link = r.desk.sealed!.qrLink({ lan: LAN })
    await r.s().connect(link)
    expect(r.s().status).toBe('connected')
    await r.s().connect(link)
    expect(r.s().error?.code).toBe('scan-again')
  })

  it('429 beim Handschlag: ein Satz mit Wartezeit, kein stumpfes Wiederholen', async () => {
    const r = await rig()
    r.desk.sealed!.rateLimitNext = true
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().error?.code).toBe('rate-limited')
    expect(r.s().error?.retryAfterSeconds).toBe(60)
    expect(r.desk.sealed!.wire.filter((w) => w === 'handshake')).toHaveLength(1)
  })
})

describe('Code im WLAN (3.0.7)', () => {
  it('koppelt mit Code, deckt auf und zeigt den Vergleichscode', async () => {
    const r = await rig()
    r.desk.sealed!.code = '482913'
    r.desk.sealed!.answer = { allow: true, afterPolls: 3 }
    await r.s().connect(LAN)
    expect(r.s().status).toBe('needs-code')
    const shown: string[] = []
    r.store.useStore.subscribe((st) => {
      if (st.confirmOnDesktop?.sas) shown.push(st.confirmOnDesktop.sas)
    })
    await r.s().submitCode('482913')
    expect(shown.length).toBeGreaterThan(0)
    const sas = shown[0]
    expect(sas).toMatch(/^\d{6}$/)
    expect(r.s().status).toBe('connected')
    // Gleicher Code wie am Desktop: aus Sitzung und aufgedeckter Zahl.
    const routed = r.desk.sealed!.routed
    expect(routed[0].path).toBe('/remote-api/pair/reveal')
    expect(sas).toBe(r.desk.sealed!.shownSas())
    // Der alte Klartext-Login wurde nie gerufen.
    expect(r.desk.log.filter((l) => l.startsWith('POST /remote-api/auth'))).toEqual([])
    expect(r.plain).toEqual([`GET ${LAN}/remote-api/status`])
  })

  it('ein falscher Code ist "falscher Code", nicht "neuer Schluessel"', async () => {
    const r = await rig()
    r.desk.sealed!.code = '482913'
    await r.s().connect(LAN)
    await r.s().submitCode('111111')
    expect(r.s().error?.code).toBe('invalid-code')
  })

  it('ein Desktop bis 3.0.6 im WLAN bleibt beim alten Weg', async () => {
    const r = await rig({ sealed: false })
    await r.s().connect(LAN, '123456')
    expect(r.s().status).toBe('connected')
    expect(r.s().token).not.toBe('')
    expect(r.phone.posts).toEqual([])
  })
})

describe('Gekoppelt', () => {
  async function pairedRig(): Promise<Rig> {
    const r = await rig()
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().status).toBe('connected')
    return r
  }

  it('WAECHTER M2: bietet ein Status im WLAN den Kanal nicht an, geht nichts im Klartext raus', async () => {
    const r = await pairedRig()
    r.desk.sealed!.features = null
    r.plain.length = 0
    await r.s().verifyConnection()
    expect(r.s().status).toBe('offline')
    expect(r.s().error?.code).toBe('downgrade')
    // Nur Status-Abfragen, kein Token-Login, keine Anfrage an den Router im Klartext.
    expect(r.plain.every((p) => p.endsWith('/remote-api/status'))).toBe(true)
    expect(r.desk.log.filter((l) => l.startsWith('POST /remote-api/auth'))).toEqual([])
    expect(r.s().connection?.pin).not.toBeNull()
  })

  it('nach Neustart des Desktops still ein neuer Handschlag', async () => {
    const r = await pairedRig()
    r.desk.sealed!.restart()
    await r.s().refreshModels()
    expect(r.s().models.length).toBeGreaterThan(0)
    expect(r.s().status).toBe('connected')
  })

  it('wiederfinden: WLAN still, dann die letzte Tunnel-Adresse', async () => {
    const r = await pairedRig()
    r.down.add(LAN)
    await r.s().verifyConnection()
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(NET)
    onlyStatusOverTheInternet(r.plain)
  })

  it('die Auskunft ist ausgeschaltet und wird nicht gefragt', async () => {
    let asked = 0
    const r = await rig({ deps: { lookupFetch: async () => (asked++, new Response('{}')) } })
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    await r.s().verifyConnection()
    expect(ADDRESS_LOOKUP_ENABLED).toBe(false)
    expect(asked).toBe(0)
  })

  it('am Rechner entkoppelt: "Pair again", der Nagel faellt', async () => {
    const r = await pairedRig()
    r.desk.sealed!.devices.clear()
    r.desk.sealed!.restart()
    await r.s().refreshModels()
    expect(r.s().status).toBe('needs-code')
    expect(r.s().error?.code).toBe('unpaired')
    expect(r.s().error?.message).toBe('This computer no longer knows this phone. Pair again.')
    expect(r.s().connection?.pin ?? null).toBeNull()
  })

  it('entkoppeln am Handy: erst die Route am Rechner, dann der Nagel', async () => {
    const r = await pairedRig()
    expect(r.desk.sealed!.devices.size).toBe(1)
    await r.s().disconnect()
    expect(r.desk.sealed!.routed.at(-1)?.path).toBe('/remote-api/devices/self/forget')
    expect(r.desk.sealed!.devices.size).toBe(0)
    expect(r.s().connection?.pin ?? null).toBeNull()
    expect(r.s().status).toBe('needs-code')
  })

  it('zurueckgestellte Antwort (202) wird nachgefragt', async () => {
    const r = await pairedRig()
    r.desk.sealed!.deferChats = 1
    r.desk.sealed!.deferPolls = 2
    r.s().newChat()
    expect(await r.s().sendMessage('long one')).toBe('sent')
    await expect.poll(() => r.s().streamingChatId).toBeNull()
    expect(r.s().chats[0].messages.at(-1)?.state).toBe('done')
    expect(r.desk.sealed!.routed.filter((x) => x.path.startsWith('/remote-api/pending/'))).toHaveLength(3)
  })

  it('fehlendes Recht: ehrlicher Satz "not allowed on your computer"', async () => {
    const r = await pairedRig()
    const pin = r.s().connection!.pin as SealedPin
    const client = createRemoteClient({
      baseUrl: LAN,
      sealed: true,
      fetch: createSealedFetch({ invoke: r.phone.invoke, pin: () => pin, address: () => LAN }),
    })
    const tool = await client.runAgentTool({ tool: 'file_read', args: { path: 'a' } })
    expect(tool.ok).toBe(false)
    expect(tool.needsPermission).toBe('files')
    expect(tool.error).toMatch(/File access is not allowed on your computer/)
    const dev = [...r.desk.sealed!.devices.values()][0]
    dev.rights.delete('chat')
    const err = await client.chatWithTools({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'x' }], tools: [] }).catch((e) => e)
    expect(err).toBeInstanceOf(RemotePermissionError)
    expect(err.userMessage).toMatch(/Chat is not allowed on your computer/)
  })
})

describe('Fehlertexte aus Rust', () => {
  it('liest den Code', () => {
    expect(sealedErrorCode('remote_sealed: rate_limited: 42')).toEqual({ code: 'rate_limited', detail: '42' })
    expect(sealedErrorCode(new Error('remote_sealed: unknown_device'))).toEqual({ code: 'unknown_device', detail: '' })
    expect(sealedErrorCode('something else')).toBeNull()
  })

  it('ordnet jedem Code eine Klasse mit naechstem Schritt zu', () => {
    const cases: Array<[string, string]> = [
      ['remote_sealed: unknown_device', 'unpaired'],
      ['remote_sealed: handshake_failed', 'new-key'],
      ['remote_sealed: wrong_desktop', 'new-key'],
      ['remote_sealed: unknown_ticket', 'scan-again'],
      ['remote_sealed: pairing_denied', 'pairing-denied'],
      ['remote_sealed: not_supported', 'update-desktop'],
      ['remote_sealed: rate_limited: 30', 'rate-limited'],
      ['remote_sealed: unreachable: The desktop could not be reached.', 'unreachable'],
      ['remote_sealed: timeout', 'timeout'],
      ['remote_sealed: cancelled', 'aborted'],
      ['remote_sealed: address_refused: the code works on Wi-Fi only', 'scan-needed'],
      ['remote_sealed: bad_reveal', 'protocol'],
    ]
    for (const [text, code] of cases) expect(sealedError(text, true).code, text).toBe(code)
    for (const [text] of cases) expect(sealedError(text, true).userMessage).not.toContain(String.fromCharCode(0x2014))
  })
})

describe('Adressauskunft (Attrappe in der Form von Web)', () => {
  const ID = 'or24zD2Qk4Z7byxTVSh6WQ'
  it('aus: kein Netzaufruf', async () => {
    let calls = 0
    expect(await lookupDesktopAddress(ID, { fetch: async () => (calls++, new Response('{}')) })).toBeNull()
    expect(calls).toBe(0)
  })

  it('an: Antwortformen 200, 404, 400, 429 mit Retry-After', async () => {
    const urls: string[] = []
    const answer = (status: number, body: unknown, headers: Record<string, string> = {}) => async (url: string) => {
      urls.push(url)
      return new Response(JSON.stringify(body), { status, headers })
    }
    expect(await lookupDesktopAddress(ID, { enabled: true, fetch: answer(200, { address: NET, time: 1790000000 }) })).toBe(NET)
    expect(urls[0]).toBe(`https://lu-labs.ai/api/remote/address/${ID}`)
    expect(await lookupDesktopAddress(ID, { enabled: true, fetch: answer(200, { address: 'https://evil.example', time: 1 }) })).toBeNull()
    expect(await lookupDesktopAddress(ID, { enabled: true, fetch: answer(404, { error: 'not_found' }) })).toBeNull()
    expect(await lookupDesktopAddress(ID, { enabled: true, fetch: answer(400, { error: 'bad_request' }) })).toBeNull()
    let t = 1_000
    const now = () => t
    expect(await lookupDesktopAddress(ID, { enabled: true, now, fetch: answer(429, { error: 'rate_limited' }, { 'retry-after': '30' }) })).toBeNull()
    const before = urls.length
    // Gesperrt: kein Aufruf bis zum Ablauf.
    expect(await lookupDesktopAddress(ID, { enabled: true, now, fetch: answer(200, { address: NET, time: 1 }) })).toBeNull()
    expect(urls.length).toBe(before)
    t += 31_000
    expect(await lookupDesktopAddress(ID, { enabled: true, now, fetch: answer(200, { address: NET, time: 1 }) })).toBe(NET)
    expect(await lookupDesktopAddress('bad id', { enabled: true, fetch: answer(200, { address: NET }) })).toBeNull()
  })
})

describe('R55: Kopplungsfenster, veraltete Adressen, Fingerabdruck (Desktop f72041dab)', () => {
  it('H1: Fenster am Rechner zu, der WLAN-Status nennt keinen Schluessel: "Open pairing", kein "Update"; neu lesen nach dem Oeffnen', async () => {
    const r = await rig()
    r.desk.sealed!.code = '482913'
    r.desk.statusKeys = false
    await r.s().connect(LAN, '482913')
    expect(r.s().status).toBe('needs-code')
    expect(r.s().error?.code).toBe('open-pairing')
    expect(r.s().error?.message).toMatch(/^Open pairing on your computer/)
    expect(r.s().error?.message).not.toMatch(/Update/)
    expect(r.phone.posts).toEqual([])
    // Am Rechner geoeffnet, die App kommt zurueck: der Status wird neu gelesen.
    r.desk.statusKeys = true
    await r.s().handleForeground()
    expect(r.s().status).toBe('needs-code')
    expect(r.s().error).toBeNull()
    await r.s().submitCode('482913')
    expect(r.s().status).toBe('connected')
  })

  it('der Code wird am Rechner nicht mehr gezeigt (unknown_ticket auf dem Code-Weg): eigener Satz', async () => {
    const r = await rig()
    r.desk.sealed!.code = '482913'
    await r.s().connect(LAN)
    r.desk.sealed!.code = null
    await r.s().submitCode('482913')
    expect(r.s().error?.code).toBe('scan-again')
    expect(r.s().error?.message).toMatch(/Open pairing there again and enter the new code/)
  })

  it('gekoppelt, die Tunnel-Adresse ist veraltet (404 auf Status und Kanal): neu suchen im WLAN, nicht "Update"', async () => {
    const r = await rig()
    r.down.add(LAN)
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().connection?.via).toBe(NET)
    // Tunnel neu gestartet: unter dem alten Namen antwortet nur noch 404.
    r.gone.add(NET)
    r.s().newChat()
    await r.s().sendMessage('still there?')
    await expect.poll(() => r.s().streamingChatId).toBeNull()
    expect(r.s().status).toBe('offline')
    expect(r.s().error?.code).toBe('stale-address')
    // Der alte Name ist vergessen, er kommt nie wieder.
    await expect.poll(() => r.s().connection?.pin?.tunnel ?? null).toBeNull()
    // Wieder im WLAN: die neue Suche findet den Rechner.
    r.down.delete(LAN)
    await r.s().verifyConnection()
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(LAN)
    expect(r.s().error).toBeNull()
  })

  it('eine 404 der veralteten Adresse loest von selbst genau eine neue Suche aus', async () => {
    const r = await rig()
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().connection?.via).toBe(LAN)
    // Unter der WLAN-Adresse antwortet jetzt ein anderes Geraet (404), der Tunnel geht noch.
    r.gone.add(LAN)
    r.s().newChat()
    await r.s().sendMessage('hello')
    await expect.poll(() => r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(NET)
    // Die WLAN-Adresse bleibt gemerkt (eine IP kann zurueckkommen), nur der Tunnel-Name wird vergessen.
    expect(r.s().connection?.pin?.lan).toBe(LAN)
  })

  it('nichts antwortet ausser 404: klarer Satz ueber die Adresse, nie "Update"', async () => {
    const r = await rig()
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN_NAME, net: NET }))
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.pin?.lan).toBe(LAN_NAME)
    r.gone.add(LAN_NAME)
    r.gone.add(NET)
    await r.s().verifyConnection()
    expect(r.s().status).toBe('offline')
    expect(r.s().error?.code).toBe('stale-address')
    expect(r.s().error?.message).not.toMatch(/Update/)
  })

  it('nur ein nachweislich alter Desktop (Status ohne sealed) bekommt "Update"', async () => {
    const r = await rig({ sealed: false })
    await r.s().connect(NET)
    expect(r.s().error?.code).toBe('update-desktop')
    expect(sealedErrorPinned(new Error('remote_sealed: not_supported'), true).code).toBe('stale-address')
    expect(sealedError(new Error('remote_sealed: not_supported'), true).code).toBe('update-desktop')
  })

  it('Fingerabdruck: dieselbe Rechnung wie device_fingerprint des Desktops (Vektor PROTOKOLL 18)', () => {
    // device_id des Handys aus Abschnitt 18; Bytes 0..4 = e7 ca cc 8d (mit Node nachgerechnet).
    expect(deviceFingerprint('58rMjVetyvNEolYoD_7S7Q')).toBe('E7CA CC8D')
    expect(deviceFingerprint('AAAAAAAAAAAAAAAAAAAAAA')).toBe('0000 0000')
    expect(deviceFingerprint('_____________________w')).toBe('FFFF FFFF')
    // Nicht kanonisch (Endbits), falsche Laenge, falsches Alphabet: '' wie am Desktop.
    expect(deviceFingerprint('58rMjVetyvNEolYoD_7S7R')).toBe('')
    expect(deviceFingerprint('58rMjVetyvNEolYoD_7S7')).toBe('')
    expect(deviceFingerprint('58rMjVetyvNEolYoD+7S7Q')).toBe('')
  })
})

describe('Windows-Firewall: das WLAN schweigt (Windows-Box, 21.10.2026)', () => {
  const FAST = { wifiHeadStartMs: 120, timeouts: { probeMs: 8_000 } }

  it('Kopplung mit Tunnel im QR-Code: nach kurzem Vorsprung gleich ueber den Tunnel, mit Hinweis', async () => {
    const r = await rig({ deps: { ...FAST, networkKind: async () => 'wifi' } })
    r.silent.add(LAN)
    const t0 = Date.now()
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(NET)
    // Nicht den ganzen Zeitablauf (8 s) abgewartet.
    expect(Date.now() - t0).toBeLessThan(4_000)
    expect(r.s().lanBlocked).toBe(true)
    // Das Ticket ging nur einmal raus: kein Koppeln ueber das stumme WLAN.
    expect(r.phone.posts.some((p) => p.startsWith(LAN))).toBe(false)
    expect(r.s().connection?.pin?.lan).toBe(LAN)
  })

  it('wieder verbinden: das WLAN schweigt, der Tunnel ist bekannt: gleich ueber ihn, mit Hinweis', async () => {
    const r = await rig({ deps: { ...FAST, networkKind: async () => 'unknown' } })
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().connection?.via).toBe(LAN)
    expect(r.s().lanBlocked).toBe(false)
    r.silent.add(LAN)
    const t0 = Date.now()
    await r.s().verifyConnection()
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(NET)
    expect(Date.now() - t0).toBeLessThan(4_000)
    expect(r.s().lanBlocked).toBe(true)
    // Das WLAN geht wieder: kein Hinweis mehr.
    r.silent.delete(LAN)
    await r.s().verifyConnection()
    expect(r.s().connection?.via).toBe(LAN)
    expect(r.s().lanBlocked).toBe(false)
  })

  it('im Mobilfunk sagt ein stummes WLAN nichts ueber den Rechner: kein Hinweis', async () => {
    const r = await rig({ deps: { ...FAST, networkKind: async () => 'cellular' } })
    r.silent.add(LAN)
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN, net: NET }))
    expect(r.s().connection?.via).toBe(NET)
    expect(r.s().lanBlocked).toBe(false)
  })

  it('nur das WLAN bekannt und es schweigt: der Satz nennt die Firewall', async () => {
    const r = await rig({ deps: { timeouts: { probeMs: 150 } } })
    await r.s().connect(r.desk.sealed!.qrLink({ lan: LAN }))
    expect(r.s().status).toBe('connected')
    r.silent.add(LAN)
    await r.s().verifyConnection()
    expect(r.s().status).toBe('offline')
    expect(r.s().error?.code).toBe('timeout')
    expect(r.s().error?.message).toBe(WIFI_TIMEOUT_TEXT)
  })

  it('der Desktop meldet lan_blocked: der Hinweis steht auch ueber das Internet', async () => {
    const r = await rig()
    r.desk.lanBlocked = true
    await r.s().connect(r.desk.sealed!.qrLink({ net: NET }))
    expect(r.s().status).toBe('connected')
    expect(r.s().connection?.via).toBe(NET)
    expect(r.s().lanBlocked).toBe(true)
    r.desk.lanBlocked = false
    await r.s().verifyConnection()
    expect(r.s().lanBlocked).toBe(false)
  })

  it('Saetze: nur ein Zeitablauf ohne jede Antwort im WLAN nennt die Firewall', () => {
    const probe = { step: 'probe' as const, call: 'GET /remote-api/status' }
    expect(new RemoteTimeoutError('x', probe).userMessage).toBe(WIFI_TIMEOUT_TEXT)
    expect(new RemoteTimeoutError('x', { step: 'auth', call: 'POST /remote-api/sealed (pair)' }).userMessage).toBe(WIFI_TIMEOUT_TEXT)
    expect(new RemoteTimeoutError('x', undefined, { wifi: true }).userMessage).toBe(WIFI_TIMEOUT_TEXT)
    // Nach einer Antwort (Code-Weg, Pairing) ist es nicht die Firewall.
    expect(new RemoteTimeoutError('x', { step: 'auth', call: 'POST /remote-api/auth' }).userMessage).toMatch(/answered, then stopped answering/)
    expect(new RemoteTimeoutError('x', { step: 'bootstrap', call: 'GET /api/tags' }).userMessage).toMatch(/Pairing worked/)
    // Hamachi, Tailscale: eigener Satz, nicht die Firewall.
    expect(new RemoteTimeoutError('x', { ...probe, notWifi: true }).userMessage).not.toBe(WIFI_TIMEOUT_TEXT)
    // Ueber das Internet: wie bisher.
    expect(new RemoteTimeoutError('x').userMessage).toBe('Your desktop took too long to answer. Check the connection and try again.')
    expect(sealedError(new Error('remote_sealed: timeout: no answer'), false, true).userMessage).toBe(WIFI_TIMEOUT_TEXT)
    expect(sealedError(new Error('remote_sealed: timeout: no answer'), true, false).userMessage).not.toBe(WIFI_TIMEOUT_TEXT)
  })
})
