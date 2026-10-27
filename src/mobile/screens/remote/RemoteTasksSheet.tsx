/**
 * "Running on your computer" (A17, CHATS-V1 `tasks`). Sheet "remote-tasks",
 * opened from a shared chat, from Remote desktop and from Create on "My
 * computer". Every answer and every render that runs there, with Stop:
 * an answer through `chats/{id}/stop`, a render through
 * `create/jobs/{id}/cancel`.
 */
import { useEffect, useState } from 'react'
import { Image as ImageIcon, MessageSquare, RefreshCw, Square } from 'lucide-react'
import { nav, useSheet } from '../../nav'
import { cancelJob } from '../../remote/desktopCreate'
import { refreshTasks, stopSharedAnswer, useSharedChats } from '../../remote/sharedChatStore'
import type { SharedTask } from '../../remote/sharedChats'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, EmptyState, IconButton, ListGroup, Notice, Row, Sheet, SkeletonRows, toast } from '../../ui'
import { remote } from './parts/session'
import './parts/remote.css'

async function stopTask(task: SharedTask): Promise<boolean> {
  if (task.kind === 'chat' && task.chatId) return (await stopSharedAnswer(task.chatId)) === null
  const ch = remote().desktopChannel()
  if (task.kind === 'create' && task.jobId && ch) {
    try {
      await cancelJob(ch, task.jobId)
      return true
    } catch {
      return false
    }
  }
  return false
}

export default function RemoteTasksSheet() {
  const sheet = useSheet()
  const tasks = useSharedChats((s) => s.tasks)
  const state = useSharedChats((s) => s.tasksState)
  const error = useSharedChats((s) => s.tasksError)
  const [stopping, setStopping] = useState<string | null>(null)

  useEffect(() => {
    void refreshTasks()
    // While the sheet is open the list follows what runs.
    const timer = window.setInterval(() => void refreshTasks(), 3_000)
    return () => window.clearInterval(timer)
  }, [])

  const stop = async (task: SharedTask) => {
    setStopping(task.id)
    const ok = await stopTask(task)
    setStopping(null)
    toast(ok ? S.tasks.stopped : S.tasks.stopFailed, { tone: ok ? 'default' : 'error', testid: ok ? 'remote-task-stopped' : 'remote-task-stop-failed' })
    void refreshTasks()
  }

  return (
    <Sheet
      title={S.tasks.title}
      testid="m-remote-tasks"
      footer={
        <Button block icon={RefreshCw} onPress={() => void refreshTasks()} testid="m-remote-tasks-refresh">
          {S.tasks.refresh}
        </Button>
      }
    >
      {state === 'loading' && tasks.length === 0 ? <SkeletonRows rows={2} label={S.tasks.loading} testid="m-remote-tasks-loading" /> : null}
      {state === 'error' ? <Notice variant="error" testid="m-remote-tasks-error">{error}</Notice> : null}
      {state === 'ok' && tasks.length === 0 ? (
        <EmptyState title={S.tasks.title} testid="m-remote-tasks-empty">
          {S.tasks.empty}
        </EmptyState>
      ) : null}
      {tasks.length > 0 ? (
        <ListGroup testid="m-remote-tasks-list">
          {tasks.map((t) => (
            <Row
              key={t.id}
              icon={t.kind === 'chat' ? MessageSquare : ImageIcon}
              title={t.title || (t.kind === 'chat' ? S.tasks.chat : S.tasks.create)}
              subtitle={[t.kind === 'chat' ? S.tasks.chat : S.tasks.create, t.progress !== null ? `${Math.round(t.progress * 100)} %` : t.state].join(', ')}
              chevron={false}
              onPress={
                t.kind === 'chat' && t.chatId
                  ? () => {
                      sheet.close()
                      nav.push('/remote/shared/:id', { id: t.chatId! })
                    }
                  : undefined
              }
              trailing={
                <IconButton
                  icon={Square}
                  risk="destructive"
                  label={S.tasks.stopLabel(t.title || S.tasks.chat)}
                  disabled={stopping === t.id}
                  onPress={() => void stop(t)}
                  testid="m-remote-task-stop"
                />
              }
              testid="m-remote-task"
            />
          ))}
        </ListGroup>
      ) : null}
    </Sheet>
  )
}
