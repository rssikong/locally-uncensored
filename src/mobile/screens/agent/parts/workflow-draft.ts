/**
 * The workflow that is being built (E10). The builder is two pages, the
 * workflow and one step, so the unsaved state lives here and not in either
 * page. Nothing is written to the workflow store before "Save".
 *
 * A draft is dropped after Save and Delete, and whenever the list of
 * workflows is on top again: by then the builder was left, with or without
 * "Discard changes?".
 */
import { create } from 'zustand'
import type { AgentWorkflow, WorkflowStep, WorkflowStepType } from '../../../../types/agent-workflows'
import { createStep, fieldsOf, moveStep, removeStep, sameFields, type WorkflowDraftFields } from './workflow-logic'

export interface WorkflowDraft extends WorkflowDraftFields {
  /** What the draft started from, to tell whether anything changed. */
  base: WorkflowDraftFields
}

interface DraftState {
  drafts: Record<string, WorkflowDraft>
  /** Start a draft for this key unless one is there already. */
  open: (key: string, workflow: AgentWorkflow | null) => void
  patch: (key: string, fields: Partial<Pick<WorkflowDraftFields, 'name' | 'description'>>) => void
  addStep: (key: string, kind: WorkflowStepType) => string | null
  updateStep: (key: string, stepId: string, patch: Partial<WorkflowStep>) => void
  move: (key: string, stepId: string, direction: -1 | 1) => void
  remove: (key: string, stepId: string) => void
  discard: (key: string) => void
  discardAll: () => void
}

let stepCounter = 0
function newStepId(): string {
  stepCounter += 1
  return `step-${Date.now().toString(36)}-${stepCounter}`
}

function change(state: DraftState, key: string, fn: (draft: WorkflowDraft) => WorkflowDraft): Partial<DraftState> {
  const draft = state.drafts[key]
  if (!draft) return {}
  return { drafts: { ...state.drafts, [key]: fn(draft) } }
}

export const useWorkflowDraft = create<DraftState>((set, get) => ({
  drafts: {},
  open: (key, workflow) => {
    if (get().drafts[key]) return
    const base = fieldsOf(workflow)
    set((s) => ({ drafts: { ...s.drafts, [key]: { ...fieldsOf(workflow), base } } }))
  },
  patch: (key, fields) => set((s) => change(s, key, (d) => ({ ...d, ...fields }))),
  addStep: (key, kind) => {
    if (!get().drafts[key]) return null
    const id = newStepId()
    set((s) => change(s, key, (d) => ({ ...d, steps: [...d.steps, createStep(kind, id)] })))
    return id
  },
  updateStep: (key, stepId, patch) => set((s) => change(s, key, (d) => ({ ...d, steps: d.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)) }))),
  move: (key, stepId, direction) => set((s) => change(s, key, (d) => ({ ...d, steps: moveStep(d.steps, stepId, direction) }))),
  remove: (key, stepId) => set((s) => change(s, key, (d) => ({ ...d, steps: removeStep(d.steps, stepId) }))),
  discard: (key) =>
    set((s) => {
      if (!s.drafts[key]) return s
      const drafts = { ...s.drafts }
      delete drafts[key]
      return { drafts }
    }),
  discardAll: () => set((s) => (Object.keys(s.drafts).length === 0 ? s : { drafts: {} })),
}))

export function isDraftDirty(draft: WorkflowDraft | undefined): boolean {
  return !!draft && !sameFields(draft, draft.base)
}
