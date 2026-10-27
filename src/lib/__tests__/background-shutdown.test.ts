/**
 * @vitest-environment jsdom
 *
 * B1 Nachbesserung 1 (Opus-Review, 3.0.1): der Orchestrator-Entscheid "Stop
 * heisst Stop" gilt fuer fuenf Ausloeser, gebaut war nur einer (der
 * Stop-Knopf). Dieses Modul (`lib/background-shutdown.ts`) ist die eine
 * Stelle, die die anderen vier bedient: App beenden, Fenster schliessen,
 * Netzabbruch (Abmelden hat seinen eigenen Test in
 * hooks/__tests__/signing-out-must-not-lie.test.ts, weil es dort schon die
 * ganze Sign-out-Vertragspruefung gibt). Je Ausloeser ein Fall.
 *
 * Runde 2 (Final Verifier, 18.09.) fand zwei Blocker hier, beide unten
 * nachgezogen: die Reichweite war auf `delegate_task`-Hintergrundlaeufe
 * verengt (ein normaler Agent oder `/loop` OHNE Unteraufgabe entkam), und
 * `offline` toetete mit dem klebrigen `stopRun`-Merker jede Agentenarbeit
 * schon bei einem kurzen WLAN-Wackler.
 *
 * Lauf: npx vitest run src/lib/__tests__/background-shutdown.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

/** Die Horcher, die `@tauri-apps/api/event`s `listen()` eingesammelt hat. */
const listeners: Record<string, ((e: unknown) => void)[]> = {}
const unlisten = vi.fn()
let tauriOn = false
let windowVisible = false

vi.mock('../../api/in-tauri', () => ({
  isTauri: () => tauriOn,
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, cb: (e: unknown) => void) => {
    ;(listeners[name] ??= []).push(cb)
    return unlisten
  },
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    isVisible: async () => windowVisible,
  }),
}))

import { useAgentTaskStore } from '../../stores/agentTaskStore'
import { useGenerationStore } from '../../stores/generationStore'
import { useAgentLoopStore } from '../../stores/agentLoopStore'
import { isRunStopped, __resetRunStopsForTests } from '../run-stop'
import { useBackgroundShutdownStore } from '../../stores/backgroundShutdownStore'
import {
  stopAllBackgroundWork,
  installBackgroundShutdown,
  __resetBackgroundShutdownForTests,
} from '../background-shutdown'

function laufendeAufgabe(id: string, convId: string): AbortController {
  const controller = new AbortController()
  useAgentTaskStore.getState().start({
    id, convId, goal: 'x', context: '', background: true, startedAt: Date.now(), controller,
  })
  return controller
}

/** A normal agent/chat stream mid-flight, with NO delegate_task sub-agent,
 *  the shape Runde 2 found byConv could not see at all. */
function laufenderStrom(convId: string): { aborted: () => boolean } {
  let aborted = false
  useGenerationStore.getState().registerAborter(convId, () => { aborted = true })
  useGenerationStore.getState().setGenerating(convId, true)
  return { aborted: () => aborted }
}

/** A /loop pass parked between two runs, nothing is "generating", so only
 *  the loop store knows this conversation still has work pending. */
function wartenderLoopPass(convId: string): void {
  useAgentLoopStore.getState().start({
    conversationId: convId, pass: 2, cap: 0, task: 'weiter', intervalMs: 1000, nextAt: Date.now() + 1000,
  })
}

/**
 * A local run that has only just booked its place on the lane and is still
 * queued behind another conversation, the way `lib/run-slot.ts` leaves it
 * the moment `runInLane` is called: `registerAborter` and `bookRun` both
 * fire immediately, `setGenerating` only once the run actually starts. No
 * token has flowed yet, so `generating` does not know this conversation
 * exists.
 */
function wartenderLokalerLauf(convId: string): { released: () => boolean } {
  let released = false
  useGenerationStore.getState().registerAborter(convId, () => { released = true })
  useGenerationStore.getState().bookRun(convId, 'local')
  return { released: () => released }
}

