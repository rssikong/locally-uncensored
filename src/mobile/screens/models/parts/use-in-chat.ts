/**
 * "Use in chat" (M1.9, M2.3): make a model on this phone the chat model.
 *
 * Goes through hooks/useModels, the same door the model sheet of the chat
 * uses: it sets the active model and loads it into the engine. Said only
 * after it is true: the toast comes when the store really holds the model.
 *
 * A tap is never dropped. While another model is still loading (or being
 * unloaded) the engine cannot take a second order, so the wish is kept
 * (`queued` in the engine state of this strand), the card says "Loads after
 * ...", and the wish runs the moment the engine is free. The last tap wins.
 * Until round 5 the button was grey for that time without a word, and a tap
 * on it did nothing (acceptance Android, re-run, N2).
 */
import { useCallback } from 'react'
import { SWAP_WATCH_MS, luEngineSwapInFlight } from '../../../../api/lu-engine-swap-lock'
import { useModels } from '../../../../hooks/useModels'
import { useModelStore } from '../../../../stores/modelStore'
import { nav } from '../../../nav'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { cloudIsOn, leaveCloud } from '../../settings/parts/cloud-mode'
import { toast } from '../../../ui'
import { refreshEngineStatus, useEngineUi } from './engine'
import { chatModelId, displayName } from './installed'

export interface ChatModelFile {
  name: string
  path: string
}

/** The two calls of the logic layer this needs. Handed in by the hook, replaced in tests. */
export interface UseInChatDoors {
  setActiveModel: (id: string) => Promise<void> | void
  fetchModels: () => Promise<unknown>
}

export type UseInChatOutcome = 'done' | 'failed' | 'queued' | 'superseded'

/**
 * Make `file` the chat model, or keep the wish while the engine is busy.
 *
 *   done        it is the chat model now
 *   failed      the load did not work, said on screen
 *   queued      the engine is busy, the wish runs after that
 *   superseded  it ran, but meanwhile the user asked for another model: nothing is said, the other one follows
 */
export async function makeChatModel(file: ChatModelFile, doors: UseInChatDoors): Promise<UseInChatOutcome> {
  const ui = useEngineUi.getState()
  if (ui.busy) {
    ui.setQueued({ name: file.name, path: file.path })
    return 'queued'
  }
  // The engine is in the middle of a swap that this page did not start (the model sheet of the chat, or a
  // load that hangs on a model that is too large for the phone). The logic layer then takes no second order
  // and says so in a place the phone does not show: the tap ended as "could not be loaded" or as nothing
  // (small iPhone, K15). The wish is kept like any other and runs when the swap is over.
  if (luEngineSwapInFlight()) {
    ui.setQueued({ name: file.name, path: file.path })
    watchSwap()
    return 'queued'
  }
  const id = chatModelId(file.name)
  const name = displayName(file)
  ui.setQueued(null)
  ui.setBusy({ name, kind: 'loading' })
  ui.setFailure(null)
  ui.setUnloaded(null)
  try {
    // A model that was installed a moment ago may not be in the chat's list yet.
    if (!useModelStore.getState().models.some((m) => m.name === id)) await doors.fetchModels().catch(() => {})
    // On device models belong to the on device mode.
    if (cloudIsOn()) leaveCloud({ quiet: true })
    await doors.setActiveModel(id)
  } catch {
    // Whatever went wrong on the way: it is said below, the tap never ends without a word.
  } finally {
    useEngineUi.getState().setBusy(null)
  }
  // Read before the first await: the wish that waited starts in the next moment (drain below).
  const superseded = !!useEngineUi.getState().queued
  await refreshEngineStatus().catch(() => null)
  if (superseded) return 'superseded'
  const active = useModelStore.getState().activeModel === id
  if (active) {
    // Said, and with the way on: the user stays on Models (DESIGN.md M1.9), where a toast of three
    // seconds and a small mark on the card were all that told him the model is chosen, and the chat
    // was two taps away (acceptance on the large iPhone, G10). One tap on the toast opens a new chat
    // with this model. Not during the onboarding: there the flow itself leads on.
    toast(S.models.nowChatModel(name), {
      testid: 'chat-model',
      action: nav.getState().flow ? undefined : { label: S.models.openNewChat, onPress: () => nav.resetTo('chat', [{ route: '/chat/:id', params: { id: 'new' } }]) },
    })
    return 'done'
  }
  // The logic layer says why in its own store; the engine page shows it (G10).
  toast(S.notices.failedName(name), { tone: 'error', testid: 'load-failed', action: { label: S.notices.details, onPress: () => nav.push('/settings/engine') } })
  return 'failed'
}

let doorsNow: UseInChatDoors | null = null
let draining = false

/** Start what waits, once the engine is free. Whoever made it busy: this strand's load, unload or restart. */
function drain(): void {
  const ui = useEngineUi.getState()
  if (ui.busy || !ui.queued || !doorsNow) return
  const next = ui.queued
  const doors = doorsNow
  // After the function that just ended has read its result, not in the middle of it.
  queueMicrotask(() => {
    const now = useEngineUi.getState()
    if (now.busy || now.queued !== next) return
    // The model the wish names may have become the chat model by another way meanwhile.
    if (useModelStore.getState().activeModel === chatModelId(next.name)) {
      now.setQueued(null)
      return
    }
    void makeChatModel(next, doors).catch(() => {})
  })
}

let swapWatch: ReturnType<typeof setInterval> | null = null

/** A swap this page did not start has no event for its end: look until it is over, then start what waits. */
function watchSwap(): void {
  if (swapWatch) return
  swapWatch = setInterval(() => {
    if (luEngineSwapInFlight()) return
    if (swapWatch) clearInterval(swapWatch)
    swapWatch = null
    drain()
  }, SWAP_WATCH_MS)
}

function wire(doors: UseInChatDoors): void {
  doorsNow = doors
  if (draining) return
  draining = true
  useEngineUi.subscribe((state, before) => {
    if (!state.busy && (before.busy || state.queued !== before.queued)) drain()
  })
}

export function useUseInChat(): (file: ChatModelFile) => Promise<boolean> {
  const { setActiveModel, fetchModels } = useModels()
  // The page may be gone when the wish runs (a tab switch unmounts it): the doors of the last render stay.
  wire({ setActiveModel, fetchModels })
  return useCallback(
    async (file) => (await makeChatModel(file, doorsNow ?? { setActiveModel, fetchModels })) === 'done',
    // setActiveModel and fetchModels are new on every render and always do the same.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
}

/** Only for tests. */
export function __setUseInChatDoorsForTests(doors: UseInChatDoors | null): void {
  if (doors) wire(doors)
  else doorsNow = null
}

export function useActiveChatModel(): string | null {
  return useModelStore((s) => s.activeModel)
}
