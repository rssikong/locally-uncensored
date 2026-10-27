import { afterEach, describe, expect, it } from 'vitest'
import type { StateStorage } from 'zustand/middleware'
import { REMOTE_STORE_KEY, connectionEverWorked, createRemoteClientStore, type RemoteClientStore, type RemoteClientStoreDeps } from '../remoteClientStore'
import { TOKEN_VAULT_KEY, createMemoryTokenVault, createStorageTokenVault } from '../tokenVault'
import { JWT_TTL_SECS, startFakeDesktop, type FakeDesktop } from './fakeDesktop'

/**
 * Speicher, der sich wie IndexedDB verhaelt: jeder Zugriff ist asynchron. Der
 * synchrone Ersatzweg von idbStorage in Node wuerde genau die Reihenfolge
 * verstecken, um die es hier geht (Laden vor Schreiben, Schreiben vor Ende).
 */
function asyncMemoryStorage(initial: Record<string, string> = {}) {
  const data = new Map<string, string>(Object.entries(initial))
  let writes = 0
  const storage: StateStorage = {
    getItem: async (k) => {
      await Promise.resolve()
      return data.get(k) ?? null
    },
    setItem: async (k, v) => {
      await Promise.resolve()
      writes += 1
      data.set(k, v)
    },
    removeItem: async (k) => {
      await Promise.resolve()
      data.delete(k)
    },
  }
  return {
    storage,
    data,
    get writes() {
      return writes
    },
    snapshot: () => Object.fromEntries(data),
    saved: () => JSON.parse(data.get(REMOTE_STORE_KEY) ?? 'null') as { state: Record<string, unknown> } | null,
  }
}

let desktop: FakeDesktop | null = null
const opened: Array<() => void> = []
afterEach(async () => {
  for (const off of opened.splice(0)) off()
  await desktop?.stop()
  desktop = null
})

async function open(deps: RemoteClientStoreDeps): Promise<RemoteClientStore> {
  // Langes Sammelfenster: was in diesen Tests auf der Platte steht, steht dort,
  // weil jemand flush() gerufen hat, nicht weil zufaellig 250 ms um waren.
  const store = createRemoteClientStore({ autoResume: false, persistWaitMs: 60_000, ...deps })
  await store.ready
  return store
}

async function paired(deps: RemoteClientStoreDeps = {}) {
  const mem = asyncMemoryStorage()
  const store = await open({ storage: mem.storage, ...deps })
  await store.useStore.getState().connect(desktop!.url, '123456')
  expect(store.useStore.getState().status).toBe('connected')
  return { store, mem, s: () => store.useStore.getState() }
}

function fakePage() {
  const win = new EventTarget()
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' })
  const ticks: Array<() => void> = []
  const env = {
    window: win as unknown as Window,
    document: doc as unknown as Document,
    setInterval: (fn: () => void) => ticks.push(fn),
    clearInterval: () => {},
  }
  return {
    env,
    ticks,
    pagehide: () => win.dispatchEvent(new Event('pagehide')),
    hide: () => {
      doc.visibilityState = 'hidden'
      doc.dispatchEvent(new Event('visibilitychange'))
    },
    show: () => {
      doc.visibilityState = 'visible'
      doc.dispatchEvent(new Event('visibilitychange'))
    },
  }
}

