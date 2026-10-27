// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import type { RemoteChat, RemoteMessage } from '../../../remote/remoteClientStore'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import {
  KNOWN_DESKTOPS_KEY,
  KNOWN_DESKTOPS_MAX,
  __resetKnownDesktopsForTests,
  forgetKnownDesktop,
  knownDesktops,
  rememberDesktop,
  sanitizeKnown,
  subscribeKnownDesktops,
  withRemembered,
} from '../parts/knownDesktops'
import { cameraFailure, interpretScan } from '../parts/scan'
import {
  remoteModelLabel,
  chatPreview,
  cleanPasscodeInput,
  agentAbilities,
  chatDesktopName,
  connectStart,
  desktopName,
  groupChatsByDesktop,
  isForeignChat,
  stepPermissionName,
  stepTitle,
  errorField,
  shownError,
  messageFooter,
  readConnectInput,
  relativeTime,
  reusableEmptyChat,
  secondsLeft,
  typedAddress,
  sendBlocked,
  sortedChats,
  unansweredAction,
  unreachableChecks,
} from '../parts/view'
import { REMOTE_AGENT_TOOLS } from '../../../remote/remoteAgent'
import { photoRoom } from '../parts/photos'

function answer(over: Partial<RemoteMessage>): RemoteMessage {
  return { id: 'm1', role: 'assistant', content: '', thinking: '', createdAt: 1, state: 'done', ...over }
}

function chat(over: Partial<RemoteChat>): RemoteChat {
  return { id: 'c1', title: 'New Chat', model: '', thinkEnabled: false, systemPrompt: null, agentMode: false, caveman: 'off', baseUrl: null, createdAt: 1, updatedAt: 1, messages: [], ...over }
}

describe('the two fields of R2', () => {
  it('reads an address with and without a code', () => {
    const plain = readConnectInput('192.168.1.20:11435', '')
    expect(plain.target?.baseUrl).toBe('http://192.168.1.20:11435')
    expect(plain.code).toBeNull()
    expect(plain.codeIncomplete).toBe(false)
    expect(readConnectInput('192.168.1.20:11435', '482 913').code).toBe('482913')
  })

  it('a code typed into the address field is no address, and half a code is said', () => {
    expect(readConnectInput('123456', '').target).toBeNull()
    const half = readConnectInput('192.168.1.20:11435', '123')
    expect(half.code).toBeNull()
    expect(half.codeIncomplete).toBe(true)
  })

  it('keeps only what a code can be made of', () => {
    expect(cleanPasscodeInput('48a2-91 3xyz')).toBe('482-91 3')
    expect(cleanPasscodeInput('12345678901')).toHaveLength(8)
  })

  it('puts every error under the field it is about', () => {
    expect(errorField(null)).toBeNull()
    for (const code of ['invalid-address', 'unreachable', 'timeout', 'not-lu', 'protocol']) {
      expect(errorField({ code, message: 'x' } as never)).toBe('address')
    }
    for (const code of ['invalid-code', 'rate-limited', 'session-expired']) {
      expect(errorField({ code, message: 'x' } as never)).toBe('passcode')
    }
    expect(errorField({ code: 'memory-revoked', message: 'x' } as never)).toBe('notice')
  })

  it('counts the wait down to zero and never below', () => {
    expect(secondsLeft(null, 1000)).toBe(0)
    expect(secondsLeft(61_000, 1000)).toBe(60)
    expect(secondsLeft(1500, 1000)).toBe(1)
    expect(secondsLeft(500, 1000)).toBe(0)
  })
})

