// The gate pop-up's memory: the last public catalogue that arrived, and the
// model somebody clicked there. Both persisted, the pick so that a checkout in
// the browser, a restart and a sign in later still land on that model.
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { safeJSONStorage } from '../lib/storage-quota'
import type { GateCatalog, GatePick } from '../lib/cloud-gate'
import { getPublicCatalog } from '../api/cloud/public-catalog'

interface CloudGateState {
  /** The last answer of the server, null until one arrived. */
  catalog: GateCatalog | null
  fetchedAt: number | null
  pick: GatePick | null
  setCatalog: (c: GateCatalog) => void
  setPick: (p: GatePick | null) => void
}

export const useCloudGateStore = create<CloudGateState>()(
  persist(
    (set) => ({
      catalog: null,
      fetchedAt: null,
      pick: null,
      setCatalog: (catalog) => set({ catalog, fetchedAt: Date.now() }),
      setPick: (pick) => set({ pick }),
    }),
    { name: 'lu-cloud-gate', storage: safeJSONStorage() },
  ),
)

/** Ask the server once more. A failure keeps what is there. */
export async function refreshGateCatalog(): Promise<void> {
  const c = await getPublicCatalog()
  if (c) useCloudGateStore.getState().setCatalog(c)
}
