/**
 * E7 Memory. Route /settings/memory/:id, page, strand 2 (Agent and knowledge).
 *
 * One memory: text, category, project, with "Save" and "Delete" (E7.3). The
 * id "new" is a memory that does not exist yet (E7.4).
 */
import { useState } from 'react'
import { BrainCog } from 'lucide-react'
import { formatDate } from '../../../lib/formatters'
import { useMemoryStore } from '../../../stores/memoryStore'
import type { MemoryFile, MemoryType } from '../../../types/agent-mode'
import { nav, useParams } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, Chip, ChipGroup, EmptyState, Field, ListGroup, Notice, Page, Row, TextArea, toast } from '../../ui'
import './parts/agent.css'
import { useGuardedLeave } from './parts/leave'
import { isOutdated, MEMORY_TYPES, memoryFields, memoryProblem, NEW_MEMORY, sourceKind, TITLE_MAX } from './parts/memory-logic'

const S = T.memory.detail

export default function MemoryDetailPage() {
  const { id } = useParams<{ id: string }>()
  const entry = useMemoryStore((s) => s.entries.find((e) => e.id === id))
  if (id !== NEW_MEMORY && !entry) {
    return (
      <Page title={S.titleEdit} screen="settings-memory-detail">
        <EmptyState
          title={S.gone}
          icon={BrainCog}
          testid="m-memory-detail-gone"
          actions={
            <Button onPress={() => void nav.back()} testid="m-memory-detail-gone-back">
              {S.back}
            </Button>
          }
        >
          {S.goneText}
        </EmptyState>
      </Page>
    )
  }
  return <Editor key={id} entry={entry ?? null} />
}

function Editor({ entry }: { entry: MemoryFile | null }) {
  const [title, setTitle] = useState(entry?.title ?? '')
  const [text, setText] = useState(entry?.content ?? '')
  const [type, setType] = useState<MemoryType>(entry?.type ?? 'user')
  const [project, setProject] = useState(entry?.scope ?? '')
  const [sensitive, setSensitive] = useState(entry?.sensitive === true)
  const [error, setError] = useState<{ field: 'title' | 'text'; text: string } | null>(null)
  const outdated = entry ? isOutdated(entry) : false

  const dirty =
    title !== (entry?.title ?? '') || text !== (entry?.content ?? '') || type !== (entry?.type ?? 'user') || project !== (entry?.scope ?? '') || sensitive !== (entry?.sensitive === true)
  const leave = useGuardedLeave(dirty)

  const save = () => {
    const problem = memoryProblem({ title, text })
    if (problem) {
      setError(problem === 'title-empty' ? { field: 'title', text: S.nameEmpty } : { field: 'text', text: S.textEmpty })
      return
    }
    const fields = memoryFields({ title, text })
    const scope = project.trim() || undefined
    const store = useMemoryStore.getState()
    if (entry) {
      store.updateMemory(entry.id, { ...fields, type, scope, sensitive })
    } else {
      const id = store.addMemory({ ...fields, type, tags: [], source: 'manual', sensitive, scope })
      if (!id) {
        setError({ field: 'text', text: S.duplicate })
        return
      }
    }
    toast(S.saved, { testid: 'memory-saved' })
    leave()
  }

  const remove = async () => {
    if (!entry) return
    const yes = await nav.confirm({ title: S.deleteTitle, text: S.deleteText, confirmLabel: S.delete, tone: 'danger', testid: 'memory-delete' })
    if (!yes) return
    useMemoryStore.getState().removeMemory(entry.id)
    toast(S.deleted, { testid: 'memory-deleted' })
    leave()
  }

  return (
    <Page
      title={entry ? S.titleEdit : S.titleNew}
      screen="settings-memory-detail"
      footer={
        <Button variant="primary" block disabled={!dirty || outdated} disabledReason={outdated ? S.outdated : T.personas.editor.unchanged} onPress={save} testid="m-memory-save" el="E7.3">
          {S.save}
        </Button>
      }
    >
      {outdated ? (
        <Notice variant="warn" testid="m-memory-outdated">
          {S.outdated}
        </Notice>
      ) : null}
      <div className="m-ag-block m-stackv">
        <Field
          label={S.name}
          value={title}
          onChange={(value) => {
            setTitle(value)
            setError(null)
          }}
          placeholder={S.namePlaceholder}
          error={error?.field === 'title' ? error.text : undefined}
          maxLength={TITLE_MAX}
          disabled={outdated}
          testid="m-memory-title"
          el="E7.3"
        />
        <TextArea
          label={S.text}
          value={text}
          onChange={(value) => {
            setText(value)
            setError(null)
          }}
          placeholder={S.textPlaceholder}
          error={error?.field === 'text' ? error.text : undefined}
          rows={7}
          disabled={outdated}
          autoFocus={!entry}
          testid="m-memory-text"
          el="E7.3"
        />
        <span className="m-field-label">{S.category}</span>
      </div>
      <ChipGroup label={S.category} role="radiogroup" wrap testid="m-memory-category">
        {MEMORY_TYPES.map((value) => (
          <Chip key={value} kind="choice" selected={type === value} disabled={outdated} onPress={() => setType(value)} testid={`m-memory-category-${value}`} el="E7.3">
            {T.memory.types[value]}
          </Chip>
        ))}
      </ChipGroup>
      <div className="m-ag-block m-stackv" style={{ paddingTop: 12 }}>
        <Field label={S.project} value={project} onChange={setProject} placeholder={S.projectPlaceholder} hint={S.projectHint} disabled={outdated} testid="m-memory-project" el="E7.3" />
      </div>
      <ListGroup>
        <Row title={S.sensitive} subtitle={S.sensitiveSub} switch={{ checked: sensitive, onChange: setSensitive }} disabled={outdated} testid="m-memory-sensitive" el="E7.3" />
      </ListGroup>
      {entry ? (
        <>
          <p className="m-ag-text" data-testid="m-memory-meta">
            {[S.source[sourceKind(entry.source)], S.created(formatDate(entry.createdAt)), entry.confirmedAt ? S.reviewed(formatDate(entry.confirmedAt)) : S.notReviewed].join('. ')}
          </p>
          <div className="m-ag-actions">
            {!outdated ? (
              <Button
                block
                onPress={() => {
                  useMemoryStore.getState().confirmMemory(entry.id)
                  toast(S.confirmed, { testid: 'memory-confirmed' })
                }}
                testid="m-memory-confirm"
                el="E7.8"
              >
                {S.confirm}
              </Button>
            ) : null}
            <Button risk="destructive" variant="danger" block onPress={() => void remove()} testid="m-memory-delete" el="E7.3">
              {S.delete}
            </Button>
          </div>
        </>
      ) : null}
    </Page>
  )
}
