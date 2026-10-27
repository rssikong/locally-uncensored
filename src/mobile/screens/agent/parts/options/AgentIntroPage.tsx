import { useSubAgentsOffered } from '../sub-agents-here'
import { useAgentToolSupport } from '../tool-support'
import { useAgentModeStore } from '../../../../../stores/agentModeStore'
import { useSheet } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, Notice, Sheet } from '../../../../ui'
import type { ChatSettings } from './chat-settings'

const S = T.options.intro

/** C5.1, first time: what Agent mode is, with "Turn on" and "Not now". */
export function AgentIntroPage({ chat }: { chat: ChatSettings }) {
  const sheet = useSheet()
  const tools = useAgentToolSupport()
  const points = useSubAgentsOffered() ? S.points : S.pointsOnDevice
  return (
    <Sheet
      title={S.title}
      footer={
        <div className="m-ag-buttons">
          <Button
            variant="primary"
            block
            onPress={() => {
              useAgentModeStore.getState().setTutorialCompleted()
              chat.setAgent(true)
              sheet.back()
            }}
            testid="m-options-intro-on"
            el="C5.1"
          >
            {S.turnOn}
          </Button>
          <Button block onPress={() => sheet.back()} testid="m-options-intro-later" el="C5.1">
            {S.notNow}
          </Button>
        </div>
      }
    >
      <div data-testid="m-options-intro">
        <p className="m-ag-sheet-text">{S.lead}</p>
        <ul className="m-ag-sheet-text" style={{ paddingLeft: 36 }}>
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <p className="m-ag-text">{S.battery}</p>
        {tools.modelName && !tools.canUseTools ? (
          <Notice variant="warn" testid="m-options-intro-notools">
            {S.noTools}
          </Notice>
        ) : null}
      </div>
    </Sheet>
  )
}
