/**
 * The part of Create that lives outside any page.
 *
 * Only the top two pages of a tab stay mounted, and another tab unmounts all
 * of them, while a render in the cloud runs for minutes. So what follows a
 * run sits here, in the module: the face of the stage (run-state.ts), the
 * jobs that were booked before the app was closed, and the wake up calls
 * that fetch their results.
 *
 * Picking up booked jobs after a restart, on the way back and when the
 * network returns belongs to the shell (lib/mobile-lifecycle.ts, installed in
 * boot/wiring.ts). Create only asks for one more pass where the shell cannot
 * know it is due: when Create opens, when a run gave up waiting, and when
 * the account becomes known. It hears the outcome through the seam of the
 * scaffold (onJobsLanded) and answers true when it told the user itself.
 */
import { create } from 'zustand'
import { deriveIntent, useCreateStore } from '../../../../stores/createStore'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { getQuota } from '../../../../api/cloud/jobs'
import { refreshCatalog } from '../../../../stores/cloudCatalogStore'
import { resumeCloudJobsNow } from '../../../../lib/mobile-lifecycle'
import { onJobsLanded } from '../../../boot/wiring'
import { pendingCloudJobs, type PendingCloudJob } from '../../../../lib/pending-cloud-jobs'
import { isOnline } from '../../../platform/network'
import { toast } from '../../../ui'
import { nav } from '../../../nav'
import { CREATE_STRINGS as T } from '../../../strings/create'
import { forgetCreateDraft, installCreateDraft } from './draft'
import { initialRun, runReducer, type RunEvent, type RunState } from './run-state'

interface RunStore {
  run: RunState
  /** Jobs booked earlier whose result is still to come, as the ledger lists them. */
  pending: PendingCloudJob[]
  /** How many of them were found when Create started, for "Picked up 1 running job." */
  pickedUp: number
  dispatch: (event: RunEvent) => void
  setPending: (pending: PendingCloudJob[]) => void
  setPickedUp: (n: number) => void
}

export const useRunStore = create<RunStore>()((set) => ({
  run: initialRun(useCreateStore.getState().intent()),
  pending: [],
  pickedUp: 0,
  dispatch: (event) => set((s) => ({ run: runReducer(s.run, event) })),
  setPending: (pending) => set({ pending }),
  setPickedUp: (pickedUp) => set({ pickedUp }),
}))

export function refreshPending(): void {
  const st = useRunStore.getState()
  const pending = pendingCloudJobs()
  const same = pending.length === st.pending.length && pending.every((p, i) => p.id === st.pending[i]?.id)
  if (!same) st.setPending(pending)
  if (pending.length === 0 && st.pickedUp !== 0) st.setPickedUp(0)
}

/** Ask the account for the credits again. Failures keep the old number. */
export async function refreshQuota(): Promise<void> {
  try {
    useCloudAuthStore.getState().setQuota(await getQuota())
  } catch {
    /* the number on screen stays until the next answer */
  }
}

/** Fetch the results of jobs that were booked before the app went away. */
export function resumeNow(): void {
  if (!isOnline()) return
  if (useCloudAuthStore.getState().status !== 'signed-in') return
  refreshPending()
  if (pendingCloudJobs().length === 0) return
  void resumeCloudJobsNow().finally(refreshPending)
}

let installed = false
/** One run says at most once that its prompt was not improved, however many pictures it makes. */
let saidImproveFailed = false

