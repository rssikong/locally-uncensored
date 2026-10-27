/**
 * Sheet "agent-add-step" (E10.6): the six kinds of step. Picking one adds
 * the step to the workflow that is being built and opens its form.
 * Opened with nav.openSheet('agent-add-step', { workflowId }).
 */
import { Brain, GitBranch, MessageCircleQuestion, MessageSquare, Repeat, Wrench } from 'lucide-react'
import type { WorkflowStepType } from '../../../types/agent-workflows'
import { nav, useSheet } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { ListGroup, Notice, Row, Sheet, type IconType } from '../../ui'
import './parts/agent.css'
import { useWorkflowDraft } from './parts/workflow-draft'
import { STEP_KINDS } from './parts/workflow-logic'

const S = T.workflows

const ICONS: Record<WorkflowStepType, IconType> = {
  prompt: MessageSquare,
  tool: Wrench,
  user_input: MessageCircleQuestion,
  condition: GitBranch,
  loop: Repeat,
  memory_save: Brain,
}

export interface AddStepProps {
  workflowId: string
}

export default function AddStepSheet() {
  const sheet = useSheet<AddStepProps | undefined>()
  const workflowId = sheet.props?.workflowId ?? ''
  const known = useWorkflowDraft((s) => !!s.drafts[workflowId])

  const add = (kind: WorkflowStepType) => {
    const stepId = useWorkflowDraft.getState().addStep(workflowId, kind)
    if (!stepId) return
    // push closes the sheet and opens the form of the new step.
    nav.push('/settings/workflows/:id/step/:stepId', { id: workflowId, stepId })
  }

  return (
    <Sheet title={S.addSheet.title}>
      {!known ? (
        <Notice variant="warn" testid="m-add-step-gone">
          {S.editor.gone}
        </Notice>
      ) : (
        <ListGroup testid="m-add-step-kinds">
          {STEP_KINDS.map((kind) => (
            <Row key={kind} title={S.kinds[kind]} subtitle={S.kindHints[kind]} icon={ICONS[kind]} onPress={() => add(kind)} testid={`m-add-step-${kind}`} el="E10.6" />
          ))}
        </ListGroup>
      )}
    </Sheet>
  )
}
