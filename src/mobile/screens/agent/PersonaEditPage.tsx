/**
 * E6 Persona. Route /settings/personas/:id, page, strand 2 (Agent and knowledge).
 *
 * The editor of one persona. The id "new" is a persona that does not exist
 * yet. Leaving with unsaved input asks "Discard changes?" (G3).
 */
import { useState } from 'react'
import { UserX } from 'lucide-react'
import { useSettingsStore } from '../../../stores/settingsStore'
import { shownPersona } from '../../policy/personas'
import type { Persona } from '../../../types/settings'
import { nav, useParams } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, EmptyState, Field, Notice, Page, TextArea, toast } from '../../ui'
import './parts/agent.css'
import { useGuardedLeave } from './parts/leave'
import { NEW_ID, newPersonaId, personaProblem } from './parts/persona-logic'

const S = T.personas.editor

export default function PersonaEditPage() {
  const { id } = useParams<{ id: string }>()
  // A persona this build does not list cannot be opened either (store switch unfilteredPersonas).
  const existing = shownPersona(useSettingsStore((s) => s.personas.find((p) => p.id === id)))
  if (id !== NEW_ID && !existing) {
    return (
      <Page title={S.titleEdit} screen="settings-persona">
        <EmptyState
          title={S.gone}
          icon={UserX}
          testid="m-persona-gone"
          actions={
            <Button onPress={() => void nav.back()} testid="m-persona-gone-back">
              {S.back}
            </Button>
          }
        >
          {S.goneText}
        </EmptyState>
      </Page>
    )
  }
  return <Editor key={id} persona={existing ?? null} />
}

function Editor({ persona }: { persona: Persona | null }) {
  const [name, setName] = useState(persona?.name ?? '')
  const [instructions, setInstructions] = useState(persona?.systemPrompt ?? '')
  const [problem, setProblem] = useState<ReturnType<typeof personaProblem>>(null)
  const dirty = name !== (persona?.name ?? '') || instructions !== (persona?.systemPrompt ?? '')
  const leave = useGuardedLeave(dirty)

  const save = () => {
    const store = useSettingsStore.getState()
    const found = personaProblem({ id: persona?.id ?? null, name, instructions }, store.personas)
    setProblem(found)
    if (found) return
    if (persona) {
      store.updatePersona(persona.id, { name: name.trim(), systemPrompt: instructions.trim() })
    } else {
      store.addPersona({
        id: newPersonaId(name, store.personas, () => Math.random().toString(36).slice(2, 6)),
        name: name.trim(),
        icon: 'User',
        systemPrompt: instructions.trim(),
        isBuiltIn: false,
      })
    }
    toast(S.saved, { testid: 'persona-saved' })
    leave()
  }

  const remove = async () => {
    if (!persona) return
    const yes = await nav.confirm({ title: S.deleteTitle(persona.name), text: S.deleteText, confirmLabel: T.common.delete, tone: 'danger', testid: 'persona-delete' })
    if (!yes) return
    useSettingsStore.getState().removePersona(persona.id)
    toast(S.deleted, { testid: 'persona-deleted' })
    leave()
  }

  return (
    <Page
      title={persona ? S.titleEdit : S.titleNew}
      screen="settings-persona"
      footer={
        <Button variant="primary" block disabled={!dirty} disabledReason={S.unchanged} onPress={save} testid="m-persona-save" el="E6.7">
          {S.save}
        </Button>
      }
    >
      {persona?.isBuiltIn ? (
        <Notice variant="info" testid="m-persona-builtin">
          {S.builtInNote}
        </Notice>
      ) : null}
      <div className="m-ag-block m-stackv">
        <Field
          label={S.name}
          value={name}
          onChange={(value) => {
            setName(value)
            setProblem(null)
          }}
          placeholder={S.namePlaceholder}
          error={problem === 'name-empty' ? S.nameEmpty : problem === 'name-taken' ? S.nameTaken : undefined}
          maxLength={60}
          autoFocus={!persona}
          testid="m-persona-name"
          el="E6.5"
        />
        <TextArea
          label={S.instructions}
          value={instructions}
          onChange={(value) => {
            setInstructions(value)
            setProblem(null)
          }}
          placeholder={S.instructionsPlaceholder}
          hint={S.instructionsHint}
          error={problem === 'instructions-empty' ? S.instructionsEmpty : undefined}
          rows={12}
          testid="m-persona-instructions"
          el="E6.6"
        />
      </div>
      {persona && !persona.isBuiltIn ? (
        <div className="m-ag-actions">
          <Button risk="destructive" variant="danger" block onPress={() => void remove()} testid="m-persona-delete" el="E6.8">
            {S.delete}
          </Button>
        </div>
      ) : null}
    </Page>
  )
}
