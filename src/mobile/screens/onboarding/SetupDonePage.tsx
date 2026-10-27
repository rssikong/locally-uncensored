/**
 * A4 You're all set. Route /setup/done, last onboarding step, strand 4.
 *
 * One sentence that names where things stand (model ready, still
 * downloading, paused, Cloud only, no model yet), then A4.1 "Start chatting"
 * marks the onboarding as done and opens a new chat. A4.2 "Open Models" is
 * there while no model is ready.
 *
 * While the starter model is still on its way the page does not claim "all
 * set": the title is "Almost ready", the check mark gives way to the
 * download itself with its bar, Pause or Resume and Cancel (A4.3, the same
 * Transfer as on A2), and the sentence says that chatting on this phone
 * starts when it is done. The same state is readable for every other screen
 * through models/parts/arriving.ts (useArrivingModel).
 */
import { useEffect, useMemo } from 'react'
import { Check, Download } from 'lucide-react'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'
import { useDownloadStore } from '../../../stores/downloadStore'
import { useOnline } from '../../resilience/useOnline'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, Icon, Page, Sparse } from '../../ui'
import { useArrivingModel } from '../models/parts/arriving'
import { downloadKind, isOpen } from '../models/parts/download-state'
import { bareName, chatFiles, displayName, isDocumentModel, useInstalled } from '../models/parts/installed'
import { Transfer } from '../models/parts/Transfer'
import { installModelsWatch } from '../models/parts/watch'
import { doneStatus, type DoneStatus } from './parts/done-status'
import { finishOnboarding, useFlow } from './parts/flow'

function sentence(status: DoneStatus): string {
  const name = status.model ? displayName({ name: status.model }) : ''
  switch (status.kind) {
    case 'ready':
      return S.setupDone.ready(name)
    case 'downloading':
      return S.setupDone.downloading(name)
    case 'paused':
      return S.setupDone.paused(name)
    case 'cloud':
      return S.setupDone.cloud
    default:
      return S.setupDone.none
  }
}

export default function SetupDonePage() {
  const installed = useInstalled()
  const rows = useDownloadStore((s) => s.downloads)
  const online = useOnline()
  const signedIn = useCloudAuthStore((s) => s.status === 'signed-in')
  const picked = useFlow((s) => s.picked)

  useEffect(() => {
    installModelsWatch()
  }, [])

  const status = useMemo(
    () =>
      doneStatus({
        installed: chatFiles(installed.files).map((f) => f.name),
        picked: picked ? bareName(picked) : null,
        open: Object.entries(rows)
          .filter(([id, row]) => isOpen(row) && !isDocumentModel({ name: bareName(id) }))
          .map(([id, row]) => ({ name: bareName(id), moving: ['waiting', 'running', 'verifying'].includes(downloadKind(row, online)) })),
        signedIn,
      }),
    [installed.files, picked, rows, online, signedIn],
  )
  const ready = status.kind === 'ready' ? status.model : null
  const arriving = useArrivingModel(picked ? bareName(picked) : null)
  // The download the sentence talks about, shown with its bar. A failed one shows its own box with the next step.
  const loading = installed.ready && (status.kind === 'downloading' || status.kind === 'paused') && arriving ? arriving : null

  return (
    <Page
      title={loading ? S.setupDone.titleLoading : S.setupDone.title}
      screen="onboarding-done"
      footer={
        <>
          <Button variant="primary" block testid="m-onboarding-done" el="A4.1" onPress={() => finishOnboarding('chat', ready)}>
            {S.setupDone.start}
          </Button>
          {ready ? null : (
            <Button variant="quiet" block testid="m-onboarding-done-models" el="A4.2" onPress={() => finishOnboarding('models', null)}>
              {S.setupDone.openModels}
            </Button>
          )}
        </>
      }
    >
      {/* The sentence, and the download while it runs, in the middle of the room (ui/Layout.tsx, Sparse). */}
      <Sparse>
        <div className="m-empty" data-testid="m-onboarding-done-status" data-state={status.kind} data-m-percent={loading ? loading.percent : undefined}>
          <span style={{ color: loading ? 'var(--m-t3)' : 'var(--m-ok)' }}>
            <Icon icon={loading ? Download : Check} />
          </span>
          <p className="m-t2" style={{ maxWidth: '22rem', color: 'var(--m-t1)' }} role="status">
            {installed.ready ? (loading?.state === 'failed' ? S.setupDone.failed(loading.name) : sentence(status)) : S.common.loadingCatalog}
          </p>
        </div>
        {loading ? (
          <div style={{ padding: '0 var(--m-s1) var(--m-s4)' }} data-testid="m-onboarding-done-download">
            <Transfer id={loading.id} name={loading.name} screen="onboarding-done" els={{ pause: 'A4.3', cancel: 'A4.3', remove: 'A4.3', retry: 'A4.3' }} />
          </div>
        ) : null}
      </Sparse>
    </Page>
  )
}
