/**
 * M3 Downloads. Route /models/downloads, strand 4 (Models and onboarding).
 *
 * Every transfer with its state: waiting, running (percent, sizes, pace, time
 * left), paused, waiting for network, verifying, installed, interrupted.
 * M3.1 pause and resume, M3.2 cancel, M3.3 remove, M3.4 retry, M3.5 the row
 * opens the model (M2).
 */
import { useEffect } from 'react'
import { ArrowDownToLine, Check } from 'lucide-react'
import type { DownloadProgress } from '../../../types/downloads'
import { useDownloadStore } from '../../../stores/downloadStore'
import { deviceFileLabel } from '../../lib/model-facts'
import { nav } from '../../nav'
import { useOnline } from '../../resilience/useOnline'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, EmptyState, Page } from '../../ui'
import { CardHead, CardName, ItemCard, MonoLine, Para } from './parts/bits'
import { routeIdOfDownload } from './parts/catalog'
import { downloadKind, sizesText, stateWord } from './parts/download-state'
import { bareName, isDocumentModel, useInstalled } from './parts/installed'
import { Transfer } from './parts/Transfer'
import { showFittingModels } from './parts/view'
import { installModelsWatch, wasFoundAfterRestart } from './parts/watch'

function nameOfDownload(filename: string): string {
  const bare = bareName(filename)
  if (isDocumentModel({ name: bare })) return S.models.documentModel
  // Another packing of a catalogue model is named as everywhere else, not by its file (acceptance Android 8 GB, N1).
  return deviceFileLabel(filename) ?? bare
}

function DownloadRow({ id, row }: { id: string; row: DownloadProgress }) {
  const online = useOnline()
  const meta = useDownloadStore((s) => s.downloadMeta[id])
  const kind = downloadKind(row, online)
  const name = nameOfDownload(id)
  const document = isDocumentModel({ name: bareName(id) })
  const resumed = wasFoundAfterRestart(id) && (kind === 'running' || kind === 'waiting')
  return (
    <ItemCard testid="m-models-downloads-item" id={id} state={kind}>
      <CardHead
        label={S.downloads.open(name)}
        testid="m-models-downloads-open"
        el="M3.5"
        onPress={() => {
          if (document) nav.push('/settings/storage')
          else nav.push('/models/:id', { id: routeIdOfDownload(id, meta?.url) })
        }}
      >
        <CardName>{name}</CardName>
        <MonoLine parts={[stateWord(kind), kind === 'done' ? sizesText(row, meta?.expectedBytes) : null]} />
        {resumed ? <span className="m-cap" data-testid="m-models-downloads-resumed">{S.download.resumedAfterRestart}</span> : null}
      </CardHead>
      <Transfer
        id={id}
        name={name}
        screen="models-downloads"
        els={{ pause: 'M3.1', cancel: 'M3.2', remove: 'M3.3', retry: 'M3.4' }}
        inset
        done={
          <span className="m-rowh m-cap" style={{ color: 'var(--m-ok)' }} data-testid="m-models-downloads-done">
            <Check className="m-icon m-icon--sm" aria-hidden="true" />
            {S.download.done}
          </span>
        }
      />
    </ItemCard>
  )
}

export default function DownloadsPage() {
  const rows = useDownloadStore((s) => s.downloads)
  useInstalled()
  useEffect(() => {
    installModelsWatch()
    // Rows the native side still holds from before the page was opened.
    useDownloadStore.getState().startPolling()
  }, [])
  const ids = Object.keys(rows)

  return (
    <Page title={S.downloads.title} screen="models-downloads">
      {ids.length === 0 ? (
        <EmptyState
          icon={ArrowDownToLine}
          title={S.downloads.emptyTitle}
          testid="m-models-downloads-empty"
          actions={
            <Button variant="primary" testid="m-models-downloads-getnew" onPress={() => { showFittingModels(); nav.resetTo('models') }}>
              {S.downloads.getNew}
            </Button>
          }
        >
          {S.downloads.empty}
        </EmptyState>
      ) : (
        <div data-testid="m-models-downloads-list" aria-label={S.downloads.list}>
          {ids.map((id) => (
            <DownloadRow key={id} id={id} row={rows[id]} />
          ))}
        </div>
      )}
      <Para cap testid="m-models-downloads-footer">
        {S.downloads.footer}
      </Para>
    </Page>
  )
}
