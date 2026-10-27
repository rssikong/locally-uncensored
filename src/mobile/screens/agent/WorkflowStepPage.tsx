/**
 * E10.5 Workflow step. Route /settings/workflows/:id/step/:stepId, page,
 * strand 2 (Agent and knowledge).
 *
 * The form of one step of the workflow that is being built. The form itself
 * is parts/WorkflowStepForm.tsx; this file is its place in the route table.
 */
import { useParams } from '../../nav'
import { WorkflowStepForm } from './parts/WorkflowStepForm'

export default function WorkflowStepPage() {
  const { id, stepId } = useParams<{ id: string; stepId: string }>()
  return <WorkflowStepForm id={id} stepId={stepId} />
}
