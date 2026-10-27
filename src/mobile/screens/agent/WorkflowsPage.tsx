/**
 * E10 Workflows. Route /settings/workflows, page, strand 2 (Agent and knowledge).
 *
 * The workflows this phone can run (lib/mobile-tools decides: the built in
 * Code Review and everything that needs a tool a phone does not have are
 * left out) and the way into the builder (WorkflowEditPage).
 */
import { useEffect } from 'react'
import { Plus, Workflow } from 'lucide-react'
import { workflowsForThisDevice } from '../../../lib/mobile-tools'
import { useAgentWorkflowStore } from '../../../stores/agentWorkflowStore'
import { nav, useIsTop } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, EmptyState, ListGroup, Page, Row } from '../../ui'
import './parts/agent.css'
import { useWorkflowDraft } from './parts/workflow-draft'
import { NEW_WORKFLOW } from './parts/workflow-logic'

const S = T.workflows

export default function WorkflowsPage() {
  const all = useAgentWorkflowStore((s) => s.workflows)
  const workflows = workflowsForThisDevice(all)
  const hidden = all.filter((w) => !w.isBuiltIn).length - workflows.filter((w) => !w.isBuiltIn).length
  const isTop = useIsTop()

  // Back on the list: the builder was left, so what it held unsaved is gone.
  useEffect(() => {
    if (isTop) useWorkflowDraft.getState().discardAll()
  }, [isTop])

  return (
    <Page
      title={S.title}
      screen="settings-workflows"
      footer={
        <Button variant="primary" block icon={Plus} onPress={() => nav.push('/settings/workflows/:id', { id: NEW_WORKFLOW })} testid="m-workflows-add" el="E10.2">
          {S.add}
        </Button>
      }
    >
      {workflows.length === 0 ? (
        <EmptyState title={S.empty} icon={Workflow} testid="m-workflows-empty">
          {S.emptyText}
        </EmptyState>
      ) : (
        <ListGroup testid="m-workflows-list">
          {workflows.map((workflow) => (
            <Row
              key={workflow.id}
              title={workflow.name}
              subtitle={workflow.description || S.steps(workflow.steps.length)}
              value={workflow.isBuiltIn ? S.builtIn : undefined}
              label={S.rowName(workflow.name)}
              onPress={() => nav.push('/settings/workflows/:id', { id: workflow.id })}
              testid={`m-workflows-row-${workflow.id}`}
              el="E10.1"
            />
          ))}
        </ListGroup>
      )}
      {hidden > 0 ? (
        <p className="m-ag-text" data-testid="m-workflows-hidden">
          {S.notHere(hidden)}
        </p>
      ) : null}
    </Page>
  )
}
