// The MLX install slots live in Rust and were only ever polled by whichever
// page started the install (Settings, Model Manager, Create). The download
// tray in the titlebar, the one place the user actually watches, never saw
// them, so a 2.6 GB model pull showed nothing but a spinning "Installing…"
// button (2026-07-31). This store is the tray's window into those
// slots: watch() follows one install to its terminal state, adopt() picks up
// an install that is already running when the tray mounts.
//
// It is also where a click is answered. A Get shows its row before Rust has
// said anything (begin), and a Stop takes the row away before Rust has stopped
// anything (stop). On the owner's Mac both waited on the backend, and the
// backend was five seconds behind (08.10.2026). What Rust says afterwards
// still decides: a refused start takes its row back (abandon), and a Stop
// that Rust refused puts the rows back where they were.

import { create } from 'zustand'
import { getMlxImageInstallStatus, getMlxImageEngineStatus, cancelMlxImageInstall, type MlxInstallStatus } from '../api/mlx-image'
import { getMlxInstallStatus, getModelInstallStatus, cancelVideoModelInstall, type InstallStatus } from '../api/mlx-video'
import { getMusicInstallStatus, cancelMusicInstall } from '../api/mlx-music'

const POLL_MS = 1200
/** How often a Stop looks whether the slot is free again. */
const STOP_POLL_MS = 150
/** How long a Stop waits for that. A step without a child (a request to the
 *  hub) ends on its own timeout, which is thirty seconds. */
const STOP_WAIT_MS = 35_000

export type MlxInstallKind = 'image-engine' | 'image-model' | 'video-engine' | 'video-model' | 'music-model'
/** One lane has one Stop: Rust ends the model download and the engine setup
 *  of a lane with the same command. The music lane has one slot for both:
 *  its engine comes with its one model (commands/music.rs). */
export type MlxInstallLane = 'image' | 'video' | 'music'

export interface MlxInstallEntry {
  kind: MlxInstallKind
  label: string
  /** The catalogue id of the model this slot is pulling. Absent for an engine,
   *  and for an install the tray adopted without having started it. */
  modelId?: string
  status: 'installing' | 'complete' | 'error'
  progress: number
  total: number
  speed: number
  lastLog: string
  error: string | null
  /** Shown because it was clicked. Rust has not confirmed the install yet. */
  pending?: boolean
  /** Which run showed a pending row. Only that run may take it back. */
  run?: number
}

const READERS: Record<MlxInstallKind, () => Promise<MlxInstallStatus | InstallStatus>> = {
  'image-engine': getMlxImageEngineStatus,
  'image-model': getMlxImageInstallStatus,
  'video-engine': getMlxInstallStatus,
  'video-model': getModelInstallStatus,
  'music-model': getMusicInstallStatus,
}

const ADOPT_LABELS: Record<MlxInstallKind, string> = {
  'image-engine': 'MLX image engine',
  'image-model': 'Image model',
  'video-engine': 'MLX video engine',
  'video-model': 'Video model',
  'music-model': 'Music engine',
}

const LANE_KINDS: Record<MlxInstallLane, MlxInstallKind[]> = {
  image: ['image-engine', 'image-model'],
  video: ['video-engine', 'video-model'],
  music: ['music-model'],
}

const CANCEL: Record<MlxInstallLane, () => Promise<unknown>> = {
  image: () => cancelMlxImageInstall(),
  video: () => cancelVideoModelInstall(),
  music: () => cancelMusicInstall(),
}

export const mlxInstallLane = (kind: MlxInstallKind): MlxInstallLane =>
  kind.startsWith('image') ? 'image' : kind.startsWith('music') ? 'music' : 'video'

