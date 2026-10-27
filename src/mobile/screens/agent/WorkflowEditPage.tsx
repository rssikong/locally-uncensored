/**
 * E10 Workflow. Route /settings/workflows/:id, page, strand 2 (Agent and knowledge).
 *
 * The builder: name, the steps as cards with "Move up", "Move down" and
 * "Remove step" (no drag gesture needed), "Add step", "Save", "Delete
 * workflow" and "Run in a new chat". A step is edited on its own page
 * (WorkflowStepPage, route /settings/workflows/:id/step/:stepId). The id "new" is a workflow that does not exist yet.
 * A built in workflow can be run and copied, not changed.
 */
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Copy, Play, Plus, Trash2, Workflow } from 'lucide-react'
import { workflowRunsOnThisDevice } from '../../../lib/mobile-tools'
import { useAgentModeStore } from '../../../stores/agentModeStore'
import { useAgentWorkflowStore } from '../../../stores/agentWorkflowStore'
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import type { AgentWorkflow } from '../../../types/agent-workflows'
import { nav, useParams } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, EmptyState, Field, IconButton, Notice, Page, toast } from '../../ui'
import './parts/agent.css'
import { useChatSender, wasSent } from './parts/adapters/chat-send'
import { useGuardedLeave } from './parts/leave'
import { isCloudModel } from './parts/policy'
import { isDraftDirty, useWorkflowDraft } from './parts/workflow-draft'
import { firstQuestion, NEW_WORKFLOW, stepProblem, stepSummary, workflowCommand, workflowProblem, type WorkflowProblem } from './parts/workflow-logic'

const S = T.workflows.editor

export default function WorkflowEditPage() {
  const { id } = useParams<{ id: string }>()
  return <WorkflowPage id={id} />
}

