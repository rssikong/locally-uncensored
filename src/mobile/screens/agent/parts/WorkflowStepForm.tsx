/**
 * E10 Workflow step: the form of one step (E10.5), as a page of its own.
 *
 * Its route is /settings/workflows/:id/step/:stepId (WorkflowStepPage.tsx).
 *
 * What is typed here goes straight into the workflow that is being built
 * (workflow-draft.ts); it reaches the saved workflow with "Save" on the
 * builder page.
 */
import { ListX } from 'lucide-react'
import { useAgentWorkflowStore } from '../../../../stores/agentWorkflowStore'
import type { MemoryType } from '../../../../types/agent-mode'
import type { WorkflowStep } from '../../../../types/agent-workflows'
import { nav } from '../../../nav'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { Button, Chip, ChipGroup, EmptyState, Field, ListGroup, Notice, NumberField, Page, Row, TextArea } from '../../../ui'
import './agent.css'
import { MEMORY_TYPES } from './memory-logic'
import { useWorkflowDraft } from './workflow-draft'
import { OPERATORS, operatorNeedsValue, stepProblem, stepTool, stepTools, type Operator } from './workflow-logic'

const S = T.workflows.step
export const LOOP_MAX = 10

export function WorkflowStepForm({ id, stepId }: { id: string; stepId: string }) {
  const draft = useWorkflowDraft((s) => s.drafts[id])
  const readOnly = useAgentWorkflowStore((s) => s.workflows.find((w) => w.id === id)?.isBuiltIn === true)
  const step = draft?.steps.find((s) => s.id === stepId)
  const index = draft ? draft.steps.findIndex((s) => s.id === stepId) : -1

  if (!draft || !step) {
    return (
      <Page title={S.title} screen="agent-workflow-step">
        <EmptyState
          title={S.gone}
          icon={ListX}
          testid="m-step-gone"
          actions={
            <Button onPress={() => void nav.back()} testid="m-step-gone-back">
              {S.back}
            </Button>
          }
        />
      </Page>
    )
  }

  const others = draft.steps.filter((s) => s.id !== step.id)
  const update = (patch: Partial<WorkflowStep>) => useWorkflowDraft.getState().updateStep(id, step.id, patch)
  const problem = stepProblem(step, draft.steps)
  const numberOf = (other: WorkflowStep) => draft.steps.findIndex((s) => s.id === other.id) + 1

  const operatorChips = (value: Operator, onPick: (next: Operator) => void, prefix: string) => (
    <ChipGroup label={S.operator} role="radiogroup" wrap testid={`${prefix}-operators`}>
      {OPERATORS.map((op) => (
        <Chip key={op} kind="choice" selected={value === op} disabled={readOnly} onPress={() => onPick(op)} testid={`${prefix}-op-${op}`}>
          {S.operators[op]}
        </Chip>
      ))}
    </ChipGroup>
  )

  const targetList = (title: string, value: string, onPick: (next: string) => void, prefix: string) => (
    <ListGroup title={title} role="radiogroup" testid={prefix}>
      <Row title={S.nextStep} radio={{ checked: !value, onSelect: () => onPick('') }} disabled={readOnly} testid={`${prefix}-next`} />
      {others.map((other) => (
        <Row key={other.id} title={S.stepOption(numberOf(other), other.label)} radio={{ checked: value === other.id, onSelect: () => onPick(other.id) }} disabled={readOnly} testid={`${prefix}-${numberOf(other)}`} />
      ))}
    </ListGroup>
  )

  return (
    <Page
      title={`${S.title} ${index + 1}`}
      subtitle={T.workflows.kinds[step.type]}
      screen="agent-workflow-step"
      footer={
        <Button variant="primary" block onPress={() => void nav.back()} testid="m-step-done">
          {S.done}
        </Button>
      }
    >
      <p className="m-ag-text m-ag-text--top">{T.workflows.kindHints[step.type]}</p>
      <div className="m-ag-block m-stackv">
        <Field label={S.label} value={step.label} onChange={(value) => update({ label: value })} placeholder={S.labelPlaceholder} maxLength={60} disabled={readOnly} testid="m-step-label" el="E10.5" />

        {step.type === 'prompt' ? (
          <TextArea label={S.prompt} value={step.prompt ?? ''} onChange={(value) => update({ prompt: value })} placeholder={S.promptPlaceholder} hint={S.promptHint} rows={7} disabled={readOnly} testid="m-step-prompt" el="E10.5" />
        ) : null}

        {step.type === 'user_input' ? (
          <TextArea label={S.question} value={step.userInputPrompt ?? ''} onChange={(value) => update({ userInputPrompt: value })} placeholder={S.questionPlaceholder} rows={3} disabled={readOnly} testid="m-step-question" el="E10.5" />
        ) : null}

        {step.type === 'memory_save' && step.memorySave ? (
          <>
            <Field
              label={S.memoryTitle}
              value={step.memorySave.titleTemplate}
              onChange={(value) => update({ memorySave: { ...step.memorySave!, titleTemplate: value } })}
              maxLength={60}
              disabled={readOnly}
              testid="m-step-memory-title"
              el="E10.5"
            />
            <TextArea
              label={S.memoryText}
              value={step.memorySave.contentTemplate}
              onChange={(value) => update({ memorySave: { ...step.memorySave!, contentTemplate: value } })}
              hint={S.memoryHint}
              rows={4}
              disabled={readOnly}
              testid="m-step-memory-text"
              el="E10.5"
            />
            <span className="m-field-label">{S.memoryType}</span>
          </>
        ) : null}
      </div>

      {step.type === 'prompt' ? (
        <ListGroup>
          <Row
            title={S.promptTools}
            subtitle={S.promptToolsSub}
            switch={{ checked: step.allowedTools === undefined, onChange: (on) => update({ allowedTools: on ? undefined : [] }) }}
            disabled={readOnly}
            testid="m-step-prompt-tools"
            el="E10.5"
          />
        </ListGroup>
      ) : null}

      {step.type === 'memory_save' && step.memorySave ? (
        <ChipGroup label={S.memoryType} role="radiogroup" wrap testid="m-step-memory-types">
          {MEMORY_TYPES.map((value: MemoryType) => (
            <Chip key={value} kind="choice" selected={step.memorySave?.type === value} disabled={readOnly} onPress={() => update({ memorySave: { ...step.memorySave!, type: value } })} testid={`m-step-memory-type-${value}`}>
              {T.memory.types[value]}
            </Chip>
          ))}
        </ChipGroup>
      ) : null}

      {step.type === 'tool' ? (
        <>
          <ListGroup title={S.tool} role="radiogroup" label={S.toolPick} testid="m-step-tools">
            {stepTools().map((tool) => (
              <Row
                key={tool.name}
                title={S.toolNames[tool.name] ?? tool.name}
                radio={{ checked: step.toolName === tool.name, onSelect: () => update({ toolName: tool.name, toolArgTemplates: {} }) }}
                disabled={readOnly}
                testid={`m-step-tool-${tool.name}`}
                el="E10.5"
              />
            ))}
          </ListGroup>
          {step.toolName ? (
            <div className="m-ag-block m-stackv">
              {(stepTool(step.toolName)?.args ?? []).map((arg) =>
                arg.long ? (
                  <TextArea
                    key={arg.key}
                    label={S.toolArgs[arg.key] ?? arg.key}
                    value={step.toolArgTemplates?.[arg.key] ?? ''}
                    onChange={(value) => update({ toolArgTemplates: { ...(step.toolArgTemplates ?? {}), [arg.key]: value } })}
                    rows={4}
                    disabled={readOnly}
                    testid={`m-step-arg-${arg.key}`}
                  />
                ) : (
                  <Field
                    key={arg.key}
                    label={S.toolArgs[arg.key] ?? arg.key}
                    value={step.toolArgTemplates?.[arg.key] ?? ''}
                    onChange={(value) => update({ toolArgTemplates: { ...(step.toolArgTemplates ?? {}), [arg.key]: value } })}
                    disabled={readOnly}
                    testid={`m-step-arg-${arg.key}`}
                  />
                ),
              )}
              <span className="m-cap">{S.toolInputHint}</span>
            </div>
          ) : null}
        </>
      ) : null}

      {step.type === 'condition' && step.condition ? (
        <>
          <p className="m-ag-text">{`${S.source}: ${S.sourceLast}`}</p>
          {operatorChips(step.condition.operator, (operator) => update({ condition: { ...step.condition!, operator } }), 'm-step-cond')}
          {operatorNeedsValue(step.condition.operator) ? (
            <div className="m-ag-block m-stackv" style={{ paddingTop: 12 }}>
              <Field label={S.value} value={step.condition.value} onChange={(value) => update({ condition: { ...step.condition!, value } })} disabled={readOnly} testid="m-step-cond-value" el="E10.5" />
            </div>
          ) : null}
          {targetList(S.thenStep, step.condition.thenStepId, (next) => update({ condition: { ...step.condition!, thenStepId: next } }), 'm-step-then')}
          {targetList(S.elseStep, step.condition.elseStepId, (next) => update({ condition: { ...step.condition!, elseStepId: next } }), 'm-step-else')}
        </>
      ) : null}

      {step.type === 'loop' && step.loop ? (
        <>
          <div className="m-group">
            <div className="m-ag-seg-row">
              <span className="m-ag-seg-title">{S.loopMax}</span>
              <span className="m-ag-seg-sub">{S.loopTimes(step.loop.maxIterations)}</span>
              <NumberField label={S.loopMax} value={step.loop.maxIterations} min={1} max={LOOP_MAX} onChange={(value) => update({ loop: { ...step.loop!, maxIterations: Math.round(value) } })} disabled={readOnly} testid="m-step-loop-max" el="E10.5" />
            </div>
          </div>
          <p className="m-ag-text">{S.loopUntil}</p>
          {operatorChips(step.loop.condition.operator, (operator) => update({ loop: { ...step.loop!, condition: { ...step.loop!.condition, operator } } }), 'm-step-loop')}
          {operatorNeedsValue(step.loop.condition.operator) ? (
            <div className="m-ag-block m-stackv" style={{ paddingTop: 12 }}>
              <Field label={S.value} value={step.loop.condition.value} onChange={(value) => update({ loop: { ...step.loop!, condition: { ...step.loop!.condition, value } } })} disabled={readOnly} testid="m-step-loop-value" el="E10.5" />
            </div>
          ) : null}
          {others.length === 0 ? (
            <p className="m-ag-text" data-testid="m-step-loop-nobody">
              {S.loopBodyNone}
            </p>
          ) : (
            <ListGroup title={S.loopBody} testid="m-step-loop-body">
              {others.map((other) => {
                const on = step.loop!.bodyStepIds.includes(other.id)
                return (
                  <Row
                    key={other.id}
                    title={S.stepOption(numberOf(other), other.label)}
                    switch={{
                      checked: on,
                      onChange: (next) => {
                        const ids = next ? [...step.loop!.bodyStepIds, other.id] : step.loop!.bodyStepIds.filter((b) => b !== other.id)
                        // Keep the order of the workflow, whatever order they were ticked in.
                        const ordered = draft.steps.map((s) => s.id).filter((sid) => ids.includes(sid))
                        update({ loop: { ...step.loop!, bodyStepIds: ordered } })
                      },
                    }}
                    disabled={readOnly}
                    testid={`m-step-loop-body-${numberOf(other)}`}
                  />
                )
              })}
            </ListGroup>
          )}
        </>
      ) : null}

      {problem && !readOnly ? (
        <Notice variant="warn" testid="m-step-problem">
          {problem}
        </Notice>
      ) : null}
    </Page>
  )
}
