/** Pure helpers of E10 Workflows: the steps a phone can build, their checks and their one line summaries. */
import { toolExistsOnThisDevice } from '../../../../lib/mobile-tools'
import type { AgentWorkflow, WorkflowStep, WorkflowStepType } from '../../../../types/agent-workflows'
import { AGENT_STRINGS as T } from '../../../strings/agent'

const S = T.workflows

/** The id the editor route uses for a workflow that does not exist yet. */
export const NEW_WORKFLOW = 'new'

export const STEP_KINDS: readonly WorkflowStepType[] = ['prompt', 'tool', 'user_input', 'condition', 'loop', 'memory_save']

export type Operator = NonNullable<WorkflowStep['condition']>['operator']
export const OPERATORS: readonly Operator[] = ['contains', 'not_contains', 'equals', 'not_equals', 'truthy', 'falsy']

/** Does this check compare against a text? "Is empty" and "Is not empty" do not. */
export function operatorNeedsValue(operator: Operator): boolean {
  return operator !== 'truthy' && operator !== 'falsy'
}

export interface StepTool {
  name: string
  /** The inputs the form asks for, in order. All of them are text and may hold {{variables}}. */
  args: ReadonlyArray<{ key: string; required: boolean; long?: boolean }>
}

/** The tools a workflow step can run on a phone. A short list on purpose: each one has a form that fits. */
const ALL_STEP_TOOLS: readonly StepTool[] = [
  { name: 'web_search', args: [{ key: 'query', required: true }] },
  { name: 'web_fetch', args: [{ key: 'url', required: true }] },
  { name: 'file_read', args: [{ key: 'path', required: true }] },
  {
    name: 'file_write',
    args: [
      { key: 'path', required: true },
      { key: 'content', required: true, long: true },
    ],
  },
]

export function stepTools(): StepTool[] {
  return ALL_STEP_TOOLS.filter((t) => toolExistsOnThisDevice(t.name))
}

export function stepTool(name: string | undefined): StepTool | undefined {
  return ALL_STEP_TOOLS.find((t) => t.name === name)
}

/** A new step of a kind, with the same starting values the desktop builder writes. */
export function createStep(kind: WorkflowStepType, id: string): WorkflowStep {
  const base: WorkflowStep = { id, type: kind, label: S.kinds[kind] ?? kind }
  switch (kind) {
    case 'prompt':
      return { ...base, prompt: '', allowedTools: [] }
    case 'tool':
      return { ...base, toolName: '', toolArgTemplates: {} }
    case 'condition':
      return { ...base, condition: { source: 'last_output', operator: 'contains', value: '', thenStepId: '', elseStepId: '' } }
    case 'loop':
      return { ...base, loop: { maxIterations: 3, condition: { source: 'last_output', operator: 'contains', value: '' }, bodyStepIds: [] } }
    case 'user_input':
      return { ...base, userInputPrompt: '' }
    case 'memory_save':
      return { ...base, memorySave: { type: 'reference', titleTemplate: '', contentTemplate: '{{last_output}}', tags: [] } }
  }
}

