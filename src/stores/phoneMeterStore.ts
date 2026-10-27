import { create } from 'zustand'
import type { PhoneMeterReport } from '../lib/phone-context-fit'

/**
 * What the last request of a plain chat on a phone carried, by the counting
 * the window of a phone is cut with (lib/phone-context-fit.ts, "the context
 * figure of a plain chat"). The context chip reads it, so the figure on the
 * screen and what was left out of the request come from one calculation.
 *
 * Ephemeral, like sendSizeStore: after a restart the chip runs the same rule
 * over the chat as it stands. Nothing writes here on a desktop.
 */
interface PhoneMeterState {
  byConv: Record<string, PhoneMeterReport>
  report: (convId: string, report: PhoneMeterReport) => void
  clear: (convId: string) => void
}

export const usePhoneMeterStore = create<PhoneMeterState>((set) => ({
  byConv: {},
  report: (convId, report) => set((state) => ({ byConv: { ...state.byConv, [convId]: report } })),
  clear: (convId) =>
    set((state) => {
      if (!(convId in state.byConv)) return state
      const next = { ...state.byConv }
      delete next[convId]
      return { byConv: next }
    }),
}))