describe('Verbindung', () => {
  it('koppelt mit Adresse und Code und kennt danach Modelle, Rechte und Version', async () => {
    desktop = await startFakeDesktop({ systemPrompt: 'Be brief.' })
    const { s } = await paired()
    expect(s().connection).toMatchObject({
      baseUrl: desktop.url,
      address: `127.0.0.1:${desktop.port}`,
      route: 'loopback',
      secure: false,
      serverVersion: '3.0.5',
    })
    expect(s().connection?.pairedAt).toBeGreaterThan(0)
    expect(s().models).toEqual(['qwen3:8b', 'gemma4:e4b'])
    expect(s().hostConfig?.systemPrompt).toBe('Be brief.')
    expect(s().permissions).toEqual({ filesystem: false, downloads: false, process_control: false, shell: false })
    expect(s().error).toBeNull()
  })

  it('bleibt ohne Code bei "needs-code" stehen und meldet einen falschen Code lesbar', async () => {
    desktop = await startFakeDesktop()
    const mem = asyncMemoryStorage()
    const store = await open({ storage: mem.storage })
    const s = () => store.useStore.getState()

    await s().connect(`${desktop.url}/mobile`)
    expect(s().status).toBe('needs-code')
    expect(s().error).toBeNull()

    await s().submitCode('000000')
    expect(s().status).toBe('needs-code')
    expect(s().error).toMatchObject({ code: 'invalid-code' })
    expect(s().token).toBe('')

    await s().submitCode('123456')
    expect(s().status).toBe('connected')
    expect(s().error).toBeNull()
  })

  it('sperrt nach drei falschen Codes bis zum genannten Zeitpunkt und ruft den Desktop solange nicht an', async () => {
    desktop = await startFakeDesktop()
    let clock = 1_000_000
    const store = await open({ storage: asyncMemoryStorage().storage, now: () => clock })
    const s = () => store.useStore.getState()
    await s().connect(desktop.url)
    for (let i = 0; i < 3; i++) await s().submitCode('000000')
    await s().submitCode('123456')
    expect(s().error).toMatchObject({ code: 'rate-limited', retryAfterSeconds: 60 })
    expect(s().retryAt).toBe(clock + 60_000)

    const calls = desktop.log.length
    await s().submitCode('123456')
    expect(desktop.log.length).toBe(calls)

    clock += 61_000
    desktop.advance(61)
    await s().submitCode('123456')
    expect(s().status).toBe('connected')
    expect(s().retryAt).toBeNull()
  })

  it('lehnt eine unlesbare Adresse ab, ohne ins Netz zu gehen', async () => {
    const store = await open({ storage: asyncMemoryStorage().storage })
    await store.useStore.getState().connect('123456')
    expect(store.useStore.getState().status).toBe('unpaired')
    expect(store.useStore.getState().error).toMatchObject({ code: 'invalid-address' })
  })

  it('verbindet sich durch einen zugestellten Link nicht von selbst', async () => {
    desktop = await startFakeDesktop()
    const store = await open({ storage: asyncMemoryStorage().storage })
    const s = () => store.useStore.getState()
    expect(s().offerLink(`lu://remote?url=${encodeURIComponent(desktop.url)}&code=123456`)).toBe(true)
    expect(s().pendingLink).toMatchObject({ baseUrl: desktop.url, code: '123456', source: 'deep-link' })
    expect(s().connection).toBeNull()
    expect(desktop.log).toEqual([])

    // Erst die Bestaetigung verbindet, dann aber gleich mit dem Code aus dem Link.
    await s().connect(`lu://remote?url=${encodeURIComponent(desktop.url)}&code=123456`)
    expect(s().status).toBe('connected')
    expect(s().pendingLink).toBeNull()

    expect(s().offerLink('not a link at all')).toBe(false)
  })

  it('meldet einen nicht erreichbaren Desktop als offline und findet ihn nicht fuer verbunden', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    await desktop.stop()
    await s().verifyConnection()
    expect(s().status).toBe('offline')
    expect(s().error).toMatchObject({ code: 'unreachable' })
    expect(s().error?.message).toMatch(/same Wi-Fi/)
    // Das Token bleibt: der Desktop kann gleich wieder da sein.
    expect(s().token).not.toBe('')
  })

  it('A17: nennt den Schritt, an dem die WLAN-Adresse nicht antwortet, und den naechsten Schritt', async () => {
    desktop = await startFakeDesktop()
    const s0 = await open({ storage: asyncMemoryStorage().storage })
    await s0.useStore.getState().connect('http://127.0.0.1:9', '123456')
    expect(s0.useStore.getState().error).toMatchObject({ code: 'unreachable' })
    expect(s0.useStore.getState().error?.detail).toMatch(/^probe: GET \/remote-api\/status/)
    expect(s0.useStore.getState().error?.message).toMatch(/matches the one under Remote Access/)

    // Eine Hamachi-Adresse: der Satz sagt, welche Adresse gemeint ist.
    const s3 = await open({ storage: asyncMemoryStorage().storage, fetch: async () => { throw new TypeError('Failed to fetch') } })
    await s3.useStore.getState().connect('25.10.20.30', '123456')
    expect(s3.useStore.getState().error?.message).toContain('usually 192.168.x.x')

    // Die Kopplung gelingt, die Modelle kommen nicht: Schritt bootstrap, Aufruf /api/tags.
    const failing: RemoteClientStoreDeps['fetch'] = async (url, init) => {
      if (String(url).endsWith('/api/tags')) throw new TypeError('Failed to fetch')
      return globalThis.fetch(url, init)
    }
    const s1 = await open({ storage: asyncMemoryStorage().storage, fetch: failing })
    await s1.useStore.getState().connect(desktop.url, '123456')
    const e1 = s1.useStore.getState().error
    expect(e1?.detail).toMatch(/^bootstrap: GET \/api\/tags/)
    expect(e1?.message).toMatch(/Pairing worked/)

    // Der Code geht nicht durch: Schritt auth.
    const noAuth: RemoteClientStoreDeps['fetch'] = async (url, init) => {
      if (String(url).endsWith('/remote-api/auth')) throw new TypeError('Failed to fetch')
      return globalThis.fetch(url, init)
    }
    const s2 = await open({ storage: asyncMemoryStorage().storage, fetch: noAuth })
    await s2.useStore.getState().connect(desktop.url, '123456')
    expect(s2.useStore.getState().error?.detail).toMatch(/^auth: POST \/remote-api\/auth/)
    expect(s2.useStore.getState().error?.message).toMatch(/pairing window/)
  })

  it('faellt auf "needs-code" zurueck, wenn die Sitzung am Desktop abgelaufen ist', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    desktop.advance(JWT_TTL_SECS + 1)
    await s().verifyConnection()
    expect(s().status).toBe('needs-code')
    expect(s().error).toMatchObject({ code: 'session-expired' })
    expect(s().token).toBe('')
  })

  it('zeigt die Sperre des Desktops als eigenen Zustand', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    desktop.revokeMemory()
    await s().verifyConnection()
    expect(s().status).toBe('blocked')
    expect(s().error).toMatchObject({ code: 'memory-revoked' })
  })

  it('meldet sich beim Trennen am Desktop ab und behaelt Adresse und Chats', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    await s().sendMessage('hi')
    await s().disconnect()
    expect(desktop.devices).toEqual([])
    expect(s().status).toBe('needs-code')
    expect(s().token).toBe('')
    expect(s().connection?.baseUrl).toBe(desktop.url)
    expect(s().chats[0].messages).toHaveLength(2)

    await s().forget()
    expect(s().status).toBe('unpaired')
    expect(s().connection).toBeNull()
    expect(s().chats).toHaveLength(1)
  })

  it('wirft das Token weg, wenn eine andere Adresse eingetragen wird', async () => {
    desktop = await startFakeDesktop()
    const other = await startFakeDesktop({ passcode: '222222' })
    try {
      const { s } = await paired()
      const first = s().token
      await s().connect(other.url)
      expect(s().status).toBe('needs-code')
      expect(s().token).toBe('')
      // Der zweite Desktop hat das Token des ersten nie gesehen.
      expect(other.log).toEqual(['GET /remote-api/status'])
      expect(first).not.toBe('')
    } finally {
      await other.stop()
    }
  })
})

