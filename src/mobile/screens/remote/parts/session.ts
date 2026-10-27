/**
 * The one remote session of the app, as the screens of this strand use it.
 *
 * The logic layer (src/mobile/remote) builds the store but leaves three
 * things to the shell: which transport carries the calls, when the app goes
 * to the background and comes back, and which desktops to offer again. This
 * file settles all three, once.
 *
 * boot/wiring.ts starts it with the app (remoteSession()), so a pairing is
 * kept warm even when no remote page is opened after a restart.
 */
import { useSyncExternalStore } from 'react'
import { backendCall, isTauri } from '../../../../api/backend'
import { lifecycleState, onLifecycle } from '../../../platform/lifecycle'
import {
  configureRemoteClientStore,
  getRemoteClientStore,
  type LifecycleEnv,
  type RemoteClientState,
  type RemoteClientStore,
} from '../../../remote/remoteClientStore'
import { knownDesktops, rememberDesktop, subscribeKnownDesktops, type KnownDesktop } from './knownDesktops'
import { installSharedChats, sharedChatsReconnected, sharedWaiting, useSharedChats } from '../../../remote/sharedChatStore'
import { installReconnect } from '../../../remote/reconnect'
import { connectionKind, onNetworkChange } from '../../../platform/network'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import { toast } from '../../../ui/Toast'
import { sayNotice, setNoticeScreen, setWaiting } from './notices'
import { createDeviceFetch, isMissingRemoteCommand } from './transport'

let session: RemoteClientStore | null = null

/**
 * A17: a change of the network. "online" and "offline" of the WebView do not
 * fire when the phone goes from Wi-Fi to mobile data, so the kind of network
 * is asked as well, every 10 s while LU is on the screen.
 */
function onAnyNetworkChange(fn: (online: boolean) => void): () => void {
  const off = onNetworkChange(fn)
  let last: string | null = null
  const timer = setInterval(() => {
    if (lifecycleState() !== 'foreground') return
    void connectionKind().then((kind) => {
      if (last !== null && kind !== last && kind !== 'none' && kind !== 'unknown') fn(true)
      last = kind
    })
  }, 10_000)
  return () => {
    off()
    clearInterval(timer)
  }
}

function start(): RemoteClientStore {
  try {
    // In the native app every call goes through Rust. In a browser the store keeps the fetch of the browser.
    if (isTauri()) {
      configureRemoteClientStore({
        fetch: createDeviceFetch({ invoke: (cmd, args) => backendCall(cmd, args), isMissingCommand: isMissingRemoteCommand }),
        // The sealed channel (3.0.7): the only way over the internet. The device key stays in Rust.
        sealed: { invoke: (cmd, args) => backendCall(cmd, args) },
        // The address lookup is switched off in addressLookup.ts until Web is live; nothing is fetched before.
        lookupFetch: (url, init) => globalThis.fetch(url, init),
        // A silent Wi-Fi means a blocked computer only while the phone is on Wi-Fi itself.
        networkKind: () => connectionKind(),
      })
    }
  } catch {
    /* another screen created the store first: it keeps the transport it has */
  }
  const store = getRemoteClientStore()

  // The store brings its own listeners for pagehide and visibilitychange. The
  // phone has one source for leaving and coming back (platform/lifecycle.ts,
  // which also hears the native pause), so the store gets only its keepalive
  // timer from attachLifecycle and the two moments from the seam.
  const quiet = { addEventListener() {}, removeEventListener() {} }
  const env: LifecycleEnv = {
    window: quiet as unknown as LifecycleEnv['window'],
    document: {
      ...quiet,
      get visibilityState() {
        return lifecycleState() === 'foreground' ? 'visible' : 'hidden'
      },
    } as unknown as LifecycleEnv['document'],
  }
  store.attachLifecycle(env)
  onLifecycle({
    // Synchronous first step inside: the running answer is marked and the state is set before anything is awaited.
    onBackground: () => void store.useStore.getState().handleBackground(),
    onForeground: () => void store.useStore.getState().handleForeground(),
  })

  // A17: the shared chats of the computer, reconnecting by itself, and the notices while LU is away.
  installSharedChats({
    channel: () => store.useStore.getState().desktopChannel(),
    foreground: () => lifecycleState() === 'foreground',
    lost: () => {
      if (store.useStore.getState().status === 'connected') void store.useStore.getState().verifyConnection()
    },
    notify: (n) =>
      void sayNotice({
        kind: n.kind,
        about: n.title,
        text: n.kind === 'approval' ? S.notices.approvalText(n.text) : n.text,
        target: { kind: 'chat', id: n.chatId },
      }),
  })
  setNoticeScreen({
    toast: (text) => toast(text, { testid: 'remote-notice' }),
    isOpen: (target) => target.kind === 'chat' && useSharedChats.getState().openChatId === target.id,
  })
  useSharedChats.subscribe(() => setWaiting('chats', sharedWaiting()))
  installReconnect({
    store,
    onForeground: (fn) => onLifecycle({ onForeground: fn }),
    onNetworkChange: (fn) => onAnyNetworkChange(fn),
    reconnected: sharedChatsReconnected,
  })

  // A pairing that worked is worth offering again.
  let last = store.useStore.getState().status
  let lastName = ''
  store.useStore.subscribe((state) => {
    const name = state.connection?.hostName ?? ''
    // The name arrives a moment after "connected", with the first answer of the desktop.
    if (state.status === last && (state.status !== 'connected' || name === lastName)) return
    last = state.status
    lastName = name
    if (state.status === 'connected' && state.connection) rememberDesktop(state.connection.baseUrl, Date.now(), name)
  })
  return store
}

/** The session, started on first use. */
export function remoteSession(): RemoteClientStore {
  if (!session) session = start()
  return session
}

/** Hook: a slice of the remote state. */
export function useRemote<T>(selector: (state: RemoteClientState) => T): T {
  return remoteSession().useStore(selector)
}

/** Outside React: the state with its actions. */
export function remote(): RemoteClientState {
  return remoteSession().useStore.getState()
}

/** Hook: the desktops this phone was paired with. */
export function useKnownDesktops(): KnownDesktop[] {
  return useSyncExternalStore(subscribeKnownDesktops, knownDesktops, knownDesktops)
}

/**
 * What the user typed into R2, kept while the page is away (a scan, the help
 * page, a trip to the desktop to read the code). The address only: the code
 * is never kept anywhere.
 */
const draft = { address: '', fromLink: false }

export function connectDraft(): { address: string; fromLink: boolean } {
  return { ...draft }
}

export function setConnectDraft(address: string, fromLink = false): void {
  draft.address = address
  draft.fromLink = fromLink
}

/**
 * The link the Connect page is about to take came out of the scanner, not
 * from another app. Only changes the sentence the page shows.
 */
let handedByScan = false

export function markHandedByScan(on: boolean): void {
  handedByScan = on
}

export function wasHandedByScan(): boolean {
  return handedByScan
}

/** Only for tests. */
export function __resetRemoteSessionForTests(): void {
  session = null
  handedByScan = false
  draft.address = ''
  draft.fromLink = false
}