/** Start the module level followers once. Safe to call from every render of Create. */
export function installCreateServices(): void {
  if (installed) return
  installed = true
  const store = useCreateStore.getState()
  // A phone has no local track. The store says so itself on a phone; this covers a browser preview too.
  if (store.backend !== 'cloud') store.setBackend('cloud')
  if (useCreateStore.getState().backend !== 'cloud') useCreateStore.setState({ backend: 'cloud' })

  const run = useRunStore.getState()
  run.dispatch({ type: 'tool', tool: store.intent() })

  // Follow the cloud hook through the create store.
  useCreateStore.subscribe((state, prev) => {
    const { dispatch } = useRunStore.getState()
    // intent() reads the live store, so the tool before the change is derived from the old fields.
    const tool = deriveIntent(state)
    if (tool !== deriveIntent(prev)) dispatch({ type: 'tool', tool })
    if (state.isGenerating && !prev.isGenerating) {
      saidImproveFailed = false
      dispatch({ type: 'start', at: Date.now() })
    }
    if (state.gallery !== prev.gallery) {
      const before = new Set(prev.gallery.map((g) => g.id))
      const fresh = state.gallery.filter((g) => !before.has(g.id))
      // Results of the run in flight go onto the stage; results of an older job are announced by the resume pass.
      if (state.isGenerating || prev.isGenerating) {
        for (const g of [...fresh].reverse()) dispatch({ type: 'landed', id: g.id })
        // "Improve my prompt" was on and the helper did not answer: the run went on with the
        // own prompt, and the user hears it once instead of wondering about the result.
        if (!saidImproveFailed && fresh.some((g) => g.improveFailed)) {
          saidImproveFailed = true
          toast(T.improveFailed, { testid: 'create-improve-failed' })
        }
      }
      const now = new Set(state.gallery.map((g) => g.id))
      for (const g of prev.gallery) if (!now.has(g.id)) dispatch({ type: 'removed', id: g.id })
    }
    if (state.error !== prev.error) {
      if (state.error) dispatch({ type: 'error', message: state.error })
      else dispatch({ type: 'dismiss-error' })
    }
    if (!state.isGenerating && prev.isGenerating) {
      dispatch({ type: 'end' })
      refreshPending()
      void refreshQuota()
      // The run gave up waiting (its deadline, a dead line) but the job is still booked:
      // keep asking in the background, so the result lands without the user doing anything.
      if (pendingCloudJobs().length > 0) window.setTimeout(resumeNow, 0)
    }
  })

  // Jobs from before the restart.
  const found = pendingCloudJobs()
  useRunStore.getState().setPending(found)
  if (found.length > 0 && !store.isGenerating) useRunStore.getState().setPickedUp(found.length)

  onJobsLanded((summary) => {
    refreshPending()
    void refreshQuota()
    const { dispatch, run: current } = useRunStore.getState()
    if (summary.landed.length > 0) {
      const first = summary.landed[0]
      const inGallery = useCreateStore.getState().gallery.some((g) => g.id === first)
      if (inGallery && current.view !== 'running') dispatch({ type: 'show', id: first })
      toast(summary.landed.length === 1 ? T.resultReady : T.resultsReady(summary.landed.length), {
        testid: 'create-resumed',
        action: inGallery ? { label: T.view, onPress: () => nav.push('/create/item/:id', { id: first }) } : undefined,
      })
      return true
    }
    if (summary.failed.length > 0) {
      toast(T.resumedFailed, { tone: 'error', testid: 'create-resumed-failed' })
      return true
    }
    return false
  })

  // The account may still be asked when Create opens: try again once it is known.
  useCloudAuthStore.subscribe((state, prev) => {
    // Signed out: the photos and words of this account do not stay on the phone.
    if (state.status === 'signed-out' && prev.status === 'signed-in') void forgetCreateDraft()
    if (state.status === 'signed-in' && prev.status !== 'signed-in') {
      resumeNow()
      if (useCloudAuthStore.getState().licenseActive) void refreshCatalog()
    }
  })
  resumeNow()
  // Prompt and inputs of the last visit come back (parts/draft.ts).
  void installCreateDraft()
}

/** Test seam: forget that the followers were started. The subscriptions of an earlier start stay, so only tests use it. */
export function __resetCreateServicesForTests(): void {
  installed = false
  useRunStore.setState({ run: initialRun('image'), pending: [], pickedUp: 0 })
}