describe('Chat', () => {
  it('sendet, zeigt die Antwort, vergibt einen Titel und spiegelt beide Nachrichten an den Desktop', async () => {
    desktop = await startFakeDesktop({ reply: 'Sure thing.', systemPrompt: 'Be brief.' })
    const { s } = await paired()
    expect(await s().sendMessage('  Tell me about the weather in Hamburg today please  ')).toBe('sent')

    const chat = s().chats[0]
    expect(chat.title).toBe('Tell me about the weather in Ham')
    expect(chat.model).toBe('qwen3:8b')
    expect(chat.messages.map((m) => [m.role, m.content, m.state])).toEqual([
      ['user', 'Tell me about the weather in Hamburg today please', 'done'],
      ['assistant', 'Sure thing.', 'done'],
    ])
    expect(s().streamingChatId).toBeNull()
    expect(desktop.chatRequests[0].body.messages).toEqual([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'Tell me about the weather in Hamburg today please' },
    ])
    await expect.poll(() => desktop!.chatEvents.map((e) => e.role)).toEqual(['user', 'assistant'])
    expect(desktop.chatEvents[1]).toMatchObject({ content: 'Sure thing.', chat_id: chat.id, mode: 'lu' })
  })

  it('nimmt den Entwurf, wenn kein Text uebergeben wird, und leert ihn erst nach dem Senden', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    const id = s().newChat()
    s().setDraft(id, 'from the draft')
    expect(await s().sendMessage()).toBe('sent')
    expect(s().chats[0].messages[0].content).toBe('from the draft')
    expect(s().drafts[id]).toBeUndefined()
    expect(await s().sendMessage()).toBe('empty')
  })

  it('sendet nicht ohne Verbindung und nicht doppelt', async () => {
    desktop = await startFakeDesktop({ delayMs: 80 })
    const store = await open({ storage: asyncMemoryStorage().storage })
    expect(await store.useStore.getState().sendMessage('hi')).toBe('not-connected')

    const { s } = await paired()
    const first = s().sendMessage('one')
    expect(await s().sendMessage('two')).toBe('busy')
    await first
    expect(s().chats[0].messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('haelt beim Stoppen den Teilstand als "stopped" fest', async () => {
    desktop = await startFakeDesktop({ reply: 'a b c d e f g h i j k l', delivery: 'chunked', delayMs: 15 })
    const { s } = await paired()
    const sending = s().sendMessage('go')
    await expect.poll(() => s().chats[0]?.messages[1]?.content.length ?? 0).toBeGreaterThan(3)
    s().stopStreaming()
    expect(s().streamingChatId).toBeNull()
    await sending
    const reply = s().chats[0].messages[1]
    expect(reply.state).toBe('stopped')
    expect(reply.content.length).toBeGreaterThan(3)
    expect(reply.content.length).toBeLessThan(23)
  })

  it('markiert die Antwort als gescheitert, wenn das Token beim Senden abgelaufen ist, und holt sie nach dem Koppeln nach', async () => {
    desktop = await startFakeDesktop({ reply: 'Back again.' })
    const { s } = await paired()
    desktop.advance(JWT_TTL_SECS + 1)
    await s().sendMessage('are you there')
    expect(s().status).toBe('needs-code')
    expect(s().chats[0].messages[1]).toMatchObject({ state: 'failed', content: '', error: { code: 'session-expired' } })
    expect(await s().retryLast()).toBe('not-connected')

    // Nach einer Stunde zeigt der Desktop laengst einen neuen Code.
    await s().submitCode(desktop.shownPasscode())
    expect(s().status).toBe('connected')
    expect(await s().retryLast()).toBe('sent')
    expect(s().chats[0].messages.map((m) => [m.role, m.content, m.state])).toEqual([
      ['user', 'are you there', 'done'],
      ['assistant', 'Back again.', 'done'],
    ])
    // Die Nachricht des Nutzers wurde nur einmal an den Desktop gespiegelt.
    await expect.poll(() => desktop!.chatEvents.filter((e) => e.role === 'user')).toHaveLength(1)
  })

  it('meldet einen verschwundenen Desktop am Chat und im Verbindungszustand', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    await desktop.stop()
    await s().sendMessage('hello?')
    expect(s().status).toBe('offline')
    expect(s().chats[0].messages[1]).toMatchObject({ state: 'failed', error: { code: 'unreachable' } })
    expect(s().streamingChatId).toBeNull()
  })

  it('behaelt bei einem Abriss mitten in der Antwort, was schon da war', async () => {
    desktop = await startFakeDesktop({ reply: 'one two three four five', delivery: 'chunked', delayMs: 5 })
    desktop.killStreamAfterLines = 2
    const { s } = await paired()
    await s().sendMessage('count')
    expect(s().chats[0].messages[1]).toMatchObject({
      state: 'interrupted',
      content: 'one two ',
      error: { code: 'connection-lost' },
    })
    // Der Desktop ist noch da: die angestossene Pruefung laesst die Verbindung stehen.
    await expect.poll(() => s().status).toBe('connected')
    expect(await s().retryLast()).toBe('sent')
    expect(s().chats[0].messages[1]).toMatchObject({ state: 'done', content: 'one two three four five' })
    // Die unvollstaendige Antwort wurde ersetzt, nicht als Verlauf mitgeschickt.
    expect(desktop.chatRequests.at(-1)?.body.messages).toEqual([{ role: 'user', content: 'count' }])
  })

  it('laesst einen Backend-Fehler am Chat stehen, ohne die Verbindung zu verwerfen', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    desktop.backendDown = true
    await s().sendMessage('hi')
    expect(s().status).toBe('connected')
    expect(s().chats[0].messages[1]).toMatchObject({ state: 'failed', error: { code: 'backend', status: 502 } })
  })

  it('schickt den eigenen Systemprompt eines Chats statt dem des Desktops', async () => {
    desktop = await startFakeDesktop({ systemPrompt: 'From the desktop.' })
    const { s } = await paired()
    const id = s().newChat()
    s().setSystemPrompt(id, 'You are a pirate.')
    s().setThinkEnabled(id, true)
    await s().sendMessage('ahoy')
    expect(desktop.chatRequests[0].body).toMatchObject({
      think: true,
      messages: [
        { role: 'system', content: 'You are a pirate.' },
        { role: 'user', content: 'ahoy' },
      ],
    })
  })
})

