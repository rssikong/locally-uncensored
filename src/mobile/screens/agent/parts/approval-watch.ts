/**
 * Opens "Allow this step?" (C12) by itself when a run of this chat waits for
 * an answer, and reads a sheet that went away without an answer as "Deny".
 *
 * The queue of waiting steps lives at module scope in src/lib/approval-queue.ts,
 * keyed by conversation, so it does not matter which copy of the chat hook
 * started the run. This watcher is mounted with the notice slot of the chat
 * page, that is: for as long as the chat is open.
 */
import { useEffect, useRef } from 'react'
import { dequeueApproval, headApproval, subscribeApprovals } from '../../../../lib/approval-queue'
import { nav, useNavState } from '../../../nav'

type Overlays = ReturnType<typeof nav.getState>['overlays']

export interface ApprovalSheetProps {
  chatId: string
}

export type WatchStep = { do: 'open' } | { do: 'deny' } | { do: 'nothing' }

/**
 * Pure: what the watcher does next.
 *   headId      the step that waits, or null
 *   sheetOpen   is the approval sheet of this chat on the stack
 *   shownFor    the step the sheet was last seen open for, or null
 */
export function nextWatchStep(headId: string | null, sheetOpen: boolean, shownFor: string | null): WatchStep {
  if (!headId || sheetOpen) return { do: 'nothing' }
  // The sheet was open for exactly this step and is gone, and the step still waits: back means Deny.
  if (shownFor === headId) return { do: 'deny' }
  return { do: 'open' }
}

function approvalSheetOpen(overlays: Overlays, chatId: string): boolean {
  return overlays.some((o) => o.kind === 'sheet' && o.sheet === 'approval' && (o.props as ApprovalSheetProps | undefined)?.chatId === chatId)
}

export function useApprovalWatch(chatId: string): void {
  const overlays = useNavState((s) => s.overlays)
  const shownFor = useRef<string | null>(null)

  useEffect(() => {
    const sync = () => {
      const head = headApproval(chatId)
      // Read the stack as it is now, not as it was at render: this runs right after it opened the sheet, too.
      const open = approvalSheetOpen(nav.getState().overlays, chatId)
      if (!head) {
        shownFor.current = null
        return
      }
      if (open) {
        shownFor.current = head.id
        return
      }
      const step = nextWatchStep(head.id, open, shownFor.current)
      if (step.do === 'deny') {
        shownFor.current = null
        dequeueApproval(chatId)?.resolve(false)
        return
      }
      if (step.do === 'open') {
        shownFor.current = head.id
        const props: ApprovalSheetProps = { chatId }
        nav.openSheet('approval', props)
      }
    }
    sync()
    return subscribeApprovals(sync)
    // `overlays` is a dependency on purpose: a sheet that closed is what "back means Deny" hangs on.
  }, [chatId, overlays])
}
