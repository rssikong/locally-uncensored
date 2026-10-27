/**
 * Ein Handy, gekoppelt ueber den QR-Code mit einem Desktop mit geteilten
 * Chats (A17). Fuer die Tests der geteilten Chats und ihres Stores.
 */
import type { StateStorage } from 'zustand/middleware'
import { createRemoteClientStore, type DesktopChannel, type RemoteClientStore } from '../remoteClientStore'
import type { RemoteFetch } from '../remoteClient'
import { createMemoryTokenVault } from '../tokenVault'
import { startFakeDesktop, type FakeDesktop } from './fakeDesktop'
import { createFakeSealedPhone, type FakeSealedPhone } from './fakeSealed'

export const NET = 'https://quiet-river-lamp.trycloudflare.com'

function memoryStorage(): StateStorage {
  const data = new Map<string, string>()
  return { getItem: async (k) => data.get(k) ?? null, setItem: async (k, v) => void data.set(k, v), removeItem: async (k) => void data.delete(k) }
}

export interface ChatsRig {
  store: RemoteClientStore
  phone: FakeSealedPhone
  desk: FakeDesktop
  plain: string[]
  channel: () => DesktopChannel
  /** Der Desktop ist weg (Netz aus), bis `up()`. */
  down: () => void
  up: () => void
}

export async function chatsRig(opts: { create?: boolean; holdMs?: number } = {}): Promise<ChatsRig> {
  const desk = await startFakeDesktop({ sealed: true, chats: true, create: opts.create })
  desk.chats!.holdMs = opts.holdMs ?? 300
  const plain: string[] = []
  let offline = false
  const toDesk = (url: string) => {
    if (offline) throw new TypeError('Failed to fetch')
    const u = new URL(url)
    if (u.origin !== NET) throw new TypeError('unknown host')
    return `${desk.url}${u.pathname}${u.search}`
  }
  const fetchPlain: RemoteFetch = async (url, init) => {
    plain.push(`${init?.method ?? 'GET'} ${url}`)
    return fetch(toDesk(url), init)
  }
  const phone = createFakeSealedPhone(async (url, body) => {
    const res = await fetch(toDesk(url), { method: 'POST', body: Buffer.from(body), headers: { 'content-type': 'application/octet-stream' } })
    return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) }
  })
  const store = createRemoteClientStore({
    storage: memoryStorage(),
    vault: createMemoryTokenVault(),
    autoResume: false,
    persistWaitMs: 60_000,
    fetch: fetchPlain,
    sealed: { invoke: phone.invoke },
    pairPollMs: 5,
    pairWaitMs: 2_000,
  })
  await store.ready
  await store.useStore.getState().connect(desk.sealed!.qrLink({ net: NET }))
  if (opts.create) desk.sealed!.devices.get(phone.deviceId)!.rights.add('create')
  await store.useStore.getState().verifyConnection()
  return {
    store,
    phone,
    desk,
    plain,
    channel: () => {
      const ch = store.useStore.getState().desktopChannel()
      if (!ch) throw new Error('no channel')
      return ch
    },
    down: () => {
      offline = true
    },
    up: () => {
      offline = false
    },
  }
}

export async function until(fn: () => boolean, ms = 4_000): Promise<void> {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}
