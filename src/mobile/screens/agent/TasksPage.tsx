/**
 * C10 Background tasks. Route /chat/:id/tasks, kind page, tab chat, strand 2 (Agent and knowledge).
 *
 * The sub agents of one chat (stores/agentTaskStore): what each one works
 * on, its answer, Stop per task, a message to a running one, and Stop all.
 * The store is not kept across a restart on purpose: a task that is listed
 * here is one that really runs or ran in this session.
 */
import { useEffect, useState } from 'react'
import { Bot, Flag, Send } from 'lucide-react'
import { formatTaskTokens, isTerminal, taskTokenTotal, type AgentTask } from '../../../lib/agent-tasks'
import { useAgentTaskStore } from '../../../stores/agentTaskStore'
import { useModelStore } from '../../../stores/modelStore'
import { nav, useParams } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, EmptyState, Notice, Page, TextArea, toast } from '../../ui'
import './parts/agent.css'
import { previewOf } from './parts/blocks'
import { Fold } from './parts/Fold'
import { reportAnswer } from './parts/policy'
import { elapsed, foldState, liveCount, orderTasks } from './parts/tasks-logic'

const S = T.tasks
const NONE: AgentTask[] = []

export default function TasksPage() {
  const { id } = useParams<{ id: string }>()
  const tasks = useAgentTaskStore((s) => s.byConv[id] ?? NONE)
  const ordered = orderTasks(tasks)
  const live = liveCount(tasks)
  const [now, setNow] = useState(() => Date.now())

  // The clock of a running task. It stands still when nothing runs.
  useEffect(() => {
    if (live === 0) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])

  const stopAll = async () => {
    const yes = await nav.confirm({ title: S.stopAllTitle, text: S.stopAllText(live), confirmLabel: S.stopAll, tone: 'danger', testid: 'tasks-stop-all' })
    if (!yes) return
    const stopped = useAgentTaskStore.getState().cancelAll(id)
    toast(S.stoppedAll(stopped), { testid: 'tasks-stopped-all' })
  }

  return (
    <Page
      title={S.title}
      screen="chat-tasks"
      footer={
        live > 1 ? (
          <Button risk="destructive" variant="danger" block onPress={() => void stopAll()} testid="m-tasks-stop-all" el="C10.4">
            {S.stopAll}
          </Button>
        ) : undefined
      }
    >
      <Notice variant="info" testid="m-tasks-hint">
        {S.hint}
      </Notice>
      {ordered.length === 0 ? (
        <EmptyState title={S.empty} icon={Bot} testid="m-tasks-empty">
          {S.emptyText}
        </EmptyState>
      ) : (
        <div className="m-group" data-testid="m-tasks-list">
          {ordered.map((task) => (
            <TaskItem key={task.id} task={task} now={now} />
          ))}
        </div>
      )}
    </Page>
  )
}

function TaskItem({ task, now }: { task: AgentTask; now: number }) {
  const ended = isTerminal(task.status)
  const status = S.status[task.status] ?? task.status
  const stop = () => {
    const ok = useAgentTaskStore.getState().cancel(task.id)
    toast(ok ? S.stopped : S.stopFailed, { testid: ok ? 'task-stopped' : 'task-stop-failed' })
  }
  return (
    <div className="m-ag-item" data-testid={`m-tasks-task-${task.id}`} data-state={task.status}>
      <Fold
        title={task.goal}
        sub={`${task.status === 'running' && task.activity ? `${status}: ${task.activity}` : status}, ${S.seconds(elapsed(task, now))}`}
        icon={Bot}
        label={S.taskName(task.goal, status)}
        state={foldState(task)}
        testid="m-tasks-row"
        el="C10.1"
        trailing={
          ended ? null : (
            <Button risk="destructive" compact onPress={stop} label={S.stopName(task.goal)} testid="m-tasks-stop" el="C10.2">
              {S.stop}
            </Button>
          )
        }
      >
        {() => <TaskBody task={task} />}
      </Fold>
    </div>
  )
}

function TaskBody({ task }: { task: AgentTask }) {
  const ended = isTerminal(task.status)
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [full, setFull] = useState(false)
  const output = task.output ?? ''
  const cut = previewOf(output)

  const send = () => {
    const text = message.trim()
    if (!text) {
      setError(S.messageEmpty)
      return
    }
    const ok = useAgentTaskStore.getState().post(task.id, text)
    if (!ok) {
      setError(S.sendFailed)
      return
    }
    setMessage('')
    toast(S.sent, { testid: 'task-message-sent' })
  }

  return (
    <>
      <span className="m-cap">{task.background ? S.background : S.foreground}</span>
      {task.context ? (
        <div className="m-ag-kv">
          <span>{S.context}</span>
          <div className="m-ag-pre m-ag-pre--plain">{previewOf(task.context, 600).shown}</div>
        </div>
      ) : null}
      <span className="m-cap m-mono">{S.counts(task.iterations, task.toolCalls)}</span>
      {taskTokenTotal(task.tokens) > 0 ? <span className="m-cap m-mono">{`${S.tokens}: ${formatTaskTokens(task.tokens)}`}</span> : null}
      {task.error ? (
        <div className="m-ag-kv">
          <span>{S.error}</span>
          <span className="m-ag-error" role="alert" data-testid="m-tasks-error">
            {task.error}
          </span>
        </div>
      ) : null}
      {output ? (
        <div className="m-ag-kv">
          <span>{S.output}</span>
          <div className="m-ag-pre m-ag-pre--plain" data-testid="m-tasks-output">
            {full ? output : cut.shown}
          </div>
          <div className="m-rowh">
            {cut.more > 0 ? (
              <Button compact onPress={() => setFull((f) => !f)} testid="m-tasks-output-more">
                {full ? T.tools.showLess : T.tools.showMore}
              </Button>
            ) : null}
            <Button compact icon={Flag} onPress={() => reportAnswer({ id: task.id, model: useModelStore.getState().activeModel, text: output })} testid="m-tasks-report">
              {T.common.report}
            </Button>
          </div>
        </div>
      ) : !task.error ? (
        <span className="m-cap">{S.noOutput}</span>
      ) : null}
      {!ended ? (
        <div className="m-stackv" data-testid="m-tasks-message">
          {task.inbox.length > 0 ? <span className="m-cap">{S.unread(task.inbox.length)}</span> : null}
          <TextArea
            label={S.messageLabel}
            value={message}
            onChange={(value) => {
              setMessage(value)
              setError(undefined)
            }}
            placeholder={S.messagePlaceholder}
            rows={2}
            error={error}
            testid="m-tasks-message-input"
            el="C10.3"
          />
          <Button compact icon={Send} onPress={send} testid="m-tasks-message-send" el="C10.3">
            {S.message}
          </Button>
        </div>
      ) : null}
    </>
  )
}