describe('round 57: a new desktop that does not answer asks for the pairing panel', () => {
  const fresh = { route: 'lan' as const, pairedAt: null, lastOkAt: null, pin: null }
  const unreachable = { code: 'unreachable' as const, message: 'Cannot reach your desktop. ...' }

  it('a never paired Wi-Fi desktop gets "Open pairing on your computer"', () => {
    const out = shownError(unreachable, fresh)
    expect(out?.code).toBe('open-pairing')
    expect(out?.message).toMatch(/^Open pairing on your computer/)
    expect(errorField(out)).toBe('notice')
    expect(shownError({ code: 'timeout', message: 'slow' }, { ...fresh, route: 'loopback' })?.code).toBe('open-pairing')
  })

  it('a desktop that worked before, a pinned one and an internet link keep the real sentence', () => {
    expect(shownError(unreachable, { ...fresh, pairedAt: 5 })).toBe(unreachable)
    expect(shownError(unreachable, { ...fresh, lastOkAt: 5 })).toBe(unreachable)
    expect(shownError(unreachable, { ...fresh, pin: {} as never })).toBe(unreachable)
    expect(shownError(unreachable, { ...fresh, route: 'tunnel' })).toBe(unreachable)
    expect(shownError(unreachable, { ...fresh, route: 'public' })).toBe(unreachable)
    expect(shownError(unreachable, null)).toBe(unreachable)
  })

  it('other errors pass unchanged', () => {
    const wrong = { code: 'invalid-code' as const, message: 'wrong' }
    expect(shownError(wrong, fresh)).toBe(wrong)
    expect(shownError(null, fresh)).toBeNull()
  })
})

describe('what R2 shows when it opens', () => {
  const nothing = { handed: null, draft: { address: '', fromLink: false }, connectionAddress: null, offeredAddress: null }

  it('a handed pairing link fills address and code, and is marked as coming from a link', () => {
    const handed = { baseUrl: 'http://192.168.1.20:11435', secure: false, code: '482913' }
    expect(connectStart({ ...nothing, handed })).toEqual({ address: '192.168.1.20:11435', passcode: '482913', fromLink: true })
  })

  it('a handed link wins over what was typed before and over the desktop that is set up', () => {
    const handed = { baseUrl: 'https://quiet-river-1234.trycloudflare.com', secure: true, code: null }
    const start = connectStart({ handed, draft: { address: '10.0.0.5', fromLink: false }, connectionAddress: '192.168.1.20:11435', offeredAddress: null })
    expect(start).toEqual({ address: 'https://quiet-river-1234.trycloudflare.com', passcode: '', fromLink: true })
  })

  it('without a handed link: the draft, then the connection, then an offer that is still open', () => {
    expect(connectStart({ ...nothing, draft: { address: '10.0.0.5', fromLink: true }, connectionAddress: 'x' })).toEqual({ address: '10.0.0.5', passcode: '', fromLink: true })
    expect(connectStart({ ...nothing, connectionAddress: '192.168.1.20:11435', offeredAddress: 'y' })).toEqual({ address: '192.168.1.20:11435', passcode: '', fromLink: false })
    expect(connectStart({ ...nothing, offeredAddress: '192.168.1.9' })).toEqual({ address: '192.168.1.9', passcode: '', fromLink: true })
    expect(connectStart(nothing)).toEqual({ address: '', passcode: '', fromLink: false })
  })

  it('the address is written the way a person types it', () => {
    expect(typedAddress({ baseUrl: 'http://192.168.1.20:11435', secure: false })).toBe('192.168.1.20:11435')
    expect(typedAddress({ baseUrl: 'https://a.trycloudflare.com', secure: true })).toBe('https://a.trycloudflare.com')
  })
})

describe('what to check when the desktop is silent', () => {
  it('names Wi-Fi, guest network, firewall and the address for a local desktop', () => {
    const list = unreachableChecks({ route: 'lan', os: 'android', deviceOnline: true })
    expect(list).toEqual([S.checks.open, S.checks.sameWifi, S.checks.guest, S.checks.firewall, S.checks.address])
  })

  it('adds the local network permission on an iPhone and the dead link first', () => {
    const list = unreachableChecks({ route: 'lan', os: 'ios', deviceOnline: false })
    expect(list[0]).toBe(S.checks.phoneOffline)
    expect(list).toContain(S.checks.iosLocal)
  })

  it('does not talk about Wi-Fi when the desktop is reached over the internet', () => {
    const list = unreachableChecks({ route: 'tunnel', os: 'android', deviceOnline: true })
    expect(list).toEqual([S.checks.open, S.checks.tunnel])
  })
})