function clip(text: string, max = 80): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 3)}...` : one
}

/** One line under the step name on its card. */
export function stepSummary(step: WorkflowStep): string {
  switch (step.type) {
    case 'prompt':
      return S.summary.prompt(clip(step.prompt ?? ''))
    case 'tool':
      return S.summary.tool(step.toolName ? (S.step.toolNames[step.toolName] ?? step.toolName) : '')
    case 'condition':
      return S.summary.condition(S.step.operators[step.condition?.operator ?? 'contains'], clip(step.condition?.value ?? '', 40))
    case 'loop':
      return S.summary.loop(step.loop?.maxIterations ?? 0, step.loop?.bodyStepIds.length ?? 0)
    case 'user_input':
      return S.summary.user_input(clip(step.userInputPrompt ?? ''))
    case 'memory_save':
      return S.summary.memory_save(clip(step.memorySave?.titleTemplate ?? ''))
  }
}

/** Why a step cannot run as it is, in words for the user, or null. */
export function stepProblem(step: WorkflowStep, all: ReadonlyArray<WorkflowStep>): string | null {
  const E = S.step.errors
  if (!step.label.trim()) return E.label
  const ids = new Set(all.map((s) => s.id))
  switch (step.type) {
    case 'prompt':
      return step.prompt?.trim() ? null : E.prompt
    case 'tool': {
      if (!step.toolName) return E.tool
      const tool = stepTool(step.toolName)
      for (const arg of tool?.args ?? []) {
        if (arg.required && !step.toolArgTemplates?.[arg.key]?.trim()) return E.toolArg(S.step.toolArgs[arg.key] ?? arg.key)
      }
      return null
    }
    case 'condition': {
      const c = step.condition
      if (!c) return E.value
      if (operatorNeedsValue(c.operator) && !c.value.trim()) return E.value
      if ((c.thenStepId && !ids.has(c.thenStepId)) || (c.elseStepId && !ids.has(c.elseStepId))) return E.target
      return null
    }
    case 'loop': {
      const l = step.loop
      if (!l || l.bodyStepIds.filter((id) => ids.has(id) && id !== step.id).length === 0) return E.loopBody
      if (operatorNeedsValue(l.condition.operator) && !l.condition.value.trim()) return E.value
      return null
    }
    case 'user_input':
      return step.userInputPrompt?.trim() ? null : E.question
    case 'memory_save':
      return step.memorySave?.titleTemplate.trim() && step.memorySave.contentTemplate.trim() ? null : E.memory
  }
}

export interface WorkflowDraftFields {
  name: string
  description: string
  steps: WorkflowStep[]
}

export type WorkflowProblem = { kind: 'name' } | { kind: 'steps' } | { kind: 'step'; index: number; text: string }

export function workflowProblem(draft: WorkflowDraftFields): WorkflowProblem | null {
  if (!draft.name.trim()) return { kind: 'name' }
  if (draft.steps.length === 0) return { kind: 'steps' }
  for (let i = 0; i < draft.steps.length; i++) {
    const text = stepProblem(draft.steps[i], draft.steps)
    if (text) return { kind: 'step', index: i, text }
  }
  return null
}

export function moveStep(steps: ReadonlyArray<WorkflowStep>, id: string, direction: -1 | 1): WorkflowStep[] {
  const from = steps.findIndex((s) => s.id === id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= steps.length) return steps.slice()
  const next = steps.slice()
  const [step] = next.splice(from, 1)
  next.splice(to, 0, step)
  return next
}

/** Take a step out, and with it every pointer other steps held to it. */
export function removeStep(steps: ReadonlyArray<WorkflowStep>, id: string): WorkflowStep[] {
  return steps
    .filter((s) => s.id !== id)
    .map((s) => {
      if (s.condition && (s.condition.thenStepId === id || s.condition.elseStepId === id)) {
        return { ...s, condition: { ...s.condition, thenStepId: s.condition.thenStepId === id ? '' : s.condition.thenStepId, elseStepId: s.condition.elseStepId === id ? '' : s.condition.elseStepId } }
      }
      if (s.loop && s.loop.bodyStepIds.includes(id)) return { ...s, loop: { ...s.loop, bodyStepIds: s.loop.bodyStepIds.filter((b) => b !== id) } }
      return s
    })
}

export function fieldsOf(workflow: AgentWorkflow | null): WorkflowDraftFields {
  return workflow ? { name: workflow.name, description: workflow.description, steps: workflow.steps.map((s) => ({ ...s })) } : { name: '', description: '', steps: [] }
}

export function sameFields(a: WorkflowDraftFields, b: WorkflowDraftFields): boolean {
  return a.name === b.name && a.description === b.description && JSON.stringify(a.steps) === JSON.stringify(b.steps)
}

/** The question a workflow asks before it can start, or null when it needs none. */
export function firstQuestion(workflow: Pick<AgentWorkflow, 'steps'>): string | null {
  const first = workflow.steps[0]
  if (!first || first.type !== 'user_input') return null
  return first.userInputPrompt?.trim() || first.label || ''
}

/** The text that starts a workflow in a chat. The agent loop reads "run workflow <name>: <input>". */
export function workflowCommand(name: string, input?: string): string {
  const answer = input?.trim()
  return answer ? `run workflow ${name}: ${answer}` : `run workflow ${name}`
}