describe('Neu erzeugen und Bearbeiten', () => {
  it('verwirft eine Antwort samt allem danach und stellt die Frage davor erneut, ohne sie doppelt zu spiegeln', async () => {
    desktop = await startFakeDesktop({ reply: 'First answer.' })
    const { s } = await paired()
    await s().sendMessage('one')
    await s().sendMessage('two')
    const chat = s().chats[0]
    expect(chat.messages).toHaveLength(4)
    await expect.poll(() => desktop!.chatEvents.filter((e) => e.role === 'user')).toHaveLength(2)
    desktop.reply = 'Second try.'
    expect(await s().regenerate(chat.id, chat.messages[1].id)).toBe('sent')
    expect(s().chats[0].messages.map((m) => [m.role, m.content, m.state])).toEqual([
      ['user', 'one', 'done'],
      ['assistant', 'Second try.', 'done'],
    ])
    // Der Desktop bekam nur die Frage, nicht die verworfene Antwort.
    expect(desktop.chatRequests.at(-1)?.body.messages).toEqual([{ role: 'user', content: 'one' }])
    // Die Frage stand schon im Desktop-Chat.
    await expect.poll(() => desktop!.chatEvents.filter((e) => e.role === 'assistant').at(-1)?.content).toBe('Second try.')
    expect(desktop.chatEvents.filter((e) => e.role === 'user')).toHaveLength(2)
  })

  it('aendert eine eigene Nachricht, verwirft alles danach und spiegelt die neue Frage', async () => {
    desktop = await startFakeDesktop({ reply: 'Answer.' })
    const { s } = await paired()
    await s().sendMessage('helo')
    await s().sendMessage('more')
    const chat = s().chats[0]
    await expect.poll(() => desktop!.chatEvents.filter((e) => e.role === 'user')).toHaveLength(2)
    expect(await s().editAndResend(chat.id, chat.messages[0].id, '  hello  ')).toBe('sent')
    expect(s().chats[0].messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'hello'],
      ['assistant', 'Answer.'],
    ])
    expect(s().chats[0].messages[0].id).toBe(chat.messages[0].id)
    expect(desktop.chatRequests.at(-1)?.body.messages).toEqual([{ role: 'user', content: 'hello' }])
    await expect.poll(() => desktop!.chatEvents.filter((e) => e.role === 'user').map((e) => e.content)).toEqual(['helo', 'more', 'hello'])
  })

  it('laesst den Verlauf stehen, wenn es nicht geht: falsche Nachricht, leerer Text, laufende Antwort, getrennt', async () => {
    desktop = await startFakeDesktop({ reply: 'Answer.' })
    const { s } = await paired()
    await s().sendMessage('one')
    const chat = s().chats[0]
    const [asked, answer] = chat.messages
    expect(await s().regenerate(chat.id, asked.id)).toBe('empty')
    expect(await s().editAndResend(chat.id, answer.id, 'x')).toBe('empty')
    expect(await s().editAndResend(chat.id, asked.id, '   ')).toBe('empty')
    expect(await s().regenerate(chat.id, 'nope')).toBe('empty')
    expect(await s().regenerate('nope', answer.id)).toBe('no-chat')
    expect(s().chats[0].messages).toEqual(chat.messages)

    desktop.delayMs = 300
    const sending = s().sendMessage('two')
    await expect.poll(() => s().streamingChatId).toBe(chat.id)
    expect(await s().regenerate(chat.id, answer.id)).toBe('busy')
    expect(await s().editAndResend(chat.id, asked.id, 'changed')).toBe('busy')
    await sending
    expect(s().chats[0].messages).toHaveLength(4)

    await desktop.stop()
    await s().verifyConnection()
    expect(await s().regenerate(chat.id, answer.id)).toBe('not-connected')
    expect(s().chats[0].messages).toHaveLength(4)
  })
})

