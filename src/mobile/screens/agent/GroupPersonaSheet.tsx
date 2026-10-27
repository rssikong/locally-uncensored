/**
 * Sheet "agent-group-persona": the persona one participant of a group chat
 * speaks as (C13.3). Opened with nav.openSheet('agent-group-persona', { chatId, model }).
 */
import { useChatStore } from '../../../stores/chatStore'
import { useModelStore } from '../../../stores/modelStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { offeredPersonas } from '../../policy/personas'
import { useSheet } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { ListGroup, Notice, Row, Sheet } from '../../ui'
import './parts/agent.css'
import type { GroupProps } from './parts/group-logic'
import { modelLabel } from './parts/model-names'

const S = T.groupChat

export default function GroupPersonaSheet() {
  const sheet = useSheet<GroupProps | undefined>()
  const chatId = sheet.props?.chatId ?? ''
  const model = sheet.props?.model ?? ''
  const personas = offeredPersonas(useSettingsStore((s) => s.personas))
  const name = useModelStore((s) => modelLabel(model, s.models))
  const chosen = useChatStore((s) => s.conversations.find((c) => c.id === chatId)?.groupPersonas?.[model] ?? null)
  const member = useChatStore((s) => !!s.conversations.find((c) => c.id === chatId)?.groupModels?.includes(model))

  const pick = (personaId: string | null) => {
    useChatStore.getState().setGroupPersona(chatId, model, personaId)
    sheet.close()
  }

  if (!member) {
    return (
      <Sheet title={S.persona}>
        <Notice variant="warn" testid="m-group-persona-gone">
          {S.gone}
        </Notice>
      </Sheet>
    )
  }

  return (
    <Sheet title={S.personaTitle(name)}>
      <ListGroup role="radiogroup" label={S.personaTitle(name)} testid="m-group-persona-list">
        <Row title={S.personaFollow} subtitle={S.personaFollowSub} radio={{ checked: chosen === null, onSelect: () => pick(null) }} testid="m-group-persona-follow" el="C13.3" />
        {personas.map((persona) => (
          <Row
            key={persona.id}
            title={persona.name}
            radio={{ checked: chosen === persona.id, onSelect: () => pick(persona.id) }}
            testid={`m-group-persona-${persona.id}`}
            el="C13.3"
          />
        ))}
      </ListGroup>
    </Sheet>
  )
}
