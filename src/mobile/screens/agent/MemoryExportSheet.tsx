/**
 * Sheet "agent-memory-export" (E7.12): Markdown or JSON, then the share
 * sheet of the phone (lib/save-or-share).
 */
import { useState } from 'react'
import { FileJson, FileText } from 'lucide-react'
import { saveOrShare } from '../../../lib/save-or-share'
import { useMemoryStore } from '../../../stores/memoryStore'
import { useSheet } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { CHAT_STRINGS } from '../../strings/chat'
import { saveBlobToPhone, saveNote, type SaveNote } from '../chat/parts/adapters/handover'
import { ListGroup, Notice, Row, Sheet, toast } from '../../ui'
import './parts/agent.css'

const S = T.memory

export default function MemoryExportSheet() {
  const sheet = useSheet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // What "Save to this phone" came to. It stays on the sheet, so the user reads where the file is.
  const [saved, setSaved] = useState<SaveNote | null>(null)

  const save = async (kind: 'md' | 'json') => {
    if (busy) return
    setBusy(true)
    setError(null)
    setSaved(null)
    const store = useMemoryStore.getState()
    const name = kind === 'md' ? 'lu-memory.md' : 'lu-memory.json'
    let note: SaveNote
    try {
      note = saveNote(await saveBlobToPhone(name, kind === 'md' ? 'text/markdown' : 'application/json', kind === 'md' ? store.exportAsMarkdown() : store.exportAsJSON()), name)
    } catch {
      note = saveNote('failed', name)
    }
    setBusy(false)
    setSaved(note)
    if (note.ok) toast(CHAT_STRINGS.save.savedToast, { testid: 'memory-saved' })
  }

  const run = async (kind: 'md' | 'json') => {
    if (busy) return
    setBusy(true)
    setError(null)
    const store = useMemoryStore.getState()
    const outcome =
      kind === 'md'
        ? await saveOrShare({ filename: 'lu-memory.md', mime: 'text/markdown', text: store.exportAsMarkdown() }, { via: 'anchor' })
        : await saveOrShare({ filename: 'lu-memory.json', mime: 'application/json', text: store.exportAsJSON() }, { via: 'anchor' })
    setBusy(false)
    if (outcome.status === 'error') {
      setError(S.exportFailed(outcome.error))
      return
    }
    if (outcome.status === 'cancelled') return
    toast(S.exported, { testid: 'memory-exported' })
    sheet.close()
  }

  return (
    <Sheet title={S.exportTitle}>
      <ListGroup title={CHAT_STRINGS.save.shareGroup} testid="m-memory-export-kinds">
        <Row title={S.exportMarkdown} subtitle={S.exportMarkdownSub} icon={FileText} chevron={false} disabled={busy} onPress={() => void run('md')} risk="leaves-app" testid="m-memory-export-md" el="E7.12" />
        <Row title={S.exportJson} subtitle={S.exportJsonSub} icon={FileJson} chevron={false} disabled={busy} onPress={() => void run('json')} risk="leaves-app" testid="m-memory-export-json" el="E7.12" />
      </ListGroup>
      <ListGroup title={CHAT_STRINGS.save.saveGroup} testid="m-memory-save-kinds">
        <Row title={S.exportMarkdown} subtitle={CHAT_STRINGS.save.saveSub} icon={FileText} chevron={false} disabled={busy} onPress={() => void save('md')} testid="m-memory-save-md" el="E7.12" />
        <Row title={S.exportJson} subtitle={CHAT_STRINGS.save.saveSub} icon={FileJson} chevron={false} disabled={busy} onPress={() => void save('json')} testid="m-memory-save-json" el="E7.12" />
      </ListGroup>
      {saved ? (
        <Notice variant={saved.tone} testid="m-memory-save-note">
          {saved.text}
        </Notice>
      ) : null}
      {error ? (
        <Notice variant="error" testid="m-memory-export-error">
          {error}
        </Notice>
      ) : null}
    </Sheet>
  )
}
