// "Improve my prompt": the runner. One small chat call on the chat model the
// user has picked, local or cloud, through the same provider a chat turn uses.
// In Cloud mode without a picked chat model it runs on the fixed helper model
// (lib/cloud-helper-model), so the switch is never a dead end there.
// On LU Cloud it is metered and billed like chat; on a local model it costs
// nothing. It never throws: any failure answers `failed`, and the run goes on
// with the user's own prompt.
//
// Unlike the silent calls (memory extraction), this one is asked for: the user
// switched it on in Create, so it runs on the picked chat model as it is and
// needs no second opt-in.

import { getProviderForModel, getProviderIdFromModel } from '../../api/providers'
import { useModelStore } from '../../stores/modelStore'
import { platformText } from '../platform-text'
import { useSettingsStore } from '../../stores/settingsStore'
import { isThinkingCompatible } from '../model-compatibility'
import { runInLane } from '../run-slot'
import { helperModelFor, currentHelperModel } from '../cloud-helper-model'
import type { AppMode } from '../../types/settings'
import { laneOf, currentLaneFacts } from '../run-lane-of-model'
import {
  IMPROVE_MAX_TOKENS, IMPROVE_TIMEOUT_MS, buildImproveMessages, cleanImproved,
  type ImproveOutcome, type ImproveTarget,
} from './improve-prompt'

export interface ImproveAvailability {
  available: boolean
  /** What the switch's tooltip says: what it does, or why it cannot be used. */
  hint: string
}

const HINT_LOCAL = platformText('improveHintLocal')
const HINT_CLOUD = 'Your chat model rewrites your prompt for the model you picked. Billed like a short chat message.'
const HINT_CLOUD_HELPER = 'A small LU Cloud model rewrites your prompt for the model you picked. Billed like a short chat message.'

/** Can a rewrite run with this chat model? It needs one to write with: the
 *  picked one, or in Cloud mode the helper model. */
export function improveAvailabilityFor(activeModel: string | null, appMode?: AppMode): ImproveAvailability {
  const writer = helperModelFor(activeModel, appMode)
  if (!writer) return { available: false, hint: 'Pick a chat model in Chat first.' }
  if (!activeModel) return { available: true, hint: HINT_CLOUD_HELPER }
  const cloud = getProviderIdFromModel(writer) === 'lu-cloud'
  return { available: true, hint: cloud ? HINT_CLOUD : HINT_LOCAL }
}

/** The same answer, kept current while the user picks another chat model or
 *  flips the Cloud switch. */
export function useImproveAvailability(): ImproveAvailability {
  return improveAvailabilityFor(
    useModelStore((s) => s.activeModel),
    useSettingsStore((s) => s.settings.appMode),
  )
}

/** The turn id the rewrite books its place under. Its own, so it queues behind
 *  a chat turn on the local card instead of racing it. */
const IMPROVE_TURN = 'create::improve-prompt'

/** Rewrite `prompt` for `target` with the user's chat model. */
export async function improvePrompt(
  prompt: string,
  target: ImproveTarget,
  signal?: AbortSignal,
): Promise<ImproveOutcome> {
  const { models } = useModelStore.getState()
  const activeModel = currentHelperModel()
  if (!activeModel || signal?.aborted) return { status: 'failed' }
  try {
    const { provider, modelId } = getProviderForModel(activeModel)
    const meta = models.find((m) => m.name === activeModel)
    const thinkMode = meta && 'thinkMode' in meta ? meta.thinkMode : undefined
    const canThink = thinkMode ? thinkMode === 'toggle' : isThinkingCompatible(activeModel)
    const effortLevels = meta && 'effortLevels' in meta ? meta.effortLevels : undefined
    const effortDefault = meta && 'effortDefault' in meta ? meta.effortDefault : undefined
    const lane = laneOf(activeModel, currentLaneFacts())
    // A local model may have to load first, so it gets twice the time.
    const limit = lane === 'local' ? IMPROVE_TIMEOUT_MS * 2 : IMPROVE_TIMEOUT_MS
    // The call ends on its own, on the user's Cancel, or after the time limit.
    // The last two also drop a stream that does not answer the abort.
    const own = new AbortController()
    let stop: () => void = () => {}
    const stopped = new Promise<false>((resolve) => { stop = () => { own.abort(); resolve(false) } })
    signal?.addEventListener('abort', stop)
    let timer: ReturnType<typeof setTimeout> | undefined
    let text = ''
    let ran = false
    const run = runInLane(
      { conversationId: IMPROVE_TURN, lane, abort: () => stop() },
      async () => {
        if (own.signal.aborted) return
        // The clock starts when the call does, not while it waits behind a
        // chat turn on the local card.
        timer = setTimeout(stop, limit)
        const read = (async () => {
          const stream = provider.chatStream(modelId, buildImproveMessages(target, prompt), {
            temperature: 0.4,
            maxTokens: IMPROVE_MAX_TOKENS,
            // A model that can switch its reasoning off gets it off, one that
            // cannot gets the lowest rung. A rewrite has no use for a long think.
            thinking: canThink ? false : undefined,
            reasoningEffort: 'low',
            effortLevels,
            effortDefault,
            signal: own.signal,
          })
          for await (const chunk of stream) {
            if (chunk.content) text += chunk.content
            if (chunk.done) break
          }
          return true as const
        })()
        read.catch(() => {})
        // A stopped call gives the lane back at once, answered or not.
        ran = await Promise.race([read, stopped])
      },
    ).then((outcome) => outcome === 'ran' && ran)
    run.catch(() => {})
    let finished = false
    try {
      finished = await Promise.race([run, stopped])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
    }
    if (!finished) return { status: 'failed' }
    const cleaned = cleanImproved(text)
    if (!cleaned) return { status: 'failed' }
    if (cleaned === prompt.trim()) return { status: 'unchanged' }
    return { status: 'improved', prompt: cleaned }
  } catch {
    return { status: 'failed' }
  }
}
