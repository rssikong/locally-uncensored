// Motion Control with a workflow of the user's own: the run takes the
// workflow's own steps, guidance, sampler, size and length
// (api/workflows.ts injectLaneParameters) and only fills the model, the
// prompts, the seed, the picture and the clip. The sliders of the tab set
// nothing there, so the tab hides them and points to the workflow's list.
//
// The same pick as hooks/useCreate.ts: the Motion Control model the lane
// runs (resolveLocalOpPick), its type by name, and the workflow the
// workflow store pairs with it. Local ComfyUI only: the Mac runs MLX and
// no workflow, the cloud runs neither.

import { classifyModel, resolveLocalOpPick } from '../../../api/comfyui'
import { isMlxImageHost } from '../../../api/mlx-image'
import { useCreateStore } from '../../../stores/createStore'
import { useWorkflowStore } from '../../../stores/workflowStore'
import type { WorkflowTemplate } from '../../../types/workflows'

/** The workflow a Motion Control run would take in place of LU's graph, or null. */
export function useMotionOwnWorkflow(): WorkflowTemplate | null {
  const intent = useCreateStore((s) => s.intent())
  const backend = useCreateStore((s) => s.backend)
  const localOpModel = useCreateStore((s) => s.localOpModel)
  const motionModels = useCreateStore((s) => s.motionModelList)
  const active = intent === 'motion' && backend === 'local' && !isMlxImageHost()
  const model = active ? resolveLocalOpPick(localOpModel, motionModels) : ''
  return useWorkflowStore((s) => (model ? s.getWorkflowForModel(model, classifyModel(model)) : null))
}

/** The line the tab shows where its sliders were. */
export const MOTION_OWN_WORKFLOW_NOTE =
  'Steps, guidance, size and length come from your workflow. Change them under Workflow parameters in Advanced settings.'