describe('Persistenz', () => {
  it('uebersteht einen Neustart: Adresse, Chats, aktiver Chat und Entwurf sind wieder da, die Sitzung auch', async () => {
    desktop = await startFakeDesktop({ reply: 'Stored answer.' })
    const mem = asyncMemoryStorage()
    const first = await open({ storage: mem.storage })
    const a = () => first.useStore.getState()
    await a().connect(desktop.url, '123456')
    await a().sendMessage('remember me')
    const chatId = a().activeChatId
    a().setDraft(chatId, 'half a thought')
    await first.flush()

    const second = createRemoteClientStore({ storage: mem.storage, persistWaitMs: 60_000 })
    expect(second.useStore.getState().hydrated).toBe(false)
    await second.ready
    const b = () => second.useStore.getState()
    expect(b().hydrated).toBe(true)
    expect(b().connection?.baseUrl).toBe(desktop.url)
    expect(b().activeChatId).toBe(chatId)
    expect(b().drafts[chatId]).toBe('half a thought')
    expect(b().chats[0].messages.map((m) => m.content)).toEqual(['remember me', 'Stored answer.'])
    // autoResume: mit dem Token aus der Ablage geht es ohne neuen Code weiter.
    await expect.poll(() => b().status).toBe('connected')
    expect(b().models).toEqual(['qwen3:8b', 'gemma4:e4b'])
  })

  // Gegenpruefung iPhone, Runde 22, N10: ein Verbindungsversuch, der in "took too long to answer" endete,
  // stand danach als Desktop in den Einstellungen.
  describe('gemerkt wird nur ein Desktop, der je funktioniert hat', () => {
    it('die Regel: einmal gekoppelt oder einmal mit Sitzung erreicht', () => {
      expect(connectionEverWorked(null)).toBe(false)
      expect(connectionEverWorked(undefined)).toBe(false)
      expect(connectionEverWorked({ pairedAt: null, lastOkAt: null })).toBe(false)
      expect(connectionEverWorked({ pairedAt: 0, lastOkAt: 0 })).toBe(false)
      expect(connectionEverWorked({ pairedAt: Number.NaN, lastOkAt: null })).toBe(false)
      expect(connectionEverWorked({ pairedAt: 1_700_000_000_000, lastOkAt: null })).toBe(true)
      expect(connectionEverWorked({ pairedAt: null, lastOkAt: 1_700_000_000_000 })).toBe(true)
    })

    it('ein gescheiterter Versuch bleibt fuer die laufende Seite im Speicher und kommt nie auf die Platte', async () => {
      const mem = asyncMemoryStorage()
      const store = await open({ storage: mem.storage })
      const s = () => store.useStore.getState()
      // An dieser Adresse hoert niemand.
      await s().connect('http://127.0.0.1:9', '123456')
      expect(s().status).toBe('offline')
      // Die Seite des Versuchs braucht Adresse und Fehler weiter ("Try again", die Liste der Gruende).
      expect(s().connection?.baseUrl).toBe('http://127.0.0.1:9')
      expect(s().error).not.toBeNull()
      await store.flush()
      expect(mem.saved()?.state.connection ?? null).toBeNull()

      // Nach dem Neustart gibt es keinen Desktop.
      const second = createRemoteClientStore({ storage: mem.storage, persistWaitMs: 60_000, autoResume: false })
      await second.ready
      expect(second.useStore.getState().connection).toBeNull()
      expect(second.useStore.getState().status).toBe('unpaired')
    })

    it('ein Desktop, der antwortet und auf den Code wartet, ist noch nicht gemerkt; mit dem Code ist er es', async () => {
      desktop = await startFakeDesktop()
      const mem = asyncMemoryStorage()
      const store = await open({ storage: mem.storage })
      const s = () => store.useStore.getState()
      await s().connect(desktop.url)
      expect(s().status).toBe('needs-code')
      await store.flush()
      expect(mem.saved()?.state.connection ?? null).toBeNull()

      await s().submitCode('123456')
      expect(s().status).toBe('connected')
      await store.flush()
      expect((mem.saved()!.state.connection as { baseUrl: string }).baseUrl).toBe(desktop.url)
    })

    it('ein falscher Code merkt nichts', async () => {
      desktop = await startFakeDesktop()
      const mem = asyncMemoryStorage()
      const store = await open({ storage: mem.storage })
      await store.useStore.getState().connect(desktop.url, '000000')
      expect(store.useStore.getState().status).toBe('needs-code')
      await store.flush()
      expect(mem.saved()?.state.connection ?? null).toBeNull()
    })

    it('ein Fehleintrag einer aelteren Version wird beim Start nicht geladen, ein echter Desktop schon', async () => {
      const wrong = { baseUrl: 'http://192.168.178.20:11435', address: '192.168.178.20:11435', route: 'lan', secure: false, pairedAt: null, lastOkAt: null, serverVersion: '', hostName: '' }
      const memWrong = asyncMemoryStorage({ [REMOTE_STORE_KEY]: JSON.stringify({ state: { connection: wrong, chats: [], activeChatId: '', drafts: {} }, version: 1 }) })
      const first = createRemoteClientStore({ storage: memWrong.storage, persistWaitMs: 60_000, autoResume: false })
      await first.ready
      expect(first.useStore.getState().connection).toBeNull()
      expect(first.useStore.getState().status).toBe('unpaired')

      const real = { ...wrong, pairedAt: 1_700_000_000_000, lastOkAt: 1_700_000_100_000 }
      const memReal = asyncMemoryStorage({ [REMOTE_STORE_KEY]: JSON.stringify({ state: { connection: real, chats: [], activeChatId: '', drafts: {} }, version: 1 }) })
      const second = createRemoteClientStore({ storage: memReal.storage, persistWaitMs: 60_000, autoResume: false })
      await second.ready
      expect(second.useStore.getState().connection?.address).toBe('192.168.178.20:11435')
      // Ohne Token in der Ablage fragt er nach dem Code, statt den Desktop zu vergessen.
      expect(second.useStore.getState().status).toBe('needs-code')
    })

    it('ein gekoppelter Desktop, der gerade nicht antwortet, bleibt gemerkt', async () => {
      desktop = await startFakeDesktop()
      const { store, mem, s } = await paired()
      await desktop.stop()
      desktop = null
      await s().verifyConnection()
      expect(s().status).toBe('offline')
      await store.flush()
      expect(mem.saved()!.state.connection).not.toBeNull()
    })
  })

  it('schreibt das Token nie in den Zustand, sondern getrennt in die Ablage', async () => {
    desktop = await startFakeDesktop()
    const { store, mem, s } = await paired()
    await s().sendMessage('hi')
    await store.flush()
    const token = s().token
    expect(token.length).toBeGreaterThan(10)

    const blob = mem.data.get(REMOTE_STORE_KEY) ?? ''
    expect(blob).toContain('"chats"')
    expect(blob).not.toContain(token)
    expect(Object.keys(mem.saved()!.state).sort()).toEqual(['activeChatId', 'chats', 'connection', 'drafts'])
    expect(JSON.parse(mem.data.get(TOKEN_VAULT_KEY) ?? '{}')).toMatchObject({ baseUrl: desktop.url, token })
  })

  it('kann mit einer anderen Ablage arbeiten, ohne dass der Store es merkt', async () => {
    desktop = await startFakeDesktop()
    const mem = asyncMemoryStorage()
    const vault = createMemoryTokenVault()
    const first = await open({ storage: mem.storage, vault })
    await first.useStore.getState().connect(desktop.url, '123456')
    await first.flush()
    expect(mem.data.has(TOKEN_VAULT_KEY)).toBe(false)
    expect(await vault.load(desktop.url)).toBe(first.useStore.getState().token)
    expect(await vault.load('http://192.168.1.99:11435')).toBeNull()

    const second = await open({ storage: mem.storage, vault })
    expect(second.useStore.getState().token).toBe(first.useStore.getState().token)
  })

  it('gibt ein Token nur fuer die Adresse heraus, fuer die es gespeichert wurde', async () => {
    const mem = asyncMemoryStorage()
    const vault = createStorageTokenVault(mem.storage)
    await vault.save('http://192.168.1.20:11435', 'secret-token')
    expect(await vault.load('http://192.168.1.20:11435')).toBe('secret-token')
    expect(await vault.load('http://192.168.1.21:11435')).toBeNull()
    await vault.clear()
    expect(await vault.load('http://192.168.1.20:11435')).toBeNull()
    mem.data.set(TOKEN_VAULT_KEY, 'not json')
    expect(await vault.load('http://192.168.1.20:11435')).toBeNull()
  })

  it('ueberschreibt gespeicherte Chats nicht mit dem leeren Anfangszustand, wenn vor dem Laden etwas passiert', async () => {
    desktop = await startFakeDesktop()
    const mem = asyncMemoryStorage()
    const first = await open({ storage: mem.storage })
    await first.useStore.getState().connect(desktop.url, '123456')
    await first.useStore.getState().sendMessage('keep me')
    await first.flush()
    const before = mem.data.get(REMOTE_STORE_KEY)

    const second = createRemoteClientStore({ storage: mem.storage, autoResume: false, persistWaitMs: 0 })
    // Noch nicht geladen: diese Aenderung trifft den leeren Anfangszustand.
    second.useStore.getState().setDraft('', 'typed too early')
    await second.flush()
    expect(mem.data.get(REMOTE_STORE_KEY)).toBe(before)
    await second.ready
    expect(second.useStore.getState().chats[0].messages[0].content).toBe('keep me')
  })

  it('schreibt bei pagehide und beim Verstecken sofort, ohne das Sammelfenster abzuwarten', async () => {
    desktop = await startFakeDesktop()
    const { store, mem, s } = await paired()
    const page = fakePage()
    opened.push(store.attachLifecycle(page.env))
    await store.flush()

    s().setDraft('', 'draft before pagehide')
    expect(mem.saved()?.state.drafts).toEqual({})
    page.pagehide()
    await expect.poll(() => mem.saved()?.state.drafts).toEqual({ '': 'draft before pagehide' })

    s().setDraft('', 'draft before hiding')
    page.hide()
    await expect.poll(() => mem.saved()?.state.drafts).toEqual({ '': 'draft before hiding' })
  })

  it('nimmt nach dem Abmelden der Ereignisse nichts mehr an', async () => {
    desktop = await startFakeDesktop()
    const { store, mem, s } = await paired()
    const page = fakePage()
    const off = store.attachLifecycle(page.env)
    await store.flush()
    off()
    s().setDraft('', 'nobody flushes this')
    page.pagehide()
    await new Promise((r) => setTimeout(r, 20))
    expect(mem.saved()?.state.drafts).toEqual({})
  })
})