describe('what stands under an answer', () => {
  it('nothing under a finished answer or a question', () => {
    expect(messageFooter(answer({}), true, 'connected')).toBeNull()
    expect(messageFooter(answer({ role: 'user', state: 'failed' }), true, 'connected')).toBeNull()
  })

  it('a stopped answer can be asked again, but only as the last one', () => {
    expect(messageFooter(answer({ state: 'stopped' }), true, 'connected')).toMatchObject({ tone: 'quiet', action: 'retry' })
    expect(messageFooter(answer({ state: 'stopped' }), false, 'connected')?.action).toBeNull()
  })

  it('an ended session leads to the code, a lost desktop to Reconnect', () => {
    const expired = answer({ state: 'failed', error: { code: 'session-expired', message: 'ended' } as never })
    expect(messageFooter(expired, true, 'needs-code')).toMatchObject({ tone: 'error', action: 'enter-code', text: 'ended' })
    expect(messageFooter(expired, true, 'connected')?.action).toBe('retry')
    const lost = answer({ state: 'failed', error: { code: 'unreachable', message: 'gone' } as never })
    expect(messageFooter(lost, true, 'offline')).toMatchObject({ title: S.chat.connectionLostTitle, action: 'reconnect' })
    expect(messageFooter(lost, true, 'connected')?.action).toBe('retry')
    const cut = answer({ state: 'interrupted', error: { code: 'connection-lost', message: 'cut' } as never })
    expect(messageFooter(cut, true, 'offline')).toMatchObject({ title: S.chat.connectionLostTitle, action: 'reconnect' })
  })

  it('a question without an answer gets the action the state allows', () => {
    expect(unansweredAction('connected')).toBe('retry')
    expect(unansweredAction('needs-code')).toBe('enter-code')
    expect(unansweredAction('offline')).toBe('reconnect')
    expect(unansweredAction('blocked')).toBe('reconnect')
  })

  it('says why sending is blocked', () => {
    expect(sendBlocked({ status: 'connected', streamingChatId: null }, 'a')).toBeUndefined()
    expect(sendBlocked({ status: 'connected', streamingChatId: 'a' }, 'a')).toBeUndefined()
    expect(sendBlocked({ status: 'connected', streamingChatId: 'b' }, 'a')).toBe(S.chat.sendBlockedBusy)
    expect(sendBlocked({ status: 'offline', streamingChatId: null }, 'a')).toBe(S.chat.sendBlockedOffline)
  })
})

describe('the list of remote chats', () => {
  it('sorts newest first without touching the store array', () => {
    const list = [chat({ id: 'old', updatedAt: 1 }), chat({ id: 'new', updatedAt: 9 })]
    expect(sortedChats(list).map((c) => c.id)).toEqual(['new', 'old'])
    expect(list.map((c) => c.id)).toEqual(['old', 'new'])
  })

  it('shows the last thing that was said, on one line and cut', () => {
    expect(chatPreview(chat({}))).toBe(S.home.emptyChatPreview)
    const long = 'word '.repeat(60)
    const preview = chatPreview(chat({ messages: [answer({ role: 'user', content: 'first' }), answer({ content: `line one\n\n${long}` }), answer({ id: 'm3', content: '' })] }))
    expect(preview.startsWith('line one word')).toBe(true)
    expect(preview.length).toBe(120)
  })

  it('names the time in the steps a person uses', () => {
    const now = 10 * 86_400_000
    expect(relativeTime(0, now)).toBe('')
    expect(relativeTime(now - 20_000, now)).toBe('now')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 d ago')
    expect(relativeTime(now - 9 * 86_400_000, now)).toMatch(/1970/)
  })

  it('uses an empty chat again', () => {
    expect(reusableEmptyChat([chat({ id: 'full', messages: [answer({})] }), chat({ id: 'empty' })])?.id).toBe('empty')
    expect(reusableEmptyChat([chat({ id: 'full', messages: [answer({})] })])).toBeUndefined()
  })
})

