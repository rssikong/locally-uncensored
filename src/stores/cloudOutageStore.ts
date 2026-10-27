import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'

/**
 * What the server last said about an LU Cloud outage (lib/cloud-outage.ts).
 *
 * Only `dismissedMessage` is written to disk: the line someone closed stays
 * closed for that sentence, across a restart too, and a NEW sentence brings
 * it back. Whether an outage is on is asked again at every start, a copy from
 * yesterday could only be wrong.
 */
interface CloudOutageState {
  active: boolean
  message: string | null
  dismissedMessage: string | null
  setOutage: (active: boolean, message: string | null) => void
  dismiss: () => void
  clear: () => void
}

export const useCloudOutageStore = create<CloudOutageState>()(
  persist(
    (set, get) => ({
      active: false,
      message: null,
      dismissedMessage: null,
      setOutage: (active, message) => set(active ? { active, message } : { active: false, message: null }),
      dismiss: () => set({ dismissedMessage: get().message }),
      clear: () => set({ active: false, message: null }),
    }),
    {
      name: 'lu-cloud-outage',
      storage: safeJSONStorage(),
      partialize: (s) => ({ dismissedMessage: s.dismissedMessage }) as CloudOutageState,
    },
  ),
)

/** The sentence while an outage is on, null otherwise. */
export function activeOutageMessage(): string | null {
  const s = useCloudOutageStore.getState()
  return s.active ? s.message : null
}