interface MlxInstallStoreState {
  entries: Record<string, MlxInstallEntry>
  /** How often each lane was stopped. Whoever follows an install remembers
   *  the number it started under and knows by a different one that it was
   *  stopped, at once and without asking the slot. */
  stopCount: Record<MlxInstallLane, number>
  /** Show an install at once, before Rust was asked. Nothing is polled yet.
   *  `run` names the caller, for `abandon`. */
  begin: (kind: MlxInstallKind, label: string, modelId?: string, run?: number) => void
  /** Take back a row that `begin` showed and Rust never confirmed. With a
   *  `run`, only the row that run showed: a run that was stopped ends a moment
   *  after the next Get has shown its own row in the same place. */
  abandon: (kind: MlxInstallKind, run?: number) => void
  watch: (kind: MlxInstallKind, label: string, modelId?: string) => void
  adopt: () => Promise<void>
  dismiss: (kind: MlxInstallKind) => void
  /** Stop what a lane is installing. Its rows are gone when this returns the
   *  promise, not when the promise settles. It rejects when Rust refused, and
   *  the rows are back then. */
  stop: (lane: MlxInstallLane) => Promise<void>
  /** Resolves once no Stop of this lane is under way. */
  settled: (lane: MlxInstallLane) => Promise<void>
  /** Note a start command of this lane that is on its way to Rust. A Stop
   *  waits for it, so that it cannot overtake the start it is meant to end. */
  starting: <T>(lane: MlxInstallLane, call: Promise<T>) => Promise<T>
}

const timers: Partial<Record<MlxInstallKind, ReturnType<typeof setInterval>>> = {}
const stops: Partial<Record<MlxInstallLane, Promise<void>>> = {}
const starts: Record<MlxInstallLane, Set<Promise<unknown>>> = { image: new Set(), video: new Set(), music: new Set() }

/** `stopCount` of a lane, for code outside React. */
export const mlxLaneGeneration = (lane: MlxInstallLane): number => useMlxInstallStore.getState().stopCount[lane]

