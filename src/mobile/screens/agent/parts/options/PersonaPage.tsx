import { useSettingsStore } from '../../../../../stores/settingsStore'
import { offeredPersonas } from '../../../../policy/personas'
import { nav } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { ListGroup, Row, Sheet } from '../../../../ui'
import type { ChatSettings } from './chat-settings'

const S = T.options.personaPage

/** C5.7: persona on or off for this chat, the choice of the persona, and the way to E6. */
export function PersonaPage({ chat }: { chat: ChatSettings }) {
  const personasEnabled = useSettingsStore((s) => s.settings.personasEnabled)
  const personas = offeredPersonas(useSettingsStore((s) => s.personas))
  const activeId = useSettingsStore((s) => s.activePersonaId)
  const on = personasEnabled && chat.personaOnChat
  return (
    <Sheet title={S.title}>
      <ListGroup>
        <Row
          title={S.useInChat}
          subtitle={on ? (chat.personaName ? S.inChatOn(chat.personaName) : S.inChatOnPlain) : S.useInChatSub}
          switch={{ checked: on, onChange: chat.setPersonaOnChat }}
          testid="m-options-persona-switch"
          el="C5.7"
        />
      </ListGroup>
      <ListGroup title={S.listTitle} role="radiogroup" testid="m-options-persona-list">
        {personas.map((persona) => (
          <Row
            key={persona.id}
            title={persona.name}
            subtitle={persona.isBuiltIn ? S.builtIn : S.own}
            radio={{ checked: chat.personaOnChat && chat.personaName ? persona.name === chat.personaName : persona.id === activeId, onSelect: () => chat.choosePersona(persona.id) }}
            testid={`m-options-persona-${persona.id}`}
            el="C5.7"
          />
        ))}
      </ListGroup>
      <p className="m-ag-text">{S.listHint}</p>
      <ListGroup>
        <Row title={S.manage} onPress={() => nav.push('/settings/personas')} testid="m-options-persona-manage" el="C5.7" />
      </ListGroup>
    </Sheet>
  )
}
