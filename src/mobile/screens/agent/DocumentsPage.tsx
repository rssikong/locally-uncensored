/**
 * C8 Documents. Route /chat/:id/documents, kind page, tab chat, strand 2 (Agent and knowledge).
 *
 * Documents of one chat: the switch that turns the search on, the list with
 * the passages found last, adding with progress, removing, and the card that
 * installs the document model when it is missing. Reading and searching
 * happen on this phone (hooks/useRAG).
 *
 * A reading the phone interrupted stands in the store ("Index paused"), so
 * its row is still there after the page was left or LU was restarted. While
 * LU lives it continues with one tap. After a restart the file has to be
 * picked again, and the row says so.
 *
 * A reading that failed stands in the store too ("Failed", with the reason and
 * "Try again"), and so does the name of the file that is being read. Both
 * lived in this page only until round 5: a file that failed while the user
 * was in the chat was gone without a word (N1), and the progress row lost
 * its name when the page was opened again (N5).
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, FileText, FileWarning, Import, Play, Plus, Trash2 } from 'lucide-react'
import { useRAG } from '../../../hooks/useRAG'
import { documentContentHash, getMobileRagLimits } from '../../../api/rag'
import { formatBytes } from '../../../lib/formatters'
import { secondsLeft, type PaceSample } from '../../lib/reading-limits'
import { heldIndexFile, useRAGStore, type PausedIndex } from '../../../stores/ragStore'
import type { DocumentMeta } from '../../../types/rag'
import { MOBILE_EMBED_MODEL } from '../../data/mobile-models'
import { nav, useParams } from '../../nav'
import { holdInMemory, pickFiles } from '../../platform'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { MODELS_STRINGS } from '../../strings/models'
import { Button, Card, EmptyState, IconButton, ListGroup, Notice, Page, Progress, Row, toast } from '../../ui'
import type { FitView } from '../models/parts/fit'
import { startDownload } from '../models/parts/start-download'
import './parts/agent.css'
import { NEW_CHAT, useConversation } from './parts/chat-ref'
import { Fold } from './parts/Fold'
import { useActiveModelIsLocal } from './parts/model-state'
import { documentKind, failedOnly, failedRowText, holdAtPick, isAbort, passagesOf, pausedOnly, runningName, sameDocument, type FailedFile } from './parts/documents-logic'
import { slotTurnText, useDocumentJob, useSlotTurn } from './parts/slot-turn'

/** The document model is 80 MB: every phone that runs LU carries it, so no verdict stands in its way. */
const DOCUMENT_MODEL_FITS: FitView = { level: 'fits', needBytes: 0, usableBytes: 0, contextLength: 0, maxContext: 0, short: '', long: '' }

const S = T.documents
const ACCEPT = '.pdf,.docx,.txt'

export default function DocumentsPage() {
  const { id } = useParams<{ id: string }>()
  const conversation = useConversation(id)

  if (id === NEW_CHAT) {
    return (
      <Page title={S.title} screen="chat-documents">
        <EmptyState title={S.newChat} icon={FileText} testid="m-documents-new">
          {S.newChatText}
        </EmptyState>
      </Page>
    )
  }
  if (!conversation) {
    return (
      <Page title={S.title} screen="chat-documents">
        <EmptyState
          title={S.gone}
          icon={FileWarning}
          testid="m-documents-gone"
          actions={
            <Button onPress={() => nav.back()} testid="m-documents-gone-back">
              {S.backToChats}
            </Button>
          }
        >
          {S.goneText}
        </EmptyState>
      </Page>
    )
  }
  return <Documents chatId={id} />
}