/** For tests: no watch, no Stop and no start left over from the one before. */
export function resetMlxInstallStoreForTest() {
  for (const kind of Object.keys(timers) as MlxInstallKind[]) unwatch(kind)
  for (const lane of ['image', 'video', 'music'] as const) {
    delete stops[lane]
    starts[lane].clear()
  }
  useMlxInstallStore.setState({ entries: {}, stopCount: { image: 0, video: 0, music: 0 } })
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function unwatch(kind: MlxInstallKind) {
  clearInterval(timers[kind])
  delete timers[kind]
}

/** Until neither slot of the lane says "installing", or the time is up. */
async function untilFree(lane: MlxInstallLane): Promise<void> {
  const until = Date.now() + STOP_WAIT_MS
  for (;;) {
    const read = await Promise.all(LANE_KINDS[lane].map((kind) => READERS[kind]().catch(() => null)))
    if (read.every((s) => s?.status !== 'installing') || Date.now() >= until) return
    await wait(STOP_POLL_MS)
  }
}

const fresh = (kind: MlxInstallKind, label: string, modelId: string | undefined, pending?: { run?: number }): MlxInstallEntry => ({
  kind, label, modelId, status: 'installing', progress: 0, total: 0, speed: 0, lastLog: '', error: null,
  ...(pending ? { pending: true, ...(pending.run === undefined ? {} : { run: pending.run }) } : {}),
})

export const useMlxInstallStore = create<MlxInstallStoreState>()((set, get) => ({
  entries: {},
  stopCount: { image: 0, video: 0, music: 0 },

  begin: (kind, label, modelId, run) => {
    // An install that is already followed is somebody's running install. The
    // click joins it, and its row stays as it is.
    if (timers[kind] || get().entries[kind]?.status === 'installing') return
    set((s) => ({ entries: { ...s.entries, [kind]: fresh(kind, label, modelId, { run }) } }))
  },

  abandon: (kind, run) => {
    const entry = get().entries[kind]
    if (entry?.pending && (run === undefined || entry.run === run)) get().dismiss(kind)
  },

  watch: (kind, label, modelId) => {
    if (timers[kind]) return
    set((s) => ({ entries: { ...s.entries, [kind]: fresh(kind, label, modelId) } }))
    const tick = async () => {
      let s: MlxInstallStatus | InstallStatus
      try {
        s = await READERS[kind]()
      } catch {
        return // transient: the slot is being written; next tick retries
      }
      // The answer of a watch that has ended since: a Stop took the row away
      // while this read was on its way, and it must not bring it back.
      if (timers[kind] !== timer) return
      // 'idle' can only mean the app restarted under us; the install is gone.
      const status = s.status === 'installing' ? 'installing' : s.status === 'complete' ? 'complete' : s.status === 'error' ? 'error' : null
      if (status === null) {
        unwatch(kind)
        get().dismiss(kind)
        return
      }
      set((st) => ({
        entries: {
          ...st.entries,
          [kind]: {
            kind,
            label: st.entries[kind]?.label ?? label,
            modelId: st.entries[kind]?.modelId ?? modelId,
            status,
            progress: s.download_progress,
            total: s.download_total,
            speed: s.download_speed,
            lastLog: s.logs.length ? String(s.logs[s.logs.length - 1]) : '',
            error: s.error,
          },
        },
      }))
      if (status !== 'installing') unwatch(kind)
    }
    const timer = setInterval(tick, POLL_MS)
    timers[kind] = timer
    void tick()
  },

  // Pick up installs already running in Rust that nobody is watching, e.g.
  // the user started one in Settings, the view unmounted, and the tray is the
  // only surface left. Callers gate this on macOS; the commands 400 elsewhere.
  adopt: async () => {
    await Promise.all(
      (Object.keys(READERS) as MlxInstallKind[]).map(async (kind) => {
        if (timers[kind] || get().entries[kind]) return
        const s = await READERS[kind]().catch(() => null)
        // A lane that is being stopped still reads "installing" for a moment.
        // That is the install on its way out, not one to pick up.
        if (stops[mlxInstallLane(kind)] || timers[kind] || get().entries[kind]) return
        if (s?.status === 'installing') get().watch(kind, ADOPT_LABELS[kind])
      }),
    )
  },

  dismiss: (kind) => {
    set((s) => {
      const entries = { ...s.entries }
      delete entries[kind]
      return { entries }
    })
  },

  stop: (lane) => {
    const running = stops[lane]
    if (running) return running
    // Gone at once. What Rust needs to end the download comes after.
    const taken = LANE_KINDS[lane]
      .map((kind) => get().entries[kind])
      .filter((e): e is MlxInstallEntry => e?.status === 'installing')
    for (const e of taken) unwatch(e.kind)
    set((s) => {
      const entries = { ...s.entries }
      for (const e of taken) delete entries[e.kind]
      return { entries, stopCount: { ...s.stopCount, [lane]: s.stopCount[lane] + 1 } }
    })
    const run = (async () => {
      try {
        // A start that is still on its way is let through first: a Stop that
        // arrived before it would stop nothing and leave the download running
        // with no row to show it.
        await Promise.allSettled([...starts[lane]])
        try {
          await CANCEL[lane]()
        } catch (e) {
          // Rust did not stop it, so it is still running, and the rows say so
          // again. `watch` reads the slot, and a slot that is idle after all
          // takes its row away by itself.
          delete stops[lane]
          for (const entry of taken) get().watch(entry.kind, entry.label, entry.modelId)
          throw e
        }
        await untilFree(lane)
      } finally {
        delete stops[lane]
      }
    })()
    stops[lane] = run
    return run
  },

  settled: async (lane) => {
    // Never rejects: whoever waits here wants to start, and a Stop that
    // failed has told its own caller.
    await stops[lane]?.catch(() => {})
  },

  starting: (lane, call) => {
    starts[lane].add(call)
    const done = () => { starts[lane].delete(call) }
    call.then(done, done)
    return call
  },
}))
