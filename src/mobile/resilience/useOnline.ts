/**
 * Is there a network. Owned by strand 6 (Remote and resilience).
 *
 * Two questions, two answers:
 *
 *   useOnline()       the phone has a network (navigator.onLine and its
 *                     events). Nothing is asked of any server. Model
 *                     downloads, the model search and everything else that
 *                     does not need LU Cloud hang on this alone: a download
 *                     reports its own failure, and LU Cloud being down or
 *                     filtered must never lock a model from huggingface.co.
 *
 *   useCloudOnline()  the same, and while Cloud is switched on also "LU
 *                     Cloud answers". Only then one tiny request goes to
 *                     the cloud of LU. With Cloud off the app asks nobody,
 *                     so a phone that only works on device stays silent.
 *
 * The confirmed answer (Cloud on):
 *
 *   start          believe navigator.onLine, then confirm in the background.
 *                  A start with a working network never flashes the line.
 *   event offline  offline at once.
 *   event online   NOT online yet: probe first.
 *   probe fails    once more after a short pause; two misses mean offline.
 *                  One lost request on a train does not raise the line.
 *   while offline  probe again with growing pauses, on return to the app
 *                  and on the next "online" event. The line goes away by
 *                  itself (DESIGN.md G7).
 *   while online   probe on return to the app, every 45 s while a page that
 *                  needs the cloud is on screen, and whenever a screen
 *                  reports a request that failed (noteNetworkFailure).
 *
 * The probe: in the native app a HEAD to the cloud of LU. No account, no
 * body, any answer counts, even an error page. In a plain browser (developer
 * server, Playwright) the app's own server is asked instead, so a test run
 * never leaves the machine.
 */
import { useSyncExternalStore } from 'react'
import { isTauri } from '../../api/backend'
import { CLOUD_BASE } from '../../api/cloud/config'
import { onLifecycle } from '../platform/lifecycle'
import { connectionKind, isOnline as linkExists, onNetworkChange } from '../platform/network'
import { useSettingsStore } from '../../stores/settingsStore'

export type OnlineState =
  /** The last probe came back. */
  | 'online'
  /** No link, or two probes in a row got no answer. */
  | 'offline'
  /** A link exists, the answer is still out. Shown as what it was before. */
  | 'checking'

export interface OnlineSnapshot {
  online: boolean
  state: OnlineState
}

export interface OnlineMonitorDeps {
  /** Resolves true when something answered. Never throws. */
  probe: () => Promise<boolean>
  /**
   * Whether the probe may be sent at all (Cloud is switched on). While false
   * the link alone is the answer and no request leaves the phone. Left out
   * means always.
   */
  probeWanted?: () => boolean
  /** navigator.onLine. */
  linkExists: () => boolean
  /** Subscribe to the browser events online and offline. */
  onLinkChange: (fn: (online: boolean) => void) => () => void
  /** Subscribe to "the app is on screen again". */
  onForeground: (fn: () => void) => () => void
  setTimeout: (fn: () => void, ms: number) => unknown
  clearTimeout: (handle: unknown) => void
  /** Whether the app is on screen; background probes are skipped. */
  visible: () => boolean
}

/** Pause before the second probe that confirms a miss. */
export const CONFIRM_MISS_MS = 1500
/** Pauses between probes while offline; the last one repeats. */
export const OFFLINE_BACKOFF_MS = [3000, 6000, 12000, 30000] as const
/** Pause between probes while online and watched. */
export const ONLINE_RECHECK_MS = 45_000
/** How long one probe may take. */
export const PROBE_TIMEOUT_MS = 5000

export interface OnlineMonitor {
  get: () => OnlineSnapshot
  subscribe: (fn: () => void) => () => void
  /** A request failed somewhere: find out whether the network is gone. */
  noteFailure: () => void
  /** Probe now. Resolves with the state after it. */
  check: () => Promise<OnlineSnapshot>
  /** Stop everything (tests). */
  dispose: () => void
}

/**
 * The state machine, without a browser in it. The hook below runs one
 * instance; the tests run their own with a fake probe and a fake clock.
 */