function WorkflowPage({ id }: { id: string }) {
  const workflow = useAgentWorkflowStore((s) => s.workflows.find((w) => w.id === id))
  const draft = useWorkflowDraft((s) => s.drafts[id])
  const usable = id === NEW_WORKFLOW || (!!workflow && workflowRunsOnThisDevice(workflow))

  useEffect(() => {
    if (usable) useWorkflowDraft.getState().open(id, workflow ?? null)
    // The draft is made once per visit; later changes of the stored workflow come from this page itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, usable])

  if (!usable) {
    return (
      <Page title={S.titleEdit} screen="settings-workflow">
        <EmptyState
          title={S.gone}
          icon={Workflow}
          testid="m-workflow-gone"
          actions={
            <Button onPress={() => void nav.back()} testid="m-workflow-gone-back">
              {S.back}
            </Button>
          }
        >
          {S.goneText}
        </EmptyState>
      </Page>
    )
  }
  if (!draft) return <Page title={workflow ? S.titleEdit : S.titleNew} screen="settings-workflow" />
  return <Builder id={id} workflow={workflow ?? null} />
}

function Builder({ id, workflow }: { id: string; workflow: AgentWorkflow | null }) {
  const draft = useWorkflowDraft((s) => s.drafts[id])
  const activeModel = useModelStore((s) => s.activeModel)
  const send = useChatSender()
  const [problem, setProblem] = useState<WorkflowProblem | null>(null)
  const [running, setRunning] = useState(false)
  const readOnly = workflow?.isBuiltIn === true
  const dirty = isDraftDirty(draft)
  const leave = useGuardedLeave(dirty)
  const drafts = useWorkflowDraft.getState()

  const save = () => {
    const found = workflowProblem(draft)
    setProblem(found)
    if (found) return
    const store = useAgentWorkflowStore.getState()
    const fields = { name: draft.name.trim(), description: draft.description.trim(), steps: draft.steps }
    if (workflow) store.updateWorkflow(workflow.id, fields)
    else store.addWorkflow({ ...fields, icon: 'Workflow', variables: {}, isBuiltIn: false })
    drafts.discard(id)
    toast(S.saved, { testid: 'workflow-saved' })
    leave()
  }

  const remove = async () => {
    if (!workflow) return
    const yes = await nav.confirm({ title: S.deleteTitle(workflow.name), text: S.deleteText, confirmLabel: T.common.delete, tone: 'danger', testid: 'workflow-delete' })
    if (!yes) return
    useAgentWorkflowStore.getState().removeWorkflow(workflow.id)
    drafts.discard(id)
    toast(S.deleted, { testid: 'workflow-deleted' })
    leave()
  }

  const duplicate = () => {
    if (!workflow) return
    const copyId = useAgentWorkflowStore.getState().duplicateWorkflow(workflow.id)
    if (!copyId) return
    toast(S.duplicated, { testid: 'workflow-duplicated' })
    nav.replace('/settings/workflows/:id', { id: copyId })
  }

  const run = async () => {
    if (!workflow || running) return
    let input: string | undefined
    const question = firstQuestion(workflow)
    if (question !== null) {
      const answer = await nav.prompt({ title: S.runAskTitle(workflow.name), text: question || undefined, confirmLabel: S.runAskConfirm, field: { label: S.runAskLabel }, testid: 'workflow-input' })
      if (answer === null) return
      input = answer
    }
    const model = useModelStore.getState().activeModel
    if (!model) return
    setRunning(true)
    const chatId = useChatStore.getState().createConversation(model, '')
    // A workflow is an agent run: the new chat starts in Agent mode.
    useAgentModeStore.getState().setAgentModeActive(chatId, true)
    const outcome = await send(chatId, workflowCommand(workflow.name, input))
    setRunning(false)
    if (!wasSent(outcome)) {
      // Nothing was sent (no consent, no model): do not leave an empty chat behind.
      useChatStore.getState().deleteConversation(chatId)
      return
    }
    // The chat strand opens the new chat itself and sends there ("opened"). Only a chat that was already on screen needs no step.
    if (outcome === 'sent') nav.push('/chat/:id', { id: chatId })
  }

  const runBlocked = !workflow ? S.runSaveFirst : dirty ? S.runSaveFirst : !activeModel ? S.runNoModel : workflow.steps.length === 0 ? S.runNoSteps : null
  const paid = isCloudModel(activeModel)

  return (
    <Page
      title={workflow ? S.titleEdit : S.titleNew}
      subtitle={workflow?.name}
      screen="settings-workflow"
      footer={
        readOnly ? undefined : (
          <Button variant="primary" block disabled={!dirty} disabledReason={T.personas.editor.unchanged} onPress={save} testid="m-workflow-save" el="E10.9">
            {S.save}
          </Button>
        )
      }
    >
      {readOnly ? (
        <Notice
          variant="info"
          testid="m-workflow-builtin"
          actions={
            <Button compact icon={Copy} onPress={duplicate} testid="m-workflow-duplicate">
              {S.duplicate}
            </Button>
          }
        >
          {S.builtInNote}
        </Notice>
      ) : null}
      <div className="m-ag-block m-stackv">
        <Field
          label={S.name}
          value={draft.name}
          onChange={(value) => {
            drafts.patch(id, { name: value })
            setProblem(null)
          }}
          placeholder={S.namePlaceholder}
          error={problem?.kind === 'name' ? S.nameEmpty : undefined}
          maxLength={60}
          disabled={readOnly}
          testid="m-workflow-name"
          el="E10.4"
        />
        <Field label={S.description} value={draft.description} onChange={(value) => drafts.patch(id, { description: value })} placeholder={S.descriptionPlaceholder} maxLength={140} disabled={readOnly} testid="m-workflow-description" />
      </div>

      <h2 className="m-label m-group-label">{S.stepsTitle}</h2>
      {draft.steps.length === 0 ? (
        <p className="m-ag-text" data-testid="m-workflow-nosteps">
          {S.noSteps}
        </p>
      ) : (
        <div className="m-group" data-testid="m-workflow-steps">
          {draft.steps.map((step, index) => {
            const broken = problem ? stepProblem(step, draft.steps) : null
            return (
              <div className="m-ag-step" key={step.id} data-testid={`m-workflow-step-${index}`}>
                <button
                  type="button"
                  className="m-ag-step-main"
                  aria-label={S.stepName(index + 1, step.label)}
                  onClick={() => nav.push('/settings/workflows/:id/step/:stepId', { id, stepId: step.id })}
                  data-testid={`m-workflow-step-open-${index}`}
                  data-el="E10.5"
                >
                  <span className="m-ag-step-no m-mono">{index + 1}</span>
                  <span className="m-ag-step-text">
                    <span className="m-ag-item-title">{step.label || T.workflows.kinds[step.type]}</span>
                    <span className="m-cap">{`${T.workflows.kinds[step.type]}: ${stepSummary(step)}`}</span>
                    {broken ? <span className="m-ag-error">{broken}</span> : null}
                  </span>
                </button>
                {readOnly ? null : (
                  <div className="m-ag-step-tools">
                    <IconButton icon={ArrowUp} label={S.moveUpName(step.label)} disabled={index === 0} onPress={() => drafts.move(id, step.id, -1)} testid={`m-workflow-step-up-${index}`} el="E10.7" />
                    <IconButton icon={ArrowDown} label={S.moveDownName(step.label)} disabled={index === draft.steps.length - 1} onPress={() => drafts.move(id, step.id, 1)} testid={`m-workflow-step-down-${index}`} el="E10.7" />
                    <IconButton risk="destructive" icon={Trash2} label={S.removeStepName(step.label)} onPress={() => drafts.remove(id, step.id)} testid={`m-workflow-step-remove-${index}`} el="E10.8" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      {problem?.kind === 'steps' ? (
        <Notice variant="error" testid="m-workflow-error">
          {S.stepsEmpty}
        </Notice>
      ) : problem?.kind === 'step' ? (
        <Notice variant="error" testid="m-workflow-error">
          {S.stepBroken(problem.index + 1, problem.text)}
        </Notice>
      ) : null}

      {readOnly ? null : (
        <div className="m-ag-actions">
          <Button block icon={Plus} onPress={() => nav.openSheet('agent-add-step', { workflowId: id })} testid="m-workflow-add-step" el="E10.6">
            {S.addStep}
          </Button>
        </div>
      )}

      <div className="m-ag-actions">
        {paid ? (
          <Button risk="paid" variant="cloud" block icon={Play} busy={running} disabled={!!runBlocked} disabledReason={runBlocked ?? undefined} onPress={() => void run()} testid="m-workflow-run" el="E10.3">
            {S.run}
          </Button>
        ) : (
          <Button block icon={Play} busy={running} disabled={!!runBlocked} disabledReason={runBlocked ?? undefined} onPress={() => void run()} testid="m-workflow-run" el="E10.3">
            {S.run}
          </Button>
        )}
        {workflow && !readOnly ? (
          <Button risk="destructive" variant="danger" block onPress={() => void remove()} testid="m-workflow-delete" el="E10.10">
            {S.delete}
          </Button>
        ) : null}
      </div>
    </Page>
  )
}
