/**
 * Says it when the app changed the chat model by itself.
 *
 * The logic layer announces such a change into one store
 * (stores/luEngineSwitchStore.ts): the chosen model left the list and another
 * one took its place, or the engine could not start with it. On the desktop a
 * line in the model menu shows the sentence. The phone has no such line in
 * the frame, so the shell shows it as a toast, once per announcement, and
 * marks it as seen. A strand that draws the sentence in its own screen reads
 * the same store; nothing is taken away from it here.
 *
 * One exception (short check on Android, package 8): a failed start is said
 * by the chat itself, in its notice with "Pick another model"
 * (resilience/EngineNotices.tsx). On a page that shows that notice the toast
 * would say the same long sentence a second time, and on a small phone it
 * found no free room and lay on the send button for seconds. So while that
 * notice is on screen there is no toast, and a toast that shows goes when the
 * user comes to such a page.
 */
import { useEffect } from 'react'
import { useLuEngineSwitchStore } from '../../stores/luEngineSwitchStore'
import { useNavStore } from '../nav/store'
import { toast, useToastStore } from '../ui/Toast'

const NOTE_TOAST = 'model-note'

/** Pure over the page: does the page on top show the notice of the engine about a failed start. */
export function pageSaysTheFailure(root: ParentNode = document): boolean {
  // The page on top, as the toast itself finds it (ui/Toast.tsx): the last one of the stack that is not hidden or leaving.
  const pages = root.querySelectorAll('.m-stack > .m-page:not([data-m-hidden]):not([data-m-exit])')
  const top = pages[pages.length - 1]
  if (!top) return false
  for (const el of top.querySelectorAll('[data-testid="m-engine-notice-failed"], [data-testid="m-settings-engine-notice-failed"]')) {
    if (el.closest('[inert], [aria-hidden="true"]')) continue
    if (el instanceof HTMLElement && el.getClientRects().length === 0) continue
    return true
  }
  return false
}

export function ModelNotes() {
  const note = useLuEngineSwitchStore((s) => s.note)
  const tone = useLuEngineSwitchStore((s) => s.tone)
  const generation = useLuEngineSwitchStore((s) => s.generation)

  useEffect(() => {
    if (!note) return
    useLuEngineSwitchStore.getState().alsGesehenMarkieren()
    if (tone === 'error' && pageSaysTheFailure()) return
    toast(note, { tone: tone === 'error' ? 'error' : 'default', testid: NOTE_TOAST })
    // generation: the same sentence announced twice is two announcements.
  }, [note, tone, generation])

  // The user comes to a page that says the failure itself while the toast still shows: the toast goes.
  useEffect(() => {
    if (!note || tone !== 'error') return
    let frame = 0
    const look = () => {
      frame = 0
      const shown = useToastStore.getState().current
      if (shown?.testid === NOTE_TOAST && pageSaysTheFailure()) useToastStore.getState().dismiss(shown.id)
    }
    // In the frame the page changed in, and once more when the new page stands.
    let settled = 0
    const later = () => {
      if (!frame) frame = window.requestAnimationFrame(look)
      window.clearTimeout(settled)
      settled = window.setTimeout(look, 350)
    }
    const stop = useNavStore.subscribe(later)
    return () => {
      stop()
      window.clearTimeout(settled)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [note, tone, generation])

  return null
}