describe('what a scan means', () => {
  it('takes the address of the desktop in every form the QR code may have', () => {
    const reading = interpretScan('  http://192.168.1.20:11435/mobile  ')
    expect(reading).toMatchObject({ kind: 'desktop', address: '192.168.1.20:11435' })
    expect(interpretScan('https://quiet-river-1234.trycloudflare.com/mobile').kind).toBe('desktop')
  })

  it('calls everything else foreign', () => {
    expect(interpretScan('WIFI:S:guests;T:WPA;P:secret;;').kind).toBe('foreign')
    expect(interpretScan('').kind).toBe('foreign')
    expect(interpretScan(null).kind).toBe('foreign')
  })

  it('tells a refused camera from a broken one', () => {
    expect(cameraFailure({ name: 'NotAllowedError' })).toBe('denied')
    expect(cameraFailure({ name: 'SecurityError' })).toBe('denied')
    expect(cameraFailure({ name: 'NotFoundError' })).toBe('failed')
    expect(cameraFailure(null)).toBe('failed')
  })
})

describe('desktops this phone was paired with', () => {
  beforeEach(() => {
    localStorage.clear()
    __resetKnownDesktopsForTests()
  })

  it('remembers the newest first, once each, and at most a handful', () => {
    for (let i = 1; i <= KNOWN_DESKTOPS_MAX + 2; i++) rememberDesktop(`http://192.168.1.${i}:11435`, i)
    rememberDesktop('http://192.168.1.4:11435', 100)
    const list = knownDesktops()
    expect(list).toHaveLength(KNOWN_DESKTOPS_MAX)
    expect(list[0]).toEqual({ baseUrl: 'http://192.168.1.4:11435', address: '192.168.1.4:11435', route: 'lan', lastConnectedAt: 100 })
    expect(list.filter((d) => d.baseUrl === 'http://192.168.1.4:11435')).toHaveLength(1)
    expect(list.some((d) => d.baseUrl === 'http://192.168.1.1:11435')).toBe(false)
  })

  it('writes the address and the time, never a token or a code', () => {
    rememberDesktop('http://192.168.1.20:11435', 5)
    const saved = JSON.parse(localStorage.getItem(KNOWN_DESKTOPS_KEY) ?? '[]') as Array<Record<string, unknown>>
    expect(Object.keys(saved[0]).sort()).toEqual(['address', 'baseUrl', 'lastConnectedAt', 'route'])
  })

  it('survives a restart and tells listeners about changes', () => {
    rememberDesktop('http://192.168.1.20:11435', 5)
    __resetKnownDesktopsForTests()
    expect(knownDesktops().map((d) => d.address)).toEqual(['192.168.1.20:11435'])
    let told = 0
    const off = subscribeKnownDesktops(() => (told += 1))
    forgetKnownDesktop('http://192.168.1.20:11435')
    expect(told).toBe(1)
    expect(knownDesktops()).toEqual([])
    expect(localStorage.getItem(KNOWN_DESKTOPS_KEY)).toBeNull()
    off()
  })

  it('drops whatever a damaged list holds', () => {
    expect(sanitizeKnown('nonsense')).toEqual([])
    expect(sanitizeKnown([null, { baseUrl: 5 }, { baseUrl: 'javascript:alert(1)' }, { baseUrl: 'http://192.168.1.20:11435', lastConnectedAt: 'x', token: 'abc' }])).toEqual([
      { baseUrl: 'http://192.168.1.20:11435', address: '192.168.1.20:11435', route: 'lan', lastConnectedAt: 0 },
    ])
    localStorage.setItem(KNOWN_DESKTOPS_KEY, '{broken')
    __resetKnownDesktopsForTests()
    expect(knownDesktops()).toEqual([])
    expect(withRemembered([], 'not an address', 1)).toEqual([])
  })
})