beforeEach(() => {
  useAgentTaskStore.setState({ byConv: {} })
  useGenerationStore.setState({ generating: {}, aborters: {}, runs: {} })
  useAgentLoopStore.setState({ loops: {} })
  useBackgroundShutdownStore.setState({ notice: null })
  __resetRunStopsForTests()
  __resetBackgroundShutdownForTests()
  tauriOn = false
  windowVisible = false
  for (const k of Object.keys(listeners)) delete listeners[k]
  unlisten.mockClear()
})
afterEach(() => {
  __resetBackgroundShutdownForTests()
  vi.useRealTimers()
})

describe('stopAllBackgroundWork: reach (Runde 2, Blocker 2)', () => {
  it('cancels every running task in every conversation, not just the visible one', () => {
    const a = laufendeAufgabe('task-a', 'conv-A')
    const b = laufendeAufgabe('task-b', 'conv-B')

    stopAllBackgroundWork()

    expect(a.signal.aborted).toBe(true)
    expect(b.signal.aborted).toBe(true)
    expect(isRunStopped('conv-A')).toBe(true)
    expect(isRunStopped('conv-B')).toBe(true)
  })

  it('is a no-op when nothing is running, not a throw', () => {
    expect(() => stopAllBackgroundWork()).not.toThrow()
  })

  it('a finished task is left alone (nothing to cancel), but the conversation still gets the sticky Stop marker', () => {
    const c = laufendeAufgabe('task-done', 'conv-1')
    useAgentTaskStore.getState().finish('task-done', { status: 'done', output: 'ok', endedAt: Date.now() })

    stopAllBackgroundWork()

    // cancelAll only touches 'running' tasks, a done one keeps its own
    // signal untouched, but the conversation is marked stopped regardless,
    // exactly like a Stop press after the work already finished.
    expect(c.signal.aborted).toBe(false)
    expect(isRunStopped('conv-1')).toBe(true)
  })

  it('reaches a normal agent/chat stream that never started a delegate_task sub-agent', () => {
    // The gap Runde 2 named as unclosed: byConv alone never sees this.
    const strom = laufenderStrom('conv-plain')

    stopAllBackgroundWork()

    expect(strom.aborted()).toBe(true)
    expect(isRunStopped('conv-plain')).toBe(true)
  })

  it('reaches a /loop pass waiting out its interval, which generates nothing right now', () => {
    wartenderLoopPass('conv-loop')

    stopAllBackgroundWork()

    expect(useAgentLoopStore.getState().loops).toEqual({})
    expect(isRunStopped('conv-loop')).toBe(true)
  })

  it('reaches a local run that is still queued and has not generated a single token yet', () => {
    // Runde 4 (review-lanes.md Blocker 1+6): `generating` alone cannot see
    // this shape, only `generationStore.runs` can.
    const wartend = wartenderLokalerLauf('conv-wartend')

    stopAllBackgroundWork()

    expect(wartend.released()).toBe(true)
    expect(isRunStopped('conv-wartend')).toBe(true)
  })

  it('reaches all three shapes at once, none crowding out another', () => {
    const task = laufendeAufgabe('task-x', 'conv-task')
    const strom = laufenderStrom('conv-stream')
    wartenderLoopPass('conv-loop')

    stopAllBackgroundWork()

    expect(task.signal.aborted).toBe(true)
    expect(strom.aborted()).toBe(true)
    expect(useAgentLoopStore.getState().loops).toEqual({})
    expect(isRunStopped('conv-task')).toBe(true)
    expect(isRunStopped('conv-stream')).toBe(true)
    expect(isRunStopped('conv-loop')).toBe(true)
  })
})

describe('installBackgroundShutdown: App beenden (pagehide + beforeunload)', () => {
  it('pagehide stops every running background task', () => {
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-x', 'conv-1')

    window.dispatchEvent(new Event('pagehide'))

    expect(c.signal.aborted).toBe(true)
    expect(isRunStopped('conv-1')).toBe(true)
  })

  it('beforeunload stops every running background task too: the earlier of the pair', () => {
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-y', 'conv-1')

    window.dispatchEvent(new Event('beforeunload'))

    expect(c.signal.aborted).toBe(true)
  })
})