describe('App im Hintergrund', () => {
  it('beendet den laufenden Chat sauber, speichert den Teilstand und prueft bei der Rueckkehr die Verbindung', async () => {
    desktop = await startFakeDesktop({ reply: 'a b c d e f g h i j k l m n', delivery: 'chunked', delayMs: 15 })
    const { store, mem, s } = await paired()
    const page = fakePage()
    opened.push(store.attachLifecycle(page.env))

    const sending = s().sendMessage('long answer please')
    await expect.poll(() => s().chats[0]?.messages[1]?.content.length ?? 0).toBeGreaterThan(3)

    page.hide()
    // Sofort, im selben Atemzug: danach darf das System die App einfrieren.
    expect(s().streamingChatId).toBeNull()
    const partial = s().chats[0].messages[1]
    expect(partial.state).toBe('interrupted')
    expect(partial.content.length).toBeGreaterThan(3)

    await expect.poll(() => {
      const chats = mem.saved()?.state.chats as Array<{ messages: Array<{ state: string; content: string }> }> | undefined
      return chats?.[0]?.messages[1]
    }).toMatchObject({ state: 'interrupted', content: partial.content })
    await expect.poll(() => desktop!.chatRequests[0].clientGone).toBe(true)

    await sending
    // Der abgewickelte Lauf hat den gespeicherten Teilstand nicht mehr angefasst.
    expect(s().chats[0].messages[1]).toEqual(partial)

    const before = desktop.log.filter((l) => l === 'GET /remote-api/status').length
    page.show()
    await expect.poll(() => desktop!.log.filter((l) => l === 'GET /remote-api/status').length).toBe(before + 1)
    await expect.poll(() => s().status).toBe('connected')

    desktop.delivery = 'buffered'
    desktop.delayMs = 0
    expect(await s().retryLast()).toBe('sent')
    expect(s().chats[0].messages.map((m) => [m.role, m.state])).toEqual([
      ['user', 'done'],
      ['assistant', 'done'],
    ])
    expect(s().chats[0].messages[1].content).toBe('a b c d e f g h i j k l m n')
  })

  it('bricht auch ab, wenn der Desktop noch sammelt, und laesst eine leere, wiederholbare Antwort zurueck', async () => {
    desktop = await startFakeDesktop({ delayMs: 2_000 })
    const { s } = await paired()
    const sending = s().sendMessage('hi')
    await expect.poll(() => desktop!.chatRequests.length).toBe(1)
    await s().handleBackground()
    expect(s().chats[0].messages[1]).toMatchObject({ state: 'interrupted', content: '' })
    await sending
    await expect.poll(() => desktop!.chatRequests[0].clientGone).toBe(true)
  })

  it('findet nach einem Abschuss durch das System keine ewig laufende Antwort vor', async () => {
    desktop = await startFakeDesktop({ reply: 'a b c d e f g h', delivery: 'chunked', delayMs: 20 })
    const { store, mem, s } = await paired()
    const sending = s().sendMessage('go')
    await expect.poll(() => s().chats[0]?.messages[1]?.content.length ?? 0).toBeGreaterThan(1)
    // Der Zwischenstand landet auf der Platte, dann ist der Prozess weg.
    await store.flush()
    const disk = mem.snapshot()
    const onDisk = JSON.parse(disk[REMOTE_STORE_KEY]) as { state: { chats: Array<{ messages: Array<{ state: string }> }> } }
    expect(onDisk.state.chats[0].messages[1].state).toBe('pending')

    const reborn = await open({ storage: asyncMemoryStorage(disk).storage })
    const reply = reborn.useStore.getState().chats[0].messages[1]
    expect(reply.state).toBe('interrupted')
    expect(reply.content.length).toBeGreaterThan(1)
    expect(reborn.useStore.getState().streamingChatId).toBeNull()

    s().stopStreaming()
    await sending
  })

  it('prueft bei der Rueckkehr und merkt, wenn die Sitzung inzwischen abgelaufen ist', async () => {
    desktop = await startFakeDesktop()
    const { store, s } = await paired()
    const page = fakePage()
    opened.push(store.attachLifecycle(page.env))
    page.hide()
    desktop.advance(JWT_TTL_SECS + 1)
    page.show()
    await expect.poll(() => s().status).toBe('needs-code')
    expect(s().error).toMatchObject({ code: 'session-expired' })
  })

  it('haelt die Sitzung mit dem Lebenszeichen am Leben und legt das neue Token in die Ablage', async () => {
    desktop = await startFakeDesktop()
    const vault = createMemoryTokenVault()
    const { store, s } = await paired({ vault })
    const page = fakePage()
    opened.push(store.attachLifecycle(page.env))
    const first = s().token

    for (let i = 0; i < 9; i++) {
      desktop.advance(10 * 60)
      page.ticks[0]()
      await expect.poll(() => desktop!.log.filter((l) => l === 'GET /remote-api/status/full').length).toBe(i + 2)
    }
    // 90 Minuten spaeter, weit hinter der Lebensdauer des ersten Tokens.
    await s().verifyConnection()
    expect(s().status).toBe('connected')
    expect(s().token).not.toBe(first)
    await expect.poll(() => vault.load(desktop!.url)).toBe(s().token)
  })

  it('schickt kein Lebenszeichen, solange die App nicht sichtbar ist', async () => {
    desktop = await startFakeDesktop()
    const { store } = await paired()
    const page = fakePage()
    opened.push(store.attachLifecycle(page.env))
    page.hide()
    const calls = desktop.log.length
    page.ticks[0]()
    await new Promise((r) => setTimeout(r, 20))
    expect(desktop.log.length).toBe(calls)
  })
})