function Documents({ chatId }: { chatId: string }) {
  const rag = useRAG(chatId)
  const local = useActiveModelIsLocal()
  const turn = slotTurnText(useSlotTurn())
  const job = useDocumentJob()
  const found = useRAGStore((s) => s.lastRetrievedChunks)
  const installPrompt = useRAGStore((s) => s.embeddingInstallPrompt)
  const pull = useRAGStore((s) => s.embeddingPullProgress)
  const queued = useRAGStore((s) => s.embeddingQueuedFiles.length)

  // null: not asked yet. The card (C8.6) shows only once the answer is "missing".
  const [ready, setReady] = useState<boolean | null>(null)
  const [working, setWorking] = useState<string | null>(null)
  const [failed, setFailed] = useState<FailedFile[]>([])
  const [installError, setInstallError] = useState(false)
  const cancelledByUser = useRef(false)
  /** Files whose bytes the page holds already (D1). */
  const inMemory = useRef(new WeakSet<File>())
  const alive = useRef(true)

  const { ensureEmbeddingModel } = rag
  const check = useCallback(async () => {
    try {
      const ok = await ensureEmbeddingModel()
      if (alive.current) setReady(ok)
    } catch {
      if (alive.current) setReady(false)
    }
  }, [ensureEmbeddingModel])

  useEffect(() => {
    alive.current = true
    void check()
    return () => {
      alive.current = false
    }
  }, [check])

  /** The file in the page's memory (D1), or null after a failed second read, said in the list. */
  const hold = async (file: File): Promise<File | null> => {
    if (inMemory.current.has(file) || file.size > getMobileRagLimits().maxFileBytes) return file
    try {
      const held = await holdInMemory(file)
      inMemory.current.add(held)
      return held
    } catch {
      setFailed((list) => [...list, { file, reason: S.fileGone(file.name) }])
      return null
    }
  }

  const read = async (picked: File) => {
    cancelledByUser.current = false
    setFailed((list) => list.filter((f) => f.file !== picked && f.file.name !== picked.name))
    const file = await hold(picked)
    if (!file) return
    // The same file twice is one document (N4). The content decides, the name only where there is no checksum.
    const contentHash = await documentContentHash(file)
    const known = sameDocument(useRAGStore.getState().documents[chatId] ?? [], { name: file.name, size: file.size, contentHash })
    if (known) {
      toast(known.name === file.name ? S.duplicate(file.name) : S.duplicateAs(file.name, known.name), { testid: 'document-duplicate' })
      return
    }
    if (alive.current) setWorking(file.name)
    try {
      const meta = await rag.uploadDocument(file, { trackPause: true })
      if (meta) {
        // Also when this page was left meanwhile: the reading went on, and its end is said where the user is now.
        toast(S.added(meta.name), { testid: 'document-added' })
        // A first document only helps when the search is on.
        if (!useRAGStore.getState().ragEnabled[chatId]) useRAGStore.getState().setRagEnabled(chatId, true)
      } else if (alive.current) {
        // No document model yet: the file waits and the card offers the install.
        setReady(false)
      }
    } catch (err) {
      if (isAbort(err) && cancelledByUser.current) {
        toast(S.cancelled, { testid: 'document-cancelled' })
      } else if (!alive.current && failedOnly(useRAGStore.getState().pausedIndex[chatId]).some((entry) => entry.name === file.name && entry.size === file.size)) {
        // Failed while the user was somewhere else. The row with "Try again" waits here (store, state "failed").
        toast(S.failedToast(file.name), { tone: 'error', testid: 'document-failed' })
      }
      // Failed or interrupted by the background: the store keeps it, and its row below shows it.
    } finally {
      if (alive.current) setWorking(null)
    }
  }

  const add = async () => {
    const picked = await pickFiles({ accept: ACCEPT, multiple: true })
    // Read right away, before the system removes its copy (D1). The rest waits for its turn.
    const now = holdAtPick(picked.map((item) => (documentKind(item.name) ? item.size : Infinity)), getMobileRagLimits().maxFileBytes)
    const files: (File | null)[] = []
    for (const [i, item] of picked.entries()) files.push(now[i] ? await hold(item.file) : item.file)
    for (const [i, item] of picked.entries()) {
      if (!documentKind(item.name)) {
        setFailed((list) => [...list, { file: item.file, wrongType: true }])
        continue
      }
      const file = files[i]
      if (file) await read(file)
    }
  }

  /** Take up a paused reading: with the file this session still holds, else with the file picked again. */
  const resume = async (entry: PausedIndex) => {
    const held = heldIndexFile(entry.id)
    if (held) {
      await read(held)
      return
    }
    const [picked] = await pickFiles({ accept: ACCEPT, multiple: false })
    if (!picked) return
    if (!documentKind(picked.name)) {
      setFailed((list) => [...list, { file: picked.file, wrongType: true }])
      return
    }
    rag.dropPausedDocument(entry.id)
    await read(picked.file)
  }

  const install = async () => {
    setInstallError(false)
    // Through the door every download of the phone takes (models/parts/start-download.ts): is there a
    // network, is this mobile data under "Download on Wi-Fi only", is there room. Without these the
    // card started a transfer that native code then held back, and showed an empty bar without a word (G7).
    const outcome = await startDownload({
      name: MODELS_STRINGS.models.documentModel,
      files: [{ url: MOBILE_EMBED_MODEL.downloadUrl, filename: MOBILE_EMBED_MODEL.filename, expectedBytes: MOBILE_EMBED_MODEL.expectedBytes, sha256: MOBILE_EMBED_MODEL.sha256 }],
      fit: DOCUMENT_MODEL_FITS,
    })
    if (!alive.current) return
    // Said by the door itself: no network, declined, no room, could not start.
    if (outcome !== 'started' && outcome !== 'installed') return
    // The logic layer waits for the file, then reads the documents that were added meanwhile.
    await rag.installEmbeddingAndDrainQueue()
    if (!alive.current) return
    const ok = await rag.ensureEmbeddingModel().catch(() => false)
    if (!alive.current) return
    setReady(ok)
    if (ok) toast(S.install.done, { testid: 'document-model-installed' })
    else setInstallError(true)
  }

  const remove = async (doc: DocumentMeta) => {
    const yes = await nav.confirm({ title: S.removeTitle(doc.name), text: S.removeText, confirmLabel: S.remove, tone: 'danger', testid: 'document-remove' })
    if (!yes) return
    rag.removeDocument(doc.id)
    toast(S.removed, { testid: 'document-removed' })
  }

  const removeAll = async () => {
    const yes = await nav.confirm({ title: S.removeAllTitle, text: S.removeAllText(rag.documents.length), confirmLabel: S.removeAll, tone: 'danger', testid: 'document-remove-all' })
    if (!yes) return
    rag.clearAll()
    toast(S.removedAll, { testid: 'document-removed-all' })
  }

  const missing = ready === false || installPrompt
  const installing = rag.pullingEmbeddingModel
  const progress = rag.indexingProgress
  const share = progress && progress.total > 0 ? progress.current / progress.total : undefined
  // How long the reading still takes, from the pace of this reading. Nothing until there is enough to go by.
  const paceStart = useRef<PaceSample | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  const readSoFar = progress?.current ?? 0
  const readTotal = progress?.total ?? 0
  useEffect(() => {
    if (readSoFar <= 0) {
      paceStart.current = null
      setLeft(null)
      return
    }
    const now = { done: readSoFar, at: performance.now() }
    if (!paceStart.current || readSoFar < paceStart.current.done) paceStart.current = now
    setLeft(secondsLeft(paceStart.current, now, readTotal))
  }, [readSoFar, readTotal])
  const busy = rag.isIndexing || working !== null
  const paused = pausedOnly(rag.pausedDocuments)
  const failedReadings = failedOnly(rag.pausedDocuments)
  // The page may have been left and opened again while a file is read: the store still knows its name (N5).
  const workingName = working ?? (rag.isIndexing ? runningName(rag.pausedDocuments) : null)
  const nothing = rag.documents.length === 0 && failed.length === 0 && paused.length === 0 && failedReadings.length === 0 && !busy

  return (
    <Page
      title={S.title}
      screen="chat-documents"
      footer={
        <div className="m-ag-foot">
          <Button variant="primary" block icon={Plus} disabled={busy || installing} disabledReason={busy ? S.addBusy : undefined} onPress={() => void add()} testid="m-documents-add" el="C8.2">
            {S.add}
          </Button>
        </div>
      }
    >
      <ListGroup>
        <Row
          title={S.search}
          subtitle={S.searchSub}
          switch={{ checked: rag.isEnabled, onChange: () => rag.toggleRAG() }}
          testid="m-documents-search"
          el="C8.1"
        />
      </ListGroup>
      <p className="m-ag-text" data-testid="m-documents-where">
        {local ? S.whereLocal : S.whereCloud}
      </p>

      {ready === null && !installPrompt ? (
        <div className="m-ag-block" data-testid="m-documents-checking">
          <Progress label={S.checking} detail={S.checking} />
        </div>
      ) : null}

      {missing ? (
        <Card title={S.install.title(formatBytes(MOBILE_EMBED_MODEL.sizeBytes))} testid="m-documents-install">
          <p className="m-cap">{S.install.text}</p>
          {queued > 0 ? <p className="m-cap">{S.waiting(queued)}</p> : null}
          {installing ? (
            <Progress
              label={S.install.progress}
              value={pull && pull.total > 0 ? pull.completed / pull.total : undefined}
              detail={S.install.progress}
              meta={pull && pull.total > 1 ? `${formatBytes(pull.completed)} / ${formatBytes(pull.total)}` : undefined}
              testid="m-documents-install-progress"
            />
          ) : (
            <Button variant="primary" block icon={Download} onPress={() => void install()} testid="m-documents-install-start" el="C8.6">
              {S.install.button}
            </Button>
          )}
          {installError && !installing ? (
            <p className="m-ag-error" role="alert" data-testid="m-documents-install-error">
              {S.install.failed}
            </p>
          ) : null}
        </Card>
      ) : null}

      {rag.contextWarning ? (
        <Notice variant="warn" testid="m-documents-context">
          {rag.contextWarning}
        </Notice>
      ) : null}

      {nothing ? (
        <EmptyState title={S.empty} icon={FileText} testid="m-documents-empty">
          {S.emptyText}
        </EmptyState>
      ) : (
        <section data-testid="m-documents-list">
          <h2 className="m-label m-group-label">{S.listTitle}</h2>
          <div className="m-group">
            {rag.documents.map((doc) => {
              const passages = passagesOf(found, doc.id)
              return (
                <div className="m-ag-item" key={doc.id} data-testid={`m-documents-doc-${doc.id}`}>
                  <Fold
                    title={doc.name}
                    sub={S.docSub(S.kinds[doc.type] ?? doc.type, formatBytes(doc.size), doc.chunkCount)}
                    icon={FileText}
                    label={S.docName(doc.name)}
                    testid="m-documents-row"
                    el="C8.3"
                    trailing={<IconButton risk="destructive" icon={Trash2} label={S.removeName(doc.name)} onPress={() => void remove(doc)} testid="m-documents-remove" el="C8.4" />}
                  >
                    {() => (
                      <>
                        <span className="m-cap">{S.passagesTitle}</span>
                        {passages.length === 0 ? (
                          <span className="m-cap" data-testid="m-documents-passages-none">
                            {S.passagesNone}
                          </span>
                        ) : (
                          passages.map((p) => (
                            <div className="m-ag-passage" key={p.id} data-testid="m-documents-passage">
                              <span>{S.score(p.percent)}</span>
                              <div className="m-ag-pre m-ag-pre--plain">{p.text}</div>
                            </div>
                          ))
                        )}
                      </>
                    )}
                  </Fold>
                </div>
              )
            })}
            {busy ? (
              <div className="m-ag-item m-ag-item--pad" data-testid="m-documents-working">
                {workingName ? (
                  <span className="m-ag-item-title" data-testid="m-documents-working-name">
                    {workingName}
                  </span>
                ) : null}
                <Progress
                  label={workingName ? S.workName(workingName) : S.indexing}
                  value={share}
                  detail={share === undefined || share === 0 ? S.reading : S.indexing}
                  meta={left === null ? undefined : S.timeLeft(left)}
                  hidePercent={share === undefined || share === 0}
                  testid="m-documents-progress"
                  el="C8.2"
                />
                {turn || job === 'waiting-for-answer' || job === 'waiting-for-model' ? (
                  <span className="m-cap" role="status" data-testid="m-documents-slot-turn">
                    {turn ?? (job === 'waiting-for-model' ? S.waitsForModel : S.waitsForAnswer)}
                  </span>
                ) : null}
                <Button
                  compact
                  onPress={() => {
                    cancelledByUser.current = true
                    rag.cancelIndexing()
                  }}
                  testid="m-documents-cancel"
                  el="C8.2"
                >
                  {S.cancel}
                </Button>
              </div>
            ) : null}
            {paused.map((entry) => {
              const held = !!heldIndexFile(entry.id)
              return (
                <div className="m-ag-item m-ag-item--pad" key={entry.id} data-testid="m-documents-paused" data-state={held ? 'held' : 'needs-file'}>
                  <span className="m-ag-item-title">{entry.name}</span>
                  <span className="m-cap" role="status">
                    {held ? S.paused : S.pausedRestart}
                  </span>
                  <div className="m-rowh">
                    <Button compact icon={Play} disabled={busy || installing} onPress={() => void resume(entry)} label={held ? S.continueName(entry.name) : S.pickAgainName(entry.name)} testid="m-documents-continue" el="C8.2">
                      {held ? S.continue : S.pickAgain}
                    </Button>
                    <Button compact onPress={() => rag.dropPausedDocument(entry.id)} label={S.removeName(entry.name)} testid="m-documents-paused-remove" el="C8.4">
                      {S.remove}
                    </Button>
                  </div>
                </div>
              )
            })}
            {failedReadings.map((entry) => {
              const held = !!heldIndexFile(entry.id)
              return (
                <div className="m-ag-item m-ag-item--pad" key={entry.id} data-testid="m-documents-failed" data-state="failed" data-held={held ? '' : undefined}>
                  <span className="m-ag-item-title">{entry.name}</span>
                  <span className="m-ag-error" role="alert">
                    {failedRowText(entry.reason, entry.code, held)}
                  </span>
                  <div className="m-rowh">
                    <Button compact icon={Play} disabled={busy || installing} disabledReason={busy ? S.addBusy : undefined} onPress={() => void resume(entry)} label={held ? S.tryAgainName(entry.name) : S.pickAgainName(entry.name)} testid="m-documents-retry" el="C8.2">
                      {held ? S.tryAgain : S.pickAgain}
                    </Button>
                    <Button compact onPress={() => rag.dropPausedDocument(entry.id)} label={S.removeName(entry.name)} testid="m-documents-failed-remove" el="C8.4">
                      {S.remove}
                    </Button>
                  </div>
                </div>
              )
            })}
            {failed.map((item, index) => (
              <div className="m-ag-item m-ag-item--pad" key={`${item.file.name}-${index}`} data-testid="m-documents-failed" data-state="wrong-type">
                <span className="m-ag-item-title">{item.file.name}</span>
                <span className="m-ag-error" role="alert">
                  {item.wrongType ? S.wrongType : (item.reason ?? S.failed)}
                </span>
                <div className="m-rowh">
                  <Button compact onPress={() => setFailed((list) => list.filter((f) => f !== item))} testid="m-documents-failed-remove" el="C8.4">
                    {S.remove}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {rag.documents.length > 1 ? (
        <div className="m-ag-actions">
          <Button risk="destructive" variant="danger" block onPress={() => void removeAll()} testid="m-documents-remove-all" el="C8.5">
            {S.removeAll}
          </Button>
        </div>
      ) : null}

      <ListGroup title={S.importChatsGroup}>
        <Row title={S.importChats} subtitle={S.importChatsSub} icon={Import} onPress={() => nav.push('/settings/data/import')} testid="m-documents-import" el="C8.7" />
      </ListGroup>
    </Page>
  )
}
