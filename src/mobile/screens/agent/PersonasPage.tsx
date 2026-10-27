/**
 * E6 Personas. Route /settings/personas, page, strand 2 (Agent and knowledge).
 *
 * The switch for personas, the list with the active one as a radio choice,
 * the way into the editor (PersonaEditPage) and the reset of the built in
 * ones. The personas live in the settings store, as on the desktop.
 */
import { Pencil, Plus } from 'lucide-react'
import { BUILT_IN_PERSONAS } from '../../../lib/constants'
import { offeredPersonas } from '../../policy/personas'
import { useSettingsStore } from '../../../stores/settingsStore'
import { nav } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, IconButton, ListGroup, Page, Row, toast } from '../../ui'
import './parts/agent.css'
import { changedBuiltIns, NEW_ID } from './parts/persona-logic'

const S = T.personas

export default function PersonasPage() {
  const enabled = useSettingsStore((s) => s.settings.personasEnabled)
  // What this build lists, under the names it shows (store switch unfilteredPersonas). Reset works on what is saved.
  const saved = useSettingsStore((s) => s.personas)
  const personas = offeredPersonas(saved)
  const activeId = useSettingsStore((s) => s.activePersonaId)
  const changed = changedBuiltIns(saved, BUILT_IN_PERSONAS)

  const reset = async () => {
    const yes = await nav.confirm({ title: S.resetTitle, text: S.resetText, confirmLabel: S.resetConfirm, tone: 'danger', testid: 'personas-reset' })
    if (!yes) return
    const store = useSettingsStore.getState()
    for (const original of changedBuiltIns(store.personas, BUILT_IN_PERSONAS)) {
      if (store.personas.some((p) => p.id === original.id)) store.updatePersona(original.id, { name: original.name, icon: original.icon, systemPrompt: original.systemPrompt, isBuiltIn: true })
      else store.addPersona({ ...original })
    }
    toast(S.resetDone, { testid: 'personas-reset-done' })
  }

  return (
    <Page
      title={S.title}
      screen="settings-personas"
      footer={
        <Button variant="primary" block icon={Plus} onPress={() => nav.push('/settings/personas/:id', { id: NEW_ID })} testid="m-personas-add" el="E6.4">
          {S.add}
        </Button>
      }
    >
      <ListGroup>
        <Row
          title={S.use}
          subtitle={enabled ? S.useSub : S.off}
          switch={{ checked: enabled, onChange: (on) => useSettingsStore.getState().updateSettings({ personasEnabled: on }) }}
          testid="m-personas-use"
          el="E6.1"
        />
      </ListGroup>
      <ListGroup title={S.listTitle} role="radiogroup" testid="m-personas-list">
        {personas.map((persona) => (
          <Row
            key={persona.id}
            title={persona.name}
            subtitle={persona.isBuiltIn ? S.builtIn : S.own}
            radio={{ checked: persona.id === activeId, onSelect: () => useSettingsStore.getState().setActivePersona(persona.id) }}
            trailing={<IconButton icon={Pencil} label={S.editName(persona.name)} onPress={() => nav.push('/settings/personas/:id', { id: persona.id })} testid={`m-personas-edit-${persona.id}`} el="E6.3" />}
            testid={`m-personas-pick-${persona.id}`}
            el="E6.2"
          />
        ))}
      </ListGroup>
      <p className="m-ag-text">{S.hint}</p>
      <div className="m-ag-actions">
        <Button risk="destructive" block disabled={changed.length === 0} disabledReason={S.resetNothing} onPress={() => void reset()} testid="m-personas-reset" el="E6.9">
          {S.reset}
        </Button>
      </div>
    </Page>
  )
}