describe('Runde 2: Agentenmodus', () => {
  it('laesst das Modell ein Werkzeug am Desktop benutzen und haelt den Schritt an der Antwort fest', async () => {
    desktop = await startFakeDesktop({ reply: 'The note says: file body.', systemPrompt: 'Be brief.' })
    const { s } = await paired()
    // Der Schalter wird NACH dem Koppeln eingeschaltet: der Lauf fragt den Stand frisch ab.
    desktop.permissions.filesystem = true
    const chatId = s().newChat()
    s().setAgentMode(chatId, true)
    desktop.nextToolCalls = [{ function: { name: 'file_read', arguments: { path: 'note.txt' } } }]
    expect(await s().sendMessage('Read note.txt')).toBe('sent')

    const answer = s().chats[0].messages[1]
    expect(answer).toMatchObject({ role: 'assistant', state: 'done', content: 'The note says: file body.' })
    expect(answer.steps).toHaveLength(1)
    expect(answer.steps![0]).toMatchObject({ tool: 'file_read', state: 'done' })
    expect(s().permissions?.filesystem).toBe(true)
    expect(desktop.toolCalls[0]).toMatchObject({ tool: 'file_read', chatId })

    const first = desktop.chatRequests[0].body
    const names = (first.tools as Array<{ function: { name: string } }>).map((t) => t.function.name)
    expect(names).toContain('file_read')
    expect(names).not.toContain('shell_execute')
    const system = (first.messages as Array<{ role: string; content: string }>)[0]
    expect(system.role).toBe('system')
    expect(system.content).toContain('autonomous AI agent')
    // Im Agentenmodus faehrt der Prompt des Desktops nicht mit, wie auf der Webseite.
    expect(system.content).not.toContain('Be brief.')
    await expect.poll(() => desktop!.chatEvents.map((e) => e.role)).toEqual(['user', 'assistant'])
  })

  it('sagt lesbar, wenn das Modell keine Werkzeuge kann, und laesst die Verbindung stehen', async () => {
    desktop = await startFakeDesktop({ models: ['notools:1b'] })
    const { s } = await paired()
    const chatId = s().newChat()
    s().setAgentMode(chatId, true)
    expect(await s().sendMessage('Hi')).toBe('sent')
    const answer = s().chats[0].messages[1]
    expect(answer.state).toBe('failed')
    expect(answer.error?.code).toBe('tools-unsupported')
    expect(answer.error?.message).toContain('Agent mode')
    expect(s().status).toBe('connected')
  })

  it('schickt ohne Agentenmodus keine Werkzeuge mit', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    await s().sendMessage('Hi')
    expect(desktop.chatRequests[0].body.tools).toBeUndefined()
    expect(s().chats[0].messages[1].steps).toBeUndefined()
  })

  it('setzt die Sprechweise in den Systemprompt und vor jede Nutzernachricht', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    const chatId = s().newChat()
    s().setCaveman(chatId, 'full')
    await s().sendMessage('Explain DNS')
    const sent = desktop.chatRequests[0].body.messages as Array<{ role: string; content: string }>
    expect(sent[0].role).toBe('system')
    expect(sent[1].content.endsWith('\nExplain DNS')).toBe(true)
    expect(sent[1].content.length).toBeGreaterThan('Explain DNS'.length + 5)
    // Im Verlauf am Handy steht, was der Mensch getippt hat.
    expect(s().chats[0].messages[0].content).toBe('Explain DNS')
    s().setCaveman(chatId, 'nonsense' as never)
    expect(s().chats[0].caveman).toBe('off')
  })
})

describe('Runde 2: Bilder', () => {
  const photo = { mimeType: 'image/jpeg', thumb: 'dGh1bWI=', data: 'ZnVsbGltYWdl', name: 'cat.jpg' }

  it('schickt die Bilddaten an das Modell und speichert nur das Vorschaubild', async () => {
    desktop = await startFakeDesktop({ reply: 'A cat.' })
    const { s, store, mem } = await paired()
    expect(await s().sendMessage('What is this?', { images: [photo] })).toBe('sent')
    const sent = desktop.chatRequests[0].body.messages as Array<{ role: string; content: string; images?: string[] }>
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'What is this?', images: ['ZnVsbGltYWdl'] })
    expect(s().chats[0].messages[0].images).toEqual([{ mimeType: 'image/jpeg', thumb: 'dGh1bWI=', name: 'cat.jpg' }])
    await store.flush()
    const raw = mem.data.get(REMOTE_STORE_KEY) ?? ''
    expect(raw).toContain('dGh1bWI=')
    expect(raw).not.toContain('ZnVsbGltYWdl')
  })

  it('sendet ein Bild auch ohne Text und nennt den Chat dann "Photo"', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    expect(await s().sendMessage('', { images: [photo] })).toBe('sent')
    expect(s().chats[0].title).toBe('Photo')
    expect(await s().sendMessage('   ')).toBe('empty')
  })

  it('nimmt hoechstens vier Bilder und keins ohne Daten', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    const many = Array.from({ length: 6 }, (_, i) => ({ ...photo, data: `ZGF0YQ${i}` }))
    await s().sendMessage('Look', { images: [{ ...photo, data: '' }, ...many] })
    expect(s().chats[0].messages[0].images).toHaveLength(4)
    const sent = desktop.chatRequests[0].body.messages as Array<{ images?: string[] }>
    expect(sent.at(-1)?.images).toHaveLength(4)
  })

  it('wiederholt nach einem Neustart keine Frage, deren Bilder nicht mehr da sind', async () => {
    desktop = await startFakeDesktop({ reply: 'A cat.' })
    const mem = asyncMemoryStorage()
    const first = await open({ storage: mem.storage })
    await first.useStore.getState().connect(desktop.url, '123456')
    desktop.backendDown = true
    await first.useStore.getState().sendMessage('What is this?', { images: [photo] })
    expect(first.useStore.getState().chats[0].messages[1].state).toBe('failed')
    await first.flush()
    desktop.backendDown = false

    const second = createRemoteClientStore({ storage: mem.storage, persistWaitMs: 60_000 })
    await second.ready
    const b = () => second.useStore.getState()
    await expect.poll(() => b().status).toBe('connected')
    const before = desktop.chatRequests.length
    expect(await b().retryLast()).toBe('images-lost')
    expect(desktop.chatRequests.length).toBe(before)
    // Die gescheiterte Antwort bleibt stehen, nichts wurde weggeworfen.
    expect(b().chats[0].messages).toHaveLength(2)
    expect(b().chats[0].messages[0].images?.[0].thumb).toBe('dGh1bWI=')
  })

  it('wirft ein uebergrosses oder unlesbares Vorschaubild weg, ohne die Nachricht zu verlieren', async () => {
    desktop = await startFakeDesktop()
    const { s } = await paired()
    await s().sendMessage('Look', { images: [{ mimeType: 'text/html', thumb: '<script>', data: 'ZGF0YQ==' }] })
    expect(s().chats[0].messages[0].images).toEqual([{ mimeType: 'image/jpeg', thumb: '' }])
  })
})

