import { create } from 'zustand'

/**
 * The one visible line for what `lib/background-shutdown.ts` did without the
 * user watching. Runtime only, never persisted: a notice about something
 * that happened last session is not a notice, it is a stale claim.
 *
 * ── B1 Runde 2, Punkt 1 und 4 ────────────────────────────────────────────
 *
 * Two DIFFERENT things this module needs to say, never conflated into one:
 *
 *  `'offline'`  the network dropped. Nothing was stopped, retry.ts already
 *               retries a dropped connection on purpose, so a two-second
 *               WLAN wobble must not read as "your work is gone". This
 *               notice says the connection is down and running work is
 *               waiting or retrying, and clears itself the moment `online`
 *               fires again.
 *
 *  `'hidden-stopped'` the window was closed (to the tray) and, after the
 *               grace period a reopen would have cancelled, background
 *               agent work was actually stopped, the same trade the local
 *               model offload in lib.rs already makes for the same click.
 *               This one does NOT self-clear: the user has to see it once,
 *               because credits stopped accruing and a new message is what
 *               starts the next one.
 */
export type BackgroundNotice = { kind: 'offline' } | { kind: 'hidden-stopped'; at: number }

interface BackgroundShutdownState {
  notice: BackgroundNotice | null
  setNotice: (notice: BackgroundNotice | null) => void
  dismiss: () => void
}

export const useBackgroundShutdownStore = create<BackgroundShutdownState>((set) => ({
  notice: null,
  setNotice: (notice) => set({ notice }),
  dismiss: () => set({ notice: null }),
}))
