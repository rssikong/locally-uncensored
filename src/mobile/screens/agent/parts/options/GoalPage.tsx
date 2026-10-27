import { useState } from 'react'
import { MAX_GOAL_LENGTH, useAgentGoalStore } from '../../../../../stores/agentGoalStore'
import { useSheet } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, Sheet, TextArea, toast } from '../../../../ui'
import { touchChat } from '../chat-ref'

const S = T.options.goalPage

/** C5.15: a text field and "Set goal". The same as typing /goal. */
export function GoalPage({ chatKey }: { chatKey: string }) {
  const sheet = useSheet()
  const current = useAgentGoalStore((s) => s.goals[chatKey]?.text ?? '')
  const [text, setText] = useState(current)
  const [error, setError] = useState<string | undefined>()

  const save = () => {
    const trimmed = text.trim()
    if (!trimmed) {
      setError(S.empty)
      return
    }
    if (trimmed.length > MAX_GOAL_LENGTH) {
      setError(S.tooLong(MAX_GOAL_LENGTH))
      return
    }
    touchChat(chatKey)
    useAgentGoalStore.getState().setGoal(chatKey, trimmed)
    toast(S.done, { testid: 'goal-set' })
    sheet.close()
  }

  return (
    <Sheet
      title={S.title}
      footer={
        <div className="m-ag-buttons">
          <Button variant="primary" block onPress={save} testid="m-options-goal-set" el="C5.15">
            {current ? S.update : S.set}
          </Button>
          {current ? (
            <Button
              block
              onPress={() => {
                useAgentGoalStore.getState().clearGoal(chatKey)
                setText('')
                toast(S.cleared, { testid: 'goal-cleared' })
              }}
              testid="m-options-goal-clear"
              el="C5.15"
            >
              {S.clear}
            </Button>
          ) : null}
        </div>
      }
    >
      <p className="m-ag-text">{S.text}</p>
      <div className="m-ag-block">
        <TextArea
          label={S.label}
          value={text}
          onChange={(value) => {
            setText(value)
            setError(undefined)
          }}
          placeholder={S.placeholder}
          rows={4}
          maxLength={MAX_GOAL_LENGTH}
          error={error}
          testid="m-options-goal-text"
          el="C5.15"
        />
      </div>
    </Sheet>
  )
}
