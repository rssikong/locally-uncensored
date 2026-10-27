/**
 * Sheet "agent-memory-conflict" (E7.10): one memory was changed on this
 * phone and in the account. Shows both versions and takes the choice:
 * "Keep this phone", "Keep account" or "Keep both". All three are choices of
 * the sync library (lib/memory-sync.ts). "Keep both" keeps the phone version
 * and adds the account version as a memory of its own, in the same step.
 */
import { useMemoryStore } from '../../../stores/memoryStore'
import { useSheet } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, Notice, Progress, Sheet } from '../../ui'
import './parts/agent.css'
import { useMemorySync } from './parts/adapters/memory-sync'

const S = T.memory.conflict

export default function MemoryConflictSheet() {
  const sheet = useSheet()
  const conflicts = useMemorySync((s) => s.conflicts)
  const busy = useMemorySync((s) => s.busy)
  const note = useMemorySync((s) => s.note)
  const conflict = conflicts[0]
  const local = useMemoryStore((s) => (conflict ? s.entries.find((e) => e.id === conflict.id) : undefined))

  if (!conflict) {
    return (
      <Sheet
        title={S.title}
        footer={
          <Button block onPress={() => sheet.close()} testid="m-memory-conflict-close">
            {T.common.close}
          </Button>
        }
      >
        <p className="m-ag-sheet-text" data-testid="m-memory-conflict-none">
          {S.none}
        </p>
      </Sheet>
    )
  }

  const review = conflict.review
  const choose = async (choice: 'local' | 'cloud' | 'both') => {
    if (!review) return
    const ok = await useMemorySync.getState().run(review.token.owner, { ...review.token, choice, ...(choice === 'both' ? { copySuffix: S.copySuffix } : {}) })
    // The next conflict, if there is one, is shown by this same sheet.
    if (ok && useMemorySync.getState().conflicts.length === 0) sheet.close()
  }

  return (
    <Sheet
      title={S.title}
      footer={
        review ? (
          <div className="m-ag-buttons">
            <Button variant="primary" block disabled={busy} onPress={() => void choose('local')} testid="m-memory-conflict-phone" el="E7.10">
              {S.keepPhone}
            </Button>
            <Button block disabled={busy} onPress={() => void choose('cloud')} testid="m-memory-conflict-account" el="E7.10">
              {S.keepAccount}
            </Button>
            <Button variant="quiet" block disabled={busy} onPress={() => void choose('both')} testid="m-memory-conflict-both" el="E7.10">
              {S.keepBoth}
            </Button>
          </div>
        ) : (
          <Button block onPress={() => sheet.close()} testid="m-memory-conflict-close">
            {T.common.close}
          </Button>
        )
      }
    >
      <p className="m-ag-sheet-text">{review ? S.text : S.noPreview}</p>
      <div className="m-ag-block m-stackv">
        <div className="m-ag-kv" data-testid="m-memory-conflict-local">
          <span>{S.phone}</span>
          <div className="m-ag-pre m-ag-pre--plain">{local ? `${local.title}\n\n${local.content}` : conflict.id}</div>
        </div>
        {review ? (
          <div className="m-ag-kv" data-testid="m-memory-conflict-cloud">
            <span>{S.account}</span>
            <div className="m-ag-pre m-ag-pre--plain">{`${review.cloud.title}\n\n${review.cloud.content}`}</div>
          </div>
        ) : null}
      </div>
      {review ? <p className="m-ag-text">{S.keepBothHint}</p> : null}
      {conflicts.length > 1 ? <p className="m-ag-text">{S.more(conflicts.length - 1)}</p> : null}
      {busy ? (
        <div className="m-ag-block">
          <Progress label={T.memory.syncing} detail={T.memory.syncing} />
        </div>
      ) : note?.kind === 'error' ? (
        <Notice variant="error" testid="m-memory-conflict-error">
          {note.text}
        </Notice>
      ) : null}
    </Sheet>
  )
}
