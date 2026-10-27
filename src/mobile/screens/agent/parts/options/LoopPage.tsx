import { useState } from 'react'
import { useConversationLoop } from '../../../../../stores/agentLoopStore'
import { useSheet } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, Notice, Segmented, Sheet, TextArea, toast } from '../../../../ui'
import { useChatSend, wasSent } from '../adapters/chat-send'
import { stopAgentLoop } from '../../../../../hooks/useAgentChat'
import type { ChatSettings } from './chat-settings'

const S = T.options.loopPage

export const LOOP_INTERVALS = ['30s', '2m', '10m', '30m'] as const
export type LoopInterval = (typeof LOOP_INTERVALS)[number]

/** Pure: the command the page sends. The same text a user would type. */
export function loopCommand(interval: LoopInterval, task: string): string {
  return `/loop ${interval} ${task.trim()}`
}

/** C5.16: task, pause between passes and "Start loop". The same as typing /loop. */
export function LoopPage({ chat }: { chat: ChatSettings }) {
  const sheet = useSheet()
  const sender = useChatSend(chat.key)
  const running = useConversationLoop(chat.key)
  const [task, setTask] = useState('')
  const [interval, setInterval] = useState<LoopInterval>('2m')
  const [error, setError] = useState<string | undefined>()

  const blocked = !chat.saved ? T.options.needsSavedChat : !chat.agentOn ? S.needsAgent : sender.busy ? S.busy : null

  const start = async () => {
    if (!task.trim()) {
      setError(S.empty)
      return
    }
    const outcome = await sender.send(loopCommand(interval, task))
    if (wasSent(outcome)) {
      toast(S.started, { testid: 'loop-started' })
      sheet.close()
    }
  }

  return (
    <Sheet
      title={S.title}
      footer={
        running ? (
          <Button
            block
            onPress={() => {
              stopAgentLoop(chat.key)
              toast(S.stopped, { testid: 'loop-stopped' })
            }}
            testid="m-options-loop-stop"
            el="C5.16"
          >
            {S.stop}
          </Button>
        ) : (
          <Button variant="primary" block disabled={!!blocked} disabledReason={blocked ?? undefined} onPress={() => void start()} testid="m-options-loop-start" el="C5.16">
            {S.start}
          </Button>
        )
      }
    >
      <p className="m-ag-text">{S.text}</p>
      {running ? (
        <Notice variant="info" testid="m-options-loop-running">
          {S.running(running.pass)}
        </Notice>
      ) : null}
      {chat.saved && !chat.agentOn && !running ? (
        <Notice
          variant="info"
          testid="m-options-loop-needs-agent"
          actions={
            <Button compact onPress={() => chat.setAgent(true)} testid="m-options-loop-agent-on">
              {S.turnOnAgent}
            </Button>
          }
        >
          {S.needsAgent}
        </Notice>
      ) : null}
      <div className="m-ag-block m-stackv">
        <TextArea
          label={S.label}
          value={task}
          onChange={(value) => {
            setTask(value)
            setError(undefined)
          }}
          placeholder={S.placeholder}
          rows={4}
          error={error}
          disabled={!!running}
          testid="m-options-loop-task"
          el="C5.16"
        />
        <span className="m-field-label">{S.interval}</span>
        <Segmented
          label={S.interval}
          value={interval}
          onChange={setInterval}
          options={LOOP_INTERVALS.map((value) => ({ value, label: S.intervals[value], disabled: !!running, testid: `m-options-loop-${value}` }))}
          testid="m-options-loop-interval"
          el="C5.16"
        />
      </div>
      <p className="m-ag-text">{S.hint}</p>
    </Sheet>
  )
}