describe('round 2: chats belong to a desktop', () => {
  const A = 'http://192.168.1.20:11435'
  const B = 'http://192.168.1.30:11435'
  const said = [answer({ role: 'user', content: 'Hi' })]

  it('names a desktop by its computer name and falls back to the address', () => {
    expect(desktopName({ address: '192.168.1.20:11435', hostName: 'Studio Mac' })).toBe('Studio Mac')
    expect(desktopName({ address: '192.168.1.20:11435', hostName: '' })).toBe('192.168.1.20:11435')
    expect(desktopName({ address: '192.168.1.20:11435' })).toBe('192.168.1.20:11435')
    expect(desktopName(null)).toBe('')
  })

  it('names the desktop of a chat from the connection, the remembered list, or its address', () => {
    const connection = { baseUrl: A, address: '192.168.1.20:11435', hostName: 'Studio Mac' }
    const known = [{ baseUrl: B, address: '192.168.1.30:11435', name: 'Office PC' }]
    expect(chatDesktopName(A, connection, known)).toBe('Studio Mac')
    expect(chatDesktopName(B, connection, known)).toBe('Office PC')
    expect(chatDesktopName(B, connection, [])).toBe('192.168.1.30:11435')
    expect(chatDesktopName(null, connection, known)).toBe('')
  })

  it('knows a chat of another desktop and blocks sending into it', () => {
    expect(isForeignChat({ baseUrl: B }, { baseUrl: A })).toBe(true)
    expect(isForeignChat({ baseUrl: A }, { baseUrl: A })).toBe(false)
    expect(isForeignChat({ baseUrl: null }, { baseUrl: A })).toBe(false)
    expect(isForeignChat({ baseUrl: B }, null)).toBe(false)
    expect(sendBlocked({ status: 'connected', streamingChatId: null }, 'c1', true)).toBe('this chat belongs to another desktop')
    expect(sendBlocked({ status: 'connected', streamingChatId: null }, 'c1', false)).toBeUndefined()
    expect(sendBlocked({ status: 'offline', streamingChatId: null }, 'c1', true)).toBe('not connected')
  })

  it('reuses an empty chat of this desktop only', () => {
    const chats = [chat({ id: 'other', baseUrl: B }), chat({ id: 'mine', baseUrl: A })]
    expect(reusableEmptyChat(chats, A)?.id).toBe('mine')
    expect(reusableEmptyChat([chat({ id: 'other', baseUrl: B })], A)).toBeUndefined()
    expect(reusableEmptyChat([chat({ id: 'free', baseUrl: null })], A)?.id).toBe('free')
  })

  it('groups the chats by desktop with the connected one first and leaves blank chats out', () => {
    const chats = [
      chat({ id: 'b1', baseUrl: B, updatedAt: 9, messages: said }),
      chat({ id: 'a1', baseUrl: A, updatedAt: 5, messages: said }),
      chat({ id: 'n1', baseUrl: null, updatedAt: 7, messages: said }),
      chat({ id: 'blank', baseUrl: A, updatedAt: 99 }),
    ]
    const groups = groupChatsByDesktop(chats, A)
    expect(groups.map((g) => [g.baseUrl, g.current, g.chats.map((c) => c.id)])).toEqual([
      [A, true, ['n1', 'a1']],
      [B, false, ['b1']],
    ])
    expect(groupChatsByDesktop(chats, null).map((g) => [g.baseUrl, g.current])).toEqual([
      [B, false],
      [null, false],
      [A, false],
    ])
    expect(groupChatsByDesktop([], A)).toEqual([])
  })

  it('remembers the name of a desktop and keeps it when a later pairing sends none', () => {
    const first = withRemembered([], A, 1, '  Studio\u0000 Mac ')
    expect(first[0]).toMatchObject({ baseUrl: A, name: 'Studio Mac' })
    const second = withRemembered(first, A, 2)
    expect(second).toHaveLength(1)
    expect(second[0]).toMatchObject({ lastConnectedAt: 2, name: 'Studio Mac' })
    expect(withRemembered(second, B, 3)[0].name).toBeUndefined()
  })
})

