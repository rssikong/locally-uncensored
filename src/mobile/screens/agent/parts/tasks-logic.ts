/** Pure helpers of C10 Background tasks. */
import { isTerminal, taskElapsedSeconds, type AgentTask } from '../../../../lib/agent-tasks'

/** Newest first, and what still runs above what has ended. */
export function orderTasks(tasks: ReadonlyArray<AgentTask>): AgentTask[] {
  return tasks.slice().sort((a, b) => {
    const live = Number(isTerminal(a.status)) - Number(isTerminal(b.status))
    return live !== 0 ? live : b.startedAt - a.startedAt
  })
}

export function liveCount(tasks: ReadonlyArray<AgentTask>): number {
  return tasks.filter((t) => !isTerminal(t.status)).length
}

/** The state word the fold colours by. */
export function foldState(task: AgentTask): string {
  if (task.status === 'done') return 'done'
  if (task.status === 'failed') return 'failed'
  if (task.status === 'cancelled') return 'denied'
  return 'running'
}

export function elapsed(task: AgentTask, now: number): number {
  return taskElapsedSeconds(task, now)
}
