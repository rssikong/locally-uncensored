/**
 * C14 File. Route /chat/:id/file/:fileId, full screen, strand 1 (Chat core).
 *
 * Shows an image of a message or of the composer, the text of an artifact,
 * or, when there is no preview, the name and size of a file. "Share" hands it
 * to the share sheet of the system, "Save to Photos" exists only for images.
 * Images zoom with two fingers and with a double tap (ui/MediaViewer).
 *
 * A file the agent wrote into the folder of the chat is shown the same way
 * and can be deleted after a question (audit L4).
 */
import { useEffect, useState } from 'react'
import { Download, FileQuestion, Share2, Trash2, X } from 'lucide-react'
import { formatBytes } from '../../../lib/formatters'
import { useChatStore } from '../../../stores/chatStore'
import { nav, useParams } from '../../nav'
import { CHAT_STRINGS } from '../../strings/chat'
import { Icon, IconButton, MediaViewer, Spinner, toast } from '../../ui'
import { saveImage, shareBlob } from './parts/adapters/handover'
import './parts/chat.css'
import { resolveFile, type FileSource } from './parts/file-source'
import { useDraftStore } from './parts/logic/drafts'
import { decodeFileRef } from './parts/logic/messages'
import { deleteWorkspaceFile, workspaceDeleteMissing } from './parts/workspace-files'

const S = CHAT_STRINGS.viewer

type Loaded = { state: 'loading' } | { state: 'gone' } | { state: 'ready'; source: FileSource; url?: string }

export default function FileViewerPage() {
  const { id, fileId } = useParams<{ id: string; fileId: string }>()
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState<'share' | 'save' | 'delete' | null>(null)
  const ref = decodeFileRef(fileId)
  const workspacePath = ref?.kind === 'workspace' ? ref.path : null
  // Once this build said it cannot delete, the button goes: a button without effect helps nobody.
  const [canDelete, setCanDelete] = useState(() => !workspaceDeleteMissing())

  useEffect(() => {
    let alive = true
    let url: string | undefined
    const chat = useChatStore.getState().conversations.find((c) => c.id === id)
    const draft = useDraftStore.getState().drafts[id]
    resolveFile(fileId, chat, draft)
      .then((source) => {
        if (!alive) return
        if (!source) {
          setLoaded({ state: 'gone' })
          return
        }
        if (source.kind === 'image') url = URL.createObjectURL(source.blob)
        setLoaded({ state: 'ready', source, url })
      })
      .catch(() => {
        if (alive) setLoaded({ state: 'gone' })
      })
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
  }, [id, fileId])

  const close = () => void nav.back()
  const source = loaded.state === 'ready' ? loaded.source : null
  const blob = source && 'blob' in source ? source.blob : undefined

  const share = () => {
    if (!source || !blob || busy) return
    setBusy('share')
    void shareBlob(source.name, source.mime, blob)
      .then((result) => {
        if (result === 'failed') toast(CHAT_STRINGS.actions.shareFailed, { tone: 'error', testid: 'share-failed' })
        else if (result === 'done') toast(S.shared, { testid: 'shared' })
      })
      .finally(() => setBusy(null))
  }
  const save = () => {
    if (!source || source.kind !== 'image' || busy) return
    setBusy('save')
    void saveImage(source.name, source.mime, source.blob)
      .then(({ result, location }) => {
        if (result === 'done') toast(location ? S.savedTo(location) : S.saved, { testid: 'saved' })
        else if (result === 'failed') toast(S.saveFailed, { tone: 'error', testid: 'save-failed' })
      })
      .finally(() => setBusy(null))
  }

  const remove = () => {
    if (!workspacePath || !source || busy) return
    void nav.confirm({ title: S.deleteTitle(source.name), text: S.deleteText, confirmLabel: S.deleteConfirm, tone: 'danger', testid: 'delete-file' }).then((yes) => {
      if (!yes) return
      setBusy('delete')
      void deleteWorkspaceFile(id, workspacePath)
        .then((result) => {
          if (result === 'deleted') {
            toast(S.deleted, { testid: 'file-deleted' })
            void nav.back()
          } else if (result === 'unavailable') {
            setCanDelete(false)
            toast(S.deleteUnavailable, { tone: 'error', testid: 'delete-unavailable' })
          } else {
            toast(S.deleteFailed, { tone: 'error', testid: 'delete-failed' })
          }
        })
        .finally(() => setBusy(null))
    })
  }

  const actions = (
    <>
      {blob ? <IconButton icon={Share2} label={S.share} disabled={busy !== null} onPress={share} risk="leaves-app" testid="m-chat-file-share" el="C14.2" /> : null}
      {source?.kind === 'image' ? <IconButton icon={Download} label={S.save} disabled={busy !== null} onPress={save} risk="sensor" testid="m-chat-file-save" el="C14.3" /> : null}
      {workspacePath && source && canDelete ? <IconButton icon={Trash2} label={S.delete} disabled={busy !== null} onPress={remove} testid="m-chat-file-delete" el="C14.5" /> : null}
    </>
  )

  const info = (
    <div className="m-chat-fileinfo" data-testid="m-chat-file-info">
      <Icon icon={FileQuestion} />
      {loaded.state === 'gone' || !source ? (
        <>
          <strong>{S.gone}</strong>
          <span>{S.goneText}</span>
        </>
      ) : (
        <>
          <strong>{source.name}</strong>
          <span>{S.noPreview}</span>
          {source.kind === 'other' ? <span>{S.size(formatBytes(source.size))}</span> : null}
          {source.kind === 'other' && source.summary ? <span className="m-chat-filesummary">{source.summary}</span> : null}
        </>
      )}
    </div>
  )

  if (loaded.state === 'ready' && loaded.source.kind === 'image' && loaded.url) {
    return <MediaViewer kind="image" src={loaded.url} title={loaded.source.name} actions={actions} onClose={close} fallback={info} testid="m-chat-file-screen" el="C14.4" />
  }

  const title = source?.name ?? S.title
  return (
    <section className="m-viewer" aria-label={title} data-testid="m-chat-file-screen" data-state={loaded.state}>
      <div className="m-viewer-bar">
        <IconButton icon={X} label={CHAT_STRINGS.actions.close} onPress={close} testid="m-viewer-close" el="C14.1" />
        <h1 className="m-viewer-title" tabIndex={-1} data-m-focus-title="">
          {title}
        </h1>
        {actions}
      </div>
      <div className="m-viewer-stage m-chat-filestage">
        {loaded.state === 'loading' ? (
          <Spinner label={S.loading} />
        ) : source?.kind === 'text' ? (
          <pre className="m-chat-fileview" aria-label={S.textOf(source.name)} tabIndex={0} data-testid="m-chat-file-text">
            {source.text}
          </pre>
        ) : (
          info
        )}
      </div>
    </section>
  )
}
