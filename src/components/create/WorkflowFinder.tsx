import { Workflow } from 'lucide-react'
import { isInstalledVideoType, type ModelType } from '../../api/comfyui'
import { useWorkflowStore } from '../../stores/workflowStore'
import { Select } from './ui/Select'

interface Props {
  modelName: string
  modelType: ModelType
}

export function WorkflowFinder({ modelName, modelType }: Props) {
  const {
    tags,
    workflowTags,
    getWorkflowForModel,
    getMatchingWorkflows,
    assignToModelName,
    unassignModelName,
    unassignModelType,
  } = useWorkflowStore()

  // The Models view of the Workflows window files a Motion Control or Talking
  // Character model under Video (the inventory does), so its tags live there.
  const mode = isInstalledVideoType(modelType) ? 'video' : 'image'
  const matchingWorkflows = getMatchingWorkflows(modelName, mode)
  const activeWorkflow = getWorkflowForModel(modelName, modelType)

  const selectedWorkflow =
    activeWorkflow && matchingWorkflows.some((workflow) => workflow.id === activeWorkflow.id)
      ? activeWorkflow
      : null

  const handleSelection = (workflowId: string) => {
    if (!workflowId) {
      unassignModelName(modelName)
      unassignModelType(modelType)
      return
    }
    // A specific model selection beats any legacy model-type-wide assignment.
    unassignModelType(modelType)
    assignToModelName(modelName, workflowId)
  }

  return (
    <div>
      <label className="mb-1.5 flex items-center gap-1.5 t-label text-gray-500">
        <Workflow size={12} />
        Workflow
      </label>

      {matchingWorkflows.length > 0 ? (
        <Select
          value={selectedWorkflow?.id ?? ''}
          onChange={handleSelection}
          placeholder="Auto"
          maxHeight={240}
          options={[
            { value: '', label: 'Auto', sublabel: 'Use the built-in workflow' },
            ...matchingWorkflows.map((workflow) => ({
              value: workflow.id,
              label: workflow.name,
              sublabel:
                workflow.mode === 'both'
                  ? 'Image + Video'
                  : workflow.mode === 'video'
                    ? 'Video'
                    : 'Image',
              badge: { label: workflow.mode.toUpperCase() },
            })),
          ]}
        />
      ) : (
        <div className="flex h-[var(--control-h-md)] w-full items-center rounded-[var(--radius-control)] border border-white/[0.08] bg-white/[0.04] px-2.5 t-control text-gray-500">
          No tagged workflows
        </div>
      )}

      {matchingWorkflows.length === 0 ? (
        <p className="mt-1.5 t-body text-gray-500">
          Give this model and a workflow the same tag in the workflow manager, then it shows up here.
        </p>
      ) : selectedWorkflow ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {(workflowTags[selectedWorkflow.id] ?? []).map((tagId) => {
            const tag = tags.find((t) => t.id === tagId)
            return tag ? (
              <span
                key={tagId}
                className="rounded bg-lu-accent-soft px-1.5 py-0.5 t-label text-lu-accent"
              >
                {tag.name}
              </span>
            ) : null
          })}
        </div>
      ) : (
        <p className="mt-1.5 t-body text-gray-500">
          {matchingWorkflows.length} compatible{' '}
          {matchingWorkflows.length === 1 ? 'workflow' : 'workflows'}
        </p>
      )}
    </div>
  )
}