export function createOnlineMonitor(deps: OnlineMonitorDeps): OnlineMonitor {
  const listeners = new Set<() => void>()
  let snapshot: OnlineSnapshot = deps.linkExists() ? { online: true, state: 'checking' } : { online: false, state: 'offline' }
  let started = false
  let disposed = false
  let timer: unknown = null
  let running: Promise<OnlineSnapshot> | null = null
  let again = false
  let misses = 0
  let backoff = 0
  const stops: Array<() => void> = []

  function publish(next: OnlineSnapshot): void {
    if (next.online === snapshot.online && next.state === snapshot.state) return
    snapshot = next
    for (const fn of [...listeners]) fn()
  }

  function schedule(ms: number): void {
    if (timer !== null) deps.clearTimeout(timer)
    timer = deps.setTimeout(() => {
      timer = null
      // Nothing is asked while the app is away; the return to the screen asks.
      if (deps.visible()) void check()
    }, ms)
  }

  function unschedule(): void {
    if (timer !== null) deps.clearTimeout(timer)
    timer = null
  }

  async function runProbe(): Promise<OnlineSnapshot> {
    if (!deps.linkExists()) {
      misses = 0
      publish({ online: false, state: 'offline' })
      // The browser tells when a link is back; the timer is only the net under it.
      if (listeners.size > 0) schedule(OFFLINE_BACKOFF_MS[OFFLINE_BACKOFF_MS.length - 1])
      return snapshot
    }
    if (deps.probeWanted && !deps.probeWanted()) {
      // Cloud is off: the link is the whole answer, nobody is asked and no timer runs.
      misses = 0
      backoff = 0
      publish({ online: true, state: 'online' })
      return snapshot
    }
    let ok = false
    try {
      ok = await deps.probe()
    } catch {
      ok = false
    }
    if (disposed) return snapshot
    if (ok) {
      misses = 0
      backoff = 0
      publish({ online: true, state: 'online' })
      if (listeners.size > 0) schedule(ONLINE_RECHECK_MS)
      return snapshot
    }
    misses += 1
    if (misses < 2 && snapshot.online) {
      // One miss proves nothing. Ask once more, soon, and keep the old answer meanwhile.
      schedule(CONFIRM_MISS_MS)
      return snapshot
    }
    publish({ online: false, state: 'offline' })
    const wait = OFFLINE_BACKOFF_MS[Math.min(backoff, OFFLINE_BACKOFF_MS.length - 1)]
    backoff += 1
    if (listeners.size > 0) schedule(wait)
    return snapshot
  }

  function check(): Promise<OnlineSnapshot> {
    if (disposed) return Promise.resolve(snapshot)
    if (running) {
      // Something changed while a probe was out: its answer may be stale, so one more follows.
      again = true
      return running
    }
    unschedule()
    running = runProbe().finally(() => {
      running = null
      if (again && !disposed) {
        again = false
        void check()
      }
    })
    return running
  }

  function start(): void {
    if (started || disposed) return
    started = true
    stops.push(
      deps.onLinkChange((online) => {
        if (!online) {
          misses = 0
          backoff = 0
          unschedule()
          publish({ online: false, state: 'offline' })
          return
        }
        // "online" is a hint, not an answer.
        backoff = 0
        if (snapshot.online) publish({ online: true, state: 'checking' })
        void check()
      }),
    )
    stops.push(
      deps.onForeground(() => {
        backoff = 0
        void check()
      }),
    )
    void check()
  }

  return {
    get: () => snapshot,
    subscribe(fn) {
      listeners.add(fn)
      start()
      // A page came on screen that needs the network: do not wait for the next tick of a timer set for nobody.
      if (listeners.size === 1 && started && !running && timer === null) void check()
      return () => {
        listeners.delete(fn)
        if (listeners.size === 0) unschedule()
      }
    },
    noteFailure() {
      if (disposed) return
      start()
      if (deps.visible()) void check()
    },
    check,
    dispose() {
      disposed = true
      unschedule()
      for (const stop of stops.splice(0)) stop()
      listeners.clear()
    },
  }
}

/** The address the probe asks. Exported for the test. */
export function probeUrl(native: boolean, origin: string): string {
  // The front page of the cloud always exists. In the browser a file of the app itself, so no 404 lands in the console.
  return native ? `${CLOUD_BASE.replace(/\/+$/, '')}/` : `${origin}/LU-monogram.svg`
}