describe('round 2: agent mode in words', () => {
  it('lists what the desktop allows', () => {
    expect(agentAbilities(null)).toEqual(['web search'])
    expect(agentAbilities({ filesystem: true, shell: false, downloads: false, process_control: false })).toEqual(['web search', 'files'])
    expect(agentAbilities({ filesystem: true, shell: true, downloads: false, process_control: false })).toEqual(['web search', 'files', 'terminal commands'])
  })

  it('gives every offered tool a readable name and names the switch a refused step needs', () => {
    for (const tool of REMOTE_AGENT_TOOLS) expect(stepTitle({ tool })).not.toBe(tool)
    expect(stepTitle({ tool: 'something_new' })).toBe('something_new')
    expect(stepPermissionName({ tool: 'file_read', needsPermission: 'filesystem' })).toBe('Files')
    expect(stepPermissionName({ tool: 'shell_execute' })).toBe('Terminal commands')
    expect(stepPermissionName({ tool: 'web_search' })).toBe('')
  })

  it('counts the room for photos', () => {
    expect(photoRoom(0)).toBe(4)
    expect(photoRoom(4)).toBe(0)
    expect(photoRoom(9)).toBe(0)
  })
})

describe('scan support inside the Android app (acceptance android-knoepfe, M11)', () => {
  it('the Android app scans natively (round 57, a photo of the system camera), never with the camera picture in the page', async () => {
    const { scanSupportFor } = await import('../parts/useScanSupport')
    expect(scanSupportFor('web', 'android', true)).toBe('none')
    expect(scanSupportFor('native', 'android', true)).toBe('native')
    expect(scanSupportFor('none', 'android', true)).toBe('none')
  })

  it('iOS keeps its scanner, and a browser tab keeps the camera picture', async () => {
    const { scanSupportFor } = await import('../parts/useScanSupport')
    expect(scanSupportFor('native', 'ios', true)).toBe('native')
    expect(scanSupportFor('web', 'android', false)).toBe('web')
    expect(scanSupportFor('web', null, false)).toBe('web')
    expect(scanSupportFor('none', 'ios', true)).toBe('none')
  })

  it('the manifest still declares no camera permission, which is what the rule stands on', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const manifest = readFileSync(resolve(__dirname, '../../../../../src-tauri/gen/android/app/src/main/AndroidManifest.xml'), 'utf8')
    expect(manifest.replace(/<!--[\s\S]*?-->/g, '')).not.toMatch(/uses-permission[^>]*android\.permission\.CAMERA/)
  })
})

describe('A17: the name of a desktop model on the screen', () => {
  it('shows a Windows file path as the file name without .gguf', () => {
    expect(remoteModelLabel('C:\\Users\\someone\\AppData\\Local\\LU\\models\\Qwen3.5-9B-Q4_K_M.gguf')).toBe('Qwen3.5-9B-Q4_K_M')
    expect(remoteModelLabel('/Users/someone/models/llama-3.2-3b.Q4.GGUF')).toBe('llama-3.2-3b.Q4')
    expect(remoteModelLabel('lu-engine::D:\\m\\phi.gguf')).toBe('phi')
  })
  it('leaves Ollama names as they are', () => {
    expect(remoteModelLabel('qwen3:8b')).toBe('qwen3:8b')
    expect(remoteModelLabel('hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M')).toBe('hf.co/bartowski/Qwen3-8B-GGUF:Q4_K_M')
    expect(remoteModelLabel('')).toBe('')
  })
})

describe('the line under "Connected to <name>" (device test 20.10.2026)', () => {
  it('Wi-Fi: the address; over the internet: "via internet link", never the Wi-Fi or the tunnel address', async () => {
    const { connectedSubline } = await import('../parts/view')
    const home = { address: '192.168.1.20:11435', baseUrl: 'http://192.168.1.20:11435', hostName: 'Studio PC', via: null }
    expect(connectedSubline(home)).toBe('192.168.1.20:11435')
    const away = { ...home, via: 'https://quiet-river-lamp.trycloudflare.com' }
    expect(connectedSubline(away)).toBe(S.home.viaInternet)
    expect(connectedSubline(away)).toBe('via internet link')
    // Without the name of the computer the name already is the address: no second line.
    expect(connectedSubline({ ...away, hostName: '' })).toBeNull()
    expect(connectedSubline(null)).toBeNull()
  })
})

describe('Code mode on the phone (CHATS-V1, staged writes)', () => {
  it('a changed file has a readable name on its approval card', async () => {
    const { stepTitle } = await import('../parts/view')
    expect(stepTitle({ tool: 'file_edit' })).toBe('Edit file')
    expect(stepTitle({ tool: 'file_write' })).toBe('Write file')
  })
})
