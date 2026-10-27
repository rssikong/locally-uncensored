/**
 * Staying connected to the computer (A17, PLAN-REMOTE-PREMIUM P0.5):
 * reconnect by itself with a back off, at once when the app comes back to
 * the screen or the network changes (Wi-Fi and the internet in the order
 * the store already knows: Wi-Fi first, then the internet link), and one
 * line that says how the phone is connected right now.
 *
 * No pairing again: only `verifyConnection` of the remote store, which
 * finds the pinned computer on its known addresses.
 */
import { create } from 'zustand'
import { classifyHost } from './pairingLink'
import type { RemoteClientStore, RemoteConnection, RemoteStatus } from './remoteClientStore'

/** Seconds between two tries while the computer does not answer. */
export const RECONNECT_BACKOFF_S: readonly number[] = [2, 4, 8, 15, 30, 60]

/** After this many failed tries the line says "not reachable" instead of "Reconnecting…". */
export const RECONNECT_PATIENCE = 3

export type LineKind = 'wifi' | 'internet' | 'reconnecting' | 'unreachable'

export const LINE_TEXT: Record<LineKind, string> = {
  wifi: 'Connected on Wi-Fi',
  internet: 'Connected over the internet',
  reconnecting: 'Reconnecting…',
  unreachable: 'Your computer is not reachable (asleep or LU closed)',
}

export interface ReconnectState {
  /** Failed tries since the last time the computer answered. */
  attempts: number
  /** When the next try runs (ms since 1970), null when none is planned. */
  nextAt: number | null
}

export const useReconnect = create<ReconnectState>()(() => ({ attempts: 0, nextAt: null }))

/** Pure: the address the phone reaches the computer on is in the Wi-Fi. */
export function onWifi(connection: Pick<RemoteConnection, 'via' | 'baseUrl'> | null): boolean {
  const address = connection?.via ?? connection?.baseUrl
  if (!address) return false
  try {
    const u = new URL(address)
    if (u.protocol === 'https:') return false
    const r = classifyHost(u.hostname)
    return r === 'lan' || r === 'loopback'
  } catch {
    return false
  }
}

/** Pure: the line above a remote page. Null when there is nothing to connect to. */
export function connectionLine(input: { status: RemoteStatus; connection: Pick<RemoteConnection, 'via' | 'baseUrl'> | null; attempts: number }): LineKind | null {
  if (!input.connection) return null
  if (input.status === 'connected') return onWifi(input.connection) ? 'wifi' : 'internet'
  if (input.status === 'connecting') return 'reconnecting'
  if (input.status === 'offline') return input.attempts < RECONNECT_PATIENCE ? 'reconnecting' : 'unreachable'
  return null
}

/** Pure: seconds until the next try after `attempts` failed ones. */
export function backoffSeconds(attempts: number): number {
  return RECONNECT_BACKOFF_S[Math.min(Math.max(0, attempts - 1), RECONNECT_BACKOFF_S.length - 1)]
}

export interface ReconnectDeps {
  store: RemoteClientStore
  /** The app came back to the screen. Returns the unsubscribe. */
  onForeground?: (fn: () => void) => () => void
  /** The network changed (online, offline, another kind). Returns the unsubscribe. */
  onNetworkChange?: (fn: (online: boolean) => void) => () => void
  /** The computer answers again. */
  reconnected?: () => void
  now?: () => number
  /** Test seam: seconds to milliseconds. */
  unitMs?: number
}

let off: Array<() => void> = []
let timer: ReturnType<typeof setTimeout> | null = null

function clearTimer(): void {
  if (timer) clearTimeout(timer)
  timer = null
  useReconnect.setState({ nextAt: null })
}

/** Once, from the remote session. */
export function installReconnect(deps: ReconnectDeps): () => void {
  stopReconnect()
  const { store } = deps
  const now = deps.now ?? Date.now
  const unit = deps.unitMs ?? 1_000
  const paired = () => {
    const s = store.useStore.getState()
    return !!s.connection && (!!s.connection.pin || !!s.token)
  }
  const tryNow = () => {
    clearTimer()
    const s = store.useStore.getState()
    if (!paired() || s.status === 'connecting' || s.status === 'pairing') return
    void s.verifyConnection()
  }
  const plan = () => {
    if (timer) return
    const wait = backoffSeconds(useReconnect.getState().attempts) * unit
    useReconnect.setState({ nextAt: now() + wait })
    timer = setTimeout(() => {
      timer = null
      useReconnect.setState({ nextAt: null })
      tryNow()
    }, wait)
  }
  let last = store.useStore.getState().status
  off.push(
    store.useStore.subscribe((s) => {
      if (s.status === last) return
      const before = last
      last = s.status
      if (s.status === 'connected') {
        clearTimer()
        useReconnect.setState({ attempts: 0 })
        if (before !== 'connected') deps.reconnected?.()
        return
      }
      if (s.status === 'offline' && paired()) {
        useReconnect.setState((r) => ({ attempts: r.attempts + 1 }))
        plan()
        return
      }
      if (s.status !== 'connecting') clearTimer()
    }),
  )
  if (deps.onForeground) {
    off.push(
      deps.onForeground(() => {
        if (store.useStore.getState().status !== 'connected') tryNow()
      }),
    )
  }
  if (deps.onNetworkChange) {
    off.push(
      deps.onNetworkChange((online) => {
        if (!online) return
        // Another network: Wi-Fi may be there again (or gone). The store tries Wi-Fi first, then the internet link.
        tryNow()
      }),
    )
  }
  return stopReconnect
}

export function stopReconnect(): void {
  for (const f of off) f()
  off = []
  clearTimer()
  useReconnect.setState({ attempts: 0, nextAt: null })
}
