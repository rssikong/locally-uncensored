import { Play } from 'lucide-react'
import { workflowsForThisDevice } from '../../../../../lib/mobile-tools'
import { useAgentWorkflowStore } from '../../../../../stores/agentWorkflowStore'
import type { AgentWorkflow } from '../../../../../types/agent-workflows'
import { nav, useSheet } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, EmptyState, ListGroup, Notice, Row, Sheet, toast } from '../../../../ui'
import { useChatSend, wasSent } from '../adapters/chat-send'
import { firstQuestion, workflowCommand } from '../workflow-logic'
import type { ChatSettings } from './chat-settings'

const S = T.options.workflowsPage

/** C5.11: the workflows of this phone. A tap starts one in this chat. */
export function WorkflowsPage({ chat }: { chat: ChatSettings }) {
  const sheet = useSheet()
  const sender = useChatSend(chat.key)
  const all = useAgentWorkflowStore((s) => s.workflows)
  const workflows = workflowsForThisDevice(all)
  const blocked = !chat.saved ? T.options.needsSavedChat : !chat.agentOn ? S.needsAgent : sender.busy ? S.busy : null

  const run = async (workflow: AgentWorkflow) => {
    let input: string | undefined
    const question = firstQuestion(workflow)
    if (question !== null) {
      const answer = await nav.prompt({ title: S.askTitle(workflow.name), text: question || undefined, confirmLabel: S.askConfirm, field: { label: S.askLabel }, testid: 'workflow-input' })
      if (answer === null) return
      input = answer
    }
    const outcome = await sender.send(workflowCommand(workflow.name, input))
    if (wasSent(outcome)) {
      toast(S.started(workflow.name), { testid: 'workflow-started' })
      sheet.close()
    }
  }

  return (
    <Sheet title={S.title}>
      {chat.saved && !chat.agentOn ? (
        <Notice
          variant="info"
          testid="m-options-workflows-needs-agent"
          actions={
            <Button compact onPress={() => chat.setAgent(true)} testid="m-options-workflows-agent-on">
              {S.turnOnAgent}
            </Button>
          }
        >
          {S.needsAgent}
        </Notice>
      ) : null}
      {workflows.length === 0 ? (
        <EmptyState title={S.empty} testid="m-options-workflows-empty">
          {S.emptyText}
        </EmptyState>
      ) : (
        <ListGroup testid="m-options-workflows">
          {workflows.map((workflow) => (
            <Row
              key={workflow.id}
              title={workflow.name}
              subtitle={workflow.description || S.steps(workflow.steps.length)}
              icon={Play}
              label={S.runName(workflow.name)}
              chevron={false}
              disabled={!!blocked}
              disabledReason={blocked ?? undefined}
              onPress={() => void run(workflow)}
              testid={`m-options-workflow-${workflow.id}`}
              el="C5.11"
            />
          ))}
        </ListGroup>
      )}
      <ListGroup>
        <Row title={S.manage} onPress={() => nav.push('/settings/workflows')} testid="m-options-workflows-manage" el="C5.11" />
      </ListGroup>
    </Sheet>
  )
}
