/**
 * SLOT in C2, filled by strand 2 (Agent and knowledge).
 *
 * Strand 1 renders <ChatNoticeSlot chatId={id} /> in the notice area of the
 * conversation, under the header. It shows, one line each and only when
 * there is something to show: the goal line (C2.28), the loop line (C2.29)
 * and the plan band (C2.30).
 *
 * It also carries the watcher that opens "Allow this step?" (C12) by itself,
 * because this slot is mounted exactly as long as the chat is open.
 *
 * The props are the contract between the two strands: change them only
 * through a note in mobile-docs/geruest-wuensche/.
 */
import { useEffect, useState } from 'react'
import { CheckCircle2, ChevronDown, Circle, CircleDot, FileText, ListTodo, Repeat, Target } from 'lucide-react'
import { useAgentGoalStore } from '../../../stores/agentGoalStore'
import { useConversationLoop } from '../../../stores/agentLoopStore'
import { useTodoStore, type TodoItem } from '../../../stores/todoStore'
import { haptic } from '../../platform'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Icon, toast } from '../../ui'
import './parts/agent.css'
import { stopAgentLoop } from '../../../hooks/useAgentChat'
import { useApprovalWatch } from './parts/approval-watch'
import { documentLineText, useDocumentJob, useSlotTurn } from './parts/slot-turn'

export interface ChatNoticeSlotProps {
  chatId: string
}

const EMPTY_PLAN: TodoItem[] = []

function GoalLine({ chatId }: { chatId: string }) {
  const goal = useAgentGoalStore((s) => s.goals[chatId])
  if (!goal?.text) return null
  return (
    <div className="m-ag-line" role="status" data-testid="m-chat-goal" data-el="C2.28">
      <Icon icon={Target} small />
      <span className="m-ag-line-text">
        <b>{T.notices.goal}</b> {goal.text}
      </span>
      <button
        type="button"
        className="m-ag-line-btn"
        data-testid="m-chat-goal-clear"
        data-el="C2.28"
        onClick={() => {
          useAgentGoalStore.getState().clearGoal(chatId)
          toast(T.notices.goalCleared, { testid: 'goal-cleared' })
        }}
      >
        {T.notices.clearGoal}
      </button>
    </div>
  )
}

function LoopLine({ chatId }: { chatId: string }) {
  const loop = useConversationLoop(chatId)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!loop) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [loop])
  if (!loop) return null
  const seconds = Math.max(0, Math.ceil((loop.nextAt - now) / 1000))
  return (
    <div className="m-ag-line" role="status" data-testid="m-chat-loop" data-el="C2.29">
      <Icon icon={Repeat} small />
      <span className="m-ag-line-text">
        <b>{T.notices.loop}</b> {T.notices.loopPass(loop.pass, loop.cap)}, {seconds > 0 ? T.notices.loopNextIn(seconds) : T.notices.loopRunning}. {loop.task}
      </span>
      <button
        type="button"
        className="m-ag-line-btn"
        data-testid="m-chat-loop-stop"
        data-el="C2.29"
        onClick={() => {
          haptic('light')
          stopAgentLoop(chatId)
          toast(T.notices.loopStopped, { testid: 'loop-stopped' })
        }}
      >
        {T.notices.stopLoop}
      </button>
    </div>
  )
}

/** The chat model and the document model taking turns on a small phone (B1). */
function SlotLine() {
  const text = documentLineText(useSlotTurn(), useDocumentJob())
  if (!text) return null
  return (
    <div className="m-ag-line" role="status" data-testid="m-chat-slot-turn">
      <Icon icon={FileText} small />
      <span className="m-ag-line-text">{text}</span>
    </div>
  )
}

const PLAN_ICON = { completed: CheckCircle2, in_progress: CircleDot, pending: Circle } as const
const PLAN_WORD = { completed: T.notices.planDone, in_progress: T.notices.planDoing, pending: T.notices.planOpen } as const

function PlanBand({ chatId }: { chatId: string }) {
  const todos = useTodoStore((s) => s.byConversation[chatId] ?? EMPTY_PLAN)
  const [open, setOpen] = useState(false)
  if (todos.length === 0) return null
  const done = todos.filter((t) => t.status === 'completed').length
  const current = todos.find((t) => t.status === 'in_progress')
  return (
    <div className="m-ag-line" data-testid="m-chat-plan">
      <button
        type="button"
        className="m-ag-line-wide"
        aria-expanded={open}
        aria-label={T.notices.planName(done, todos.length, open)}
        data-testid="m-chat-plan-toggle"
        data-el="C2.30"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon icon={ListTodo} small />
        <span className="m-ag-line-text">
          <b>{T.notices.plan}</b> {T.notices.planProgress(done, todos.length)}
          {current && !open ? `. ${T.notices.planNow(current.content)}` : ''}
        </span>
        <Icon icon={ChevronDown} small className="m-ag-fold-chev" />
      </button>
      {open ? (
        <>
          <ol className="m-ag-plan" data-testid="m-chat-plan-list">
            {todos.map((todo, i) => (
              <li key={i} data-status={todo.status}>
                <Icon icon={PLAN_ICON[todo.status]} small />
                <span>
                  {todo.content}
                  <span className="m-sr">, {PLAN_WORD[todo.status]}</span>
                </span>
              </li>
            ))}
          </ol>
          <button type="button" className="m-ag-line-btn" data-testid="m-chat-plan-clear" onClick={() => useTodoStore.getState().clearTodos(chatId)}>
            {T.notices.planClear}
          </button>
        </>
      ) : null}
    </div>
  )
}

export function ChatNoticeSlot({ chatId }: ChatNoticeSlotProps) {
  useApprovalWatch(chatId)
  return (
    <>
      <SlotLine />
      <GoalLine chatId={chatId} />
      <LoopLine chatId={chatId} />
      <PlanBand chatId={chatId} />
    </>
  )
}