describe('Runde 2: Chats gehoeren einem Desktop', () => {
  it('ordnet einen neuen Chat dem verbundenen Desktop zu und merkt sich dessen Namen', async () => {
    desktop = await startFakeDesktop({ hostname: 'Studio Mac' })
    const { s } = await paired()
    expect(s().connection?.hostName).toBe('Studio Mac')
    await s().sendMessage('Hi')
    expect(s().chats[0].baseUrl).toBe(desktop.url)
  })

  it('setzt einen Chat eines anderen Desktops nicht fort und aendert ihn nicht', async () => {
    desktop = await startFakeDesktop({ reply: 'From the first.' })
    const { s } = await paired()
    await s().sendMessage('Hi first')
    const oldId = s().chats[0].id
    const other = await startFakeDesktop({ models: ['other:1b'], reply: 'From the second.' })
    try {
      await s().connect(other.url, '123456')
      expect(s().status).toBe('connected')
      s().selectChat(oldId)
      expect(await s().sendMessage('Hi again')).toBe('other-desktop')
      expect(await s().retryLast(oldId)).toBe('other-desktop')
      const old = s().chats.find((c) => c.id === oldId)!
      expect(old.messages).toHaveLength(2)
      // Das Modell des alten Chats wird nicht auf eins des neuen Desktops umgeschrieben.
      expect(old.model).toBe('qwen3:8b')
      expect(other.chatRequests).toHaveLength(0)

      const fresh = s().newChat()
      expect(await s().sendMessage('Hi second')).toBe('sent')
      expect(s().chats.find((c) => c.id === fresh)).toMatchObject({ baseUrl: other.url, model: 'other:1b' })
    } finally {
      await other.stop()
    }
  })

  it('ordnet Chats aus einem Stand ohne diese Angabe dem gespeicherten Desktop zu', async () => {
    desktop = await startFakeDesktop()
    const legacy = {
      state: {
        connection: { baseUrl: desktop.url, address: `127.0.0.1:${desktop.port}`, route: 'loopback', secure: false, pairedAt: 1, lastOkAt: 1, serverVersion: '3.0.5' },
        chats: [
          {
            id: 'c-old',
            title: 'Old',
            model: 'qwen3:8b',
            thinkEnabled: false,
            systemPrompt: null,
            createdAt: 1,
            updatedAt: 1,
            messages: [{ id: 'm1', role: 'user', content: 'Hi', thinking: '', createdAt: 1, state: 'done' }],
          },
        ],
        activeChatId: 'c-old',
        drafts: {},
      },
      version: 1,
    }
    const mem = asyncMemoryStorage({ [REMOTE_STORE_KEY]: JSON.stringify(legacy) })
    const store = await open({ storage: mem.storage })
    const chat = store.useStore.getState().chats[0]
    expect(chat).toMatchObject({ baseUrl: desktop.url, agentMode: false, caveman: 'off' })
    expect(store.useStore.getState().connection?.hostName).toBe('')
  })

  it('macht aus einem Werkzeugschritt, der beim Beenden noch lief, einen gescheiterten', async () => {
    desktop = await startFakeDesktop()
    const saved = {
      state: {
        connection: null,
        chats: [
          {
            id: 'c1',
            title: 'T',
            model: 'm',
            thinkEnabled: false,
            systemPrompt: null,
            agentMode: true,
            caveman: 'lite',
            baseUrl: 'http://10.0.0.5:11435',
            createdAt: 1,
            updatedAt: 1,
            messages: [
              { id: 'm1', role: 'user', content: 'Go', thinking: '', createdAt: 1, state: 'done' },
              {
                id: 'm2',
                role: 'assistant',
                content: '',
                thinking: '',
                createdAt: 2,
                state: 'pending',
                steps: [
                  { id: 's1', tool: 'file_read', args: '{}', state: 'running', result: '' },
                  { tool: 7 },
                  // A17: what image_generate made stays as a reference to the phone gallery; nothing else is taken.
                  {
                    id: 's2',
                    tool: 'image_generate',
                    args: '{}',
                    state: 'done',
                    result: 'ok',
                    media: [{ id: `pc_res_${'c'.repeat(32)}`, kind: 'image', mime: 'image/png' }, { id: 'https://evil.example/x.png', kind: 'image' }, { id: 'pc_x', kind: 'audio' }],
                  },
                ],
              },
            ],
          },
        ],
        activeChatId: 'c1',
        drafts: {},
      },
      version: 1,
    }
    const mem = asyncMemoryStorage({ [REMOTE_STORE_KEY]: JSON.stringify(saved) })
    const store = await open({ storage: mem.storage })
    const chat = store.useStore.getState().chats[0]
    expect(chat).toMatchObject({ agentMode: true, caveman: 'lite', baseUrl: 'http://10.0.0.5:11435' })
    expect(chat.messages[1].state).toBe('interrupted')
    expect(chat.messages[1].steps).toEqual([
      { id: 's1', tool: 'file_read', args: '{}', state: 'failed', result: '' },
      { id: 's2', tool: 'image_generate', args: '{}', state: 'done', result: 'ok', media: [{ id: `pc_res_${'c'.repeat(32)}`, kind: 'image', mime: 'image/png' }] },
    ])
  })
})