describe('installBackgroundShutdown: Netzabbruch (Runde 2, Blocker 1: offline stoppt nichts mehr)', () => {
  it('a dropped connection leaves running work running: retry.ts is built for exactly this', () => {
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-z', 'conv-1')

    window.dispatchEvent(new Event('offline'))

    expect(c.signal.aborted).toBe(false)
    expect(isRunStopped('conv-1')).toBe(false)
  })

  it('shows a visible notice instead', () => {
    installBackgroundShutdown()
    window.dispatchEvent(new Event('offline'))
    expect(useBackgroundShutdownStore.getState().notice).toEqual({ kind: 'offline' })
  })

  it('reconnecting clears the notice on its own, no user action needed', () => {
    installBackgroundShutdown()
    window.dispatchEvent(new Event('offline'))
    expect(useBackgroundShutdownStore.getState().notice?.kind).toBe('offline')

    window.dispatchEvent(new Event('online'))
    expect(useBackgroundShutdownStore.getState().notice).toBeNull()
  })

  it('COUNTER-CHECK: a two-second wobble and reconnect never touches a running task', () => {
    // The exact scenario Runde 2 named: WLAN wobble, VPN switch, sleep/wake.
    installBackgroundShutdown()
    const c = laufendeAufgabe('task-wobble', 'conv-1')

    window.dispatchEvent(new Event('offline'))
    window.dispatchEvent(new Event('online'))

    expect(c.signal.aborted).toBe(false)
    expect(isRunStopped('conv-1')).toBe(false)
  })
})

describe('installBackgroundShutdown: Fenster schliessen (app:hidden IST onCloseRequested)', () => {
  /**
   * lib.rs sendet `app:hidden` an GENAU EINER Stelle: im `CloseRequested`-
   * Arm, direkt bevor es das Fenster in den Tray versteckt. Ein Horcher auf
   * dieses Ereignis ist also derselbe X-Klick, nicht ein zweiter, getrennter
   * Moment, mit derselben Karenzzeit, die lib.rs fuer den lokalen-Modelle-
   * Offload nach demselben Klick schon anwendet.
   */
  it('reacts to app:hidden and, after the grace period, stops every running background task', async () => {
    tauriOn = true
    vi.useFakeTimers()
    installBackgroundShutdown()
    await vi.advanceTimersByTimeAsync(0)

    expect(listeners['app:hidden']).toBeDefined()
    const c = laufendeAufgabe('task-w', 'conv-1')
    windowVisible = false
    for (const cb of listeners['app:hidden']) cb(undefined)

    // Not yet, the mis-click grace period has not elapsed.
    await vi.advanceTimersByTimeAsync(1000)
    expect(c.signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(30_000)
    expect(c.signal.aborted).toBe(true)
    expect(isRunStopped('conv-1')).toBe(true)
    expect(useBackgroundShutdownStore.getState().notice).toEqual({ kind: 'hidden-stopped', at: expect.any(Number) })
  })

  it('a reopen inside the grace period cancels the stop entirely (the mis-click case)', async () => {
    tauriOn = true
    vi.useFakeTimers()
    installBackgroundShutdown()
    await vi.advanceTimersByTimeAsync(0)

    const c = laufendeAufgabe('task-w2', 'conv-1')
    for (const cb of listeners['app:hidden']) cb(undefined)

    // The user re-opened the window well within the grace period.
    windowVisible = true
    await vi.advanceTimersByTimeAsync(30_000)

    expect(c.signal.aborted).toBe(false)
    expect(isRunStopped('conv-1')).toBe(false)
    expect(useBackgroundShutdownStore.getState().notice).toBeNull()
  })

  it('does not register app:hidden outside Tauri (browser-dev / web build)', async () => {
    tauriOn = false
    installBackgroundShutdown()
    await new Promise((r) => setTimeout(r, 0))

    expect(listeners['app:hidden']).toBeUndefined()
  })
})

describe('installBackgroundShutdown: idempotent', () => {
  it('installing twice wires only one set of window listeners', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    installBackgroundShutdown()
    const callsAfterFirst = addSpy.mock.calls.length

    installBackgroundShutdown()

    expect(addSpy.mock.calls.length).toBe(callsAfterFirst)
    addSpy.mockRestore()
  })

  it('the uninstaller removes exactly what was installed', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const uninstall = installBackgroundShutdown()

    uninstall()

    expect(removeSpy.mock.calls.length).toBe(addSpy.mock.calls.length)
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
