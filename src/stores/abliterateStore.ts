import { create } from 'zustand'
import { abliterateStatus, type RunStatus } from '../api/abliterate'
import { log } from '../lib/logger'

// One refusal-removal run at a time, owned by Rust. The store only mirrors it,
// so the dialog can be closed and opened again, and the Model Manager can show
// the run while the dialog is closed. Polled while a run is going, never
// otherwise (#70: keep the app light).

const POLL_MS = 1500

interface AbliterateState {
  status: RunStatus | null
  /** The GGUF the dialog is open for, or null when it is closed. */
  dialogPath: string | null
  openDialog: (path: string) => void
  closeDialog: () => void
  setStatus: (s: RunStatus) => void
  /** Ask Rust once, and keep asking while a run is going. */
  refresh: () => Promise<void>
}

let timer: ReturnType<typeof setTimeout> | null = null

export const useAbliterateStore = create<AbliterateState>()((set, get) => ({
  status: null,
  dialogPath: null,
  openDialog: (path) => {
    set({ dialogPath: path })
    void get().refresh()
  },
  closeDialog: () => set({ dialogPath: null }),
  setStatus: (s) => {
    set({ status: s })
    schedule(s)
  },
  refresh: async () => {
    try {
      const s = await abliterateStatus()
      set({ status: s })
      schedule(s)
    } catch (err) {
      log.warn('[abliterate] status failed', { err })
    }
  },
}))

function schedule(s: RunStatus) {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  if (s.status !== 'running') return
  timer = setTimeout(() => {
    timer = null
    void useAbliterateStore.getState().refresh()
  }, POLL_MS)
}

/** For tests: stop a pending poll. */
export function stopAbliteratePolling() {
  if (timer) clearTimeout(timer)
  timer = null
}
