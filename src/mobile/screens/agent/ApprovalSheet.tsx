/**
 * C12 Allow this step?. Sheet "approval", strand 2 (Agent and knowledge).
 *
 * It opens by itself: the notice slot of the chat page watches the queue of
 * waiting steps (parts/approval-watch.ts) and calls
 * nav.openSheet('approval', { chatId }). The sheet is locked: no scrim tap,
 * no pulling down, no Close. Back closes it, and a sheet that closed without
 * an answer is read as Deny by the same watcher.
 *
 * Elements: C12.1 "Allow" (main button), C12.2 "Deny", C12.3 "Always allow
 * in this chat" (sets the group to Auto for this chat), C12.4 "Details".
 */
import { useSyncExternalStore } from 'react'
import { ShieldQuestion } from 'lucide-react'
import { dequeueApproval, headApproval, subscribeApprovals } from '../../../lib/approval-queue'
import { haptic } from '../../platform'
import { useSheet } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, Icon, Sheet, toast } from '../../ui'
import './parts/agent.css'
import type { ApprovalSheetProps } from './parts/approval-watch'
import { Fold } from './parts/Fold'
import { groupById, setChatLevel } from './parts/permission-groups'
import { argLines, groupOfTool, toolTarget, toolTitle } from './parts/tool-words'

function useHead(chatId: string | undefined) {
  return useSyncExternalStore(
    subscribeApprovals,
    () => headApproval(chatId),
    () => null,
  )
}

export default function ApprovalSheet() {
  const sheet = useSheet<ApprovalSheetProps | undefined>()
  const chatId = sheet.props?.chatId
  const call = useHead(chatId)

  if (!call || !chatId) {
    return (
      // Nothing waits: the run was stopped, or the sheet came back from a restart. Say so and offer the way out.
      <Sheet
        title={T.approval.title}
        footer={
          <Button block onPress={() => sheet.close()} testid="m-approval-close">
            {T.common.close}
          </Button>
        }
      >
        <p className="m-ag-sheet-text" data-testid="m-approval-gone">
          {T.approval.gone}
        </p>
      </Sheet>
    )
  }

  const answer = (approved: boolean) => {
    haptic('light')
    // Only answer the step this sheet shows. The queue may have moved on.
    if (headApproval(chatId)?.id === call.id) dequeueApproval(chatId)?.resolve(approved)
    if (!approved) toast(T.approval.denied, { testid: 'approval-denied' })
    // The next step, if one waits, is shown by this same sheet. When none does, the sheet has done its work.
    if (!headApproval(chatId)) sheet.close()
  }

  const groupId = groupOfTool(call.toolName)
  const group = groupId ? groupById(groupId) : null
  const target = toolTarget(call.toolName, call.args)
  const lines = argLines(call.args, 2000)

  return (
    <Sheet
      title={T.approval.title}
      footer={
        <div className="m-ag-buttons">
          <Button variant="primary" block onPress={() => answer(true)} testid="m-approval-allow" el="C12.1">
            {T.approval.allow}
          </Button>
          <Button block onPress={() => answer(false)} testid="m-approval-deny" el="C12.2">
            {T.approval.deny}
          </Button>
          {group?.perChat ? (
            <Button
              variant="quiet"
              block
              onPress={() => {
                if (setChatLevel(chatId, group, 'auto')) toast(T.approval.alwaysDone(group.title), { testid: 'approval-always' })
                answer(true)
              }}
              testid="m-approval-always"
              el="C12.3"
            >
              {T.approval.always}
            </Button>
          ) : null}
        </div>
      }
    >
      <div className="m-ag-approve-what" data-testid="m-approval-what">
        <div className="m-rowh">
          <Icon icon={ShieldQuestion} />
          <strong>{toolTitle(call.toolName)}</strong>
        </div>
        <span data-testid="m-approval-target">{target || T.approval.noTarget}</span>
        {call.parentToolCallId ? <span className="m-cap">{T.approval.fromSubAgent}</span> : null}
      </div>
      <div className="m-ag-block">
        <Fold title={T.approval.details} testid="m-approval-details" el="C12.4">
          {() => (
            <>
              <div className="m-ag-kv">
                <span>{T.tools.technicalName}</span>
                <span className="m-mono">{call.toolName}</span>
              </div>
              {lines.length > 0 ? (
                <div className="m-ag-kv">
                  <span>{T.tools.input}</span>
                  <pre className="m-ag-pre" data-testid="m-approval-input">
                    {lines.map((l) => `${l.key}: ${l.value}`).join('\n')}
                  </pre>
                </div>
              ) : null}
            </>
          )}
        </Fold>
      </div>
    </Sheet>
  )
}