/** One tiny request. True when anything answered, false on a network failure or after the time limit. */
export async function probeNetwork(url: string = probeUrl(isTauri(), typeof location === 'undefined' ? '' : location.origin)): Promise<boolean> {
  if (typeof fetch !== 'function') return true
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS)
  try {
    // no-cors: the answer is opaque, and that is enough. Reaching it is the whole question.
    await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal })
    return true
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

let monitor: OnlineMonitor | null = null

function shared(): OnlineMonitor {
  if (!monitor) {
    monitor = createOnlineMonitor({
      probe: () => probeNetwork(),
      probeWanted: cloudIsOn,
      linkExists,
      onLinkChange: onNetworkChange,
      onForeground: (fn) => onLifecycle({ onForeground: () => fn() }),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      visible: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
    })
    // Cloud switched on or off: the answer changes its meaning, so ask (or stop asking) now.
    const m = monitor
    let was = cloudIsOn()
    stopWatchingMode = useSettingsStore.subscribe(() => {
      const now = cloudIsOn()
      if (now === was) return
      was = now
      void m.check()
    })
  }
  return monitor
}

/** Cloud is switched on. Only then LU Cloud is asked whether it answers. */
export function cloudIsOn(): boolean {
  try {
    return useSettingsStore.getState().settings.appMode === 'cloud'
  } catch {
    return false
  }
}

let stopWatchingMode: (() => void) | null = null

const LINK_SERVER = true

/**
 * What the system said the last time it was asked directly (recheckOnline),
 * when that differs from navigator.onLine. A WebView can hold on to an old
 * value of navigator.onLine; the next real event of the browser wins again.
 */
let systemSays: boolean | null = null
const linkListeners = new Set<() => void>()

function linkNow(): boolean {
  return systemSays ?? linkExists()
}

function subscribeLink(fn: () => void): () => void {
  linkListeners.add(fn)
  const off = onNetworkChange(() => {
    systemSays = null
    fn()
  })
  return () => {
    linkListeners.delete(fn)
    off()
  }
}

/**
 * Ask again, now: has the phone a network. For "Try again" on a page that
 * hangs on useOnline(). The system is asked through the native layer where
 * there is one (the kind of connection, "none" means no network), else
 * navigator.onLine. No server of anybody is asked for this: what is local
 * hangs on the network of the system alone. With Cloud switched on, LU Cloud
 * is probed again as well, for the pages that hang on useCloudOnline().
 * Resolves with the answer every useOnline() shows from then on. Never throws.
 */
export async function recheckOnline(): Promise<boolean> {
  let link = linkExists()
  try {
    const kind = await connectionKind()
    if (kind === 'none') link = false
    else if (kind !== 'unknown') link = true
  } catch {
    /* navigator.onLine stays the answer */
  }
  systemSays = link === linkExists() ? null : link
  for (const fn of [...linkListeners]) fn()
  if (cloudIsOn()) void shared().check()
  return link
}

const SERVER: OnlineSnapshot = { online: true, state: 'online' }

/**
 * True while the phone has a network. Asks no server. This is the gate for
 * model downloads and everything local; what is behind the link shows in the
 * request itself.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeLink, linkNow, () => LINK_SERVER)
}

/**
 * True while LU Cloud can be reached: the phone has a network and, with
 * Cloud switched on, the last probe came back. With Cloud off this is the
 * same as useOnline() and nothing is sent.
 */
export function useCloudOnline(): boolean {
  return useOnlineState().online
}

/** The same with the reason: 'checking' while an answer is still out. */
export function useOnlineState(): OnlineSnapshot {
  const m = shared()
  return useSyncExternalStore(m.subscribe, m.get, () => SERVER)
}

/**
 * For any screen: a request just failed for lack of an answer. The monitor
 * probes at once, and the offline line shows without waiting for its timer.
 */
export function noteNetworkFailure(): void {
  shared().noteFailure()
}

/** Outside React: can LU Cloud be reached right now (see useCloudOnline). */
export function isConfirmedOnline(): boolean {
  return shared().get().online
}

/** Only for tests. */
export function __resetOnlineForTests(): void {
  monitor?.dispose()
  monitor = null
  stopWatchingMode?.()
  stopWatchingMode = null
  systemSays = null
  linkListeners.clear()
}
