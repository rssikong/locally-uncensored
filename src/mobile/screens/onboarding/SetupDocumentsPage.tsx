/**
 * A3 Document Chat. Route /setup/documents, onboarding step, strand 4.
 *
 * Offers the one small extra model that Document Chat needs. Optional.
 * A3.1 back, A3.2 "Install 84 MB" with progress, A3.3 "Skip for now".
 * States: already installed, download running, failure (same box as A2).
 */
import { useEffect, useState } from 'react'
import { Check, Download, FileText } from 'lucide-react'
import { formatBytes } from '../../../lib/formatters'
import { MOBILE_EMBED_MODEL } from '../../data/mobile-models'
import { nav } from '../../nav'
import { useOnline } from '../../resilience/useOnline'
import { MODELS_STRINGS as S } from '../../strings/models'
import { Button, Icon, Page, Sparse } from '../../ui'
import { FootStack } from '../models/parts/bits'
import { isFailure } from '../models/parts/download-state'
import type { FitView } from '../models/parts/fit'
import { documentModelInstalled, useInstalled } from '../models/parts/installed'
import { startDownload } from '../models/parts/start-download'
import { Transfer, useTransferKind } from '../models/parts/Transfer'
import { installModelsWatch } from '../models/parts/watch'
import { Steps } from './parts/Steps'

/** The document model is 84 MB: every phone that runs LU carries it. */
const SMALL: FitView = { level: 'fits', needBytes: 0, usableBytes: 0, contextLength: 0, maxContext: 0, short: '', long: '' }

export default function SetupDocumentsPage() {
  const [starting, setStarting] = useState(false)
  const [startedHere, setStartedHere] = useState(false)
  const installed = useInstalled()
  const online = useOnline()
  const kind = useTransferKind(MOBILE_EMBED_MODEL.filename)
  const size = formatBytes(MOBILE_EMBED_MODEL.sizeBytes)
  const there = documentModelInstalled(installed.files)
  const moving = !there && kind !== null && kind !== 'done'
  const failed = moving && kind !== null && isFailure(kind)

  useEffect(() => {
    installModelsWatch()
  }, [])

  const next = () => nav.push('/setup/done')

  const install = async () => {
    if (starting) return
    setStarting(true)
    try {
      const outcome = await startDownload({
        name: MOBILE_EMBED_MODEL.name,
        files: [{ url: MOBILE_EMBED_MODEL.downloadUrl, filename: MOBILE_EMBED_MODEL.filename, expectedBytes: MOBILE_EMBED_MODEL.expectedBytes, sha256: MOBILE_EMBED_MODEL.sha256 }],
        fit: SMALL,
      })
      if (outcome === 'started') setStartedHere(true)
    } finally {
      setStarting(false)
    }
  }

  const footer = there ? (
    <Button variant="primary" block testid="m-onboarding-next" onPress={next}>
      {S.common.continue}
    </Button>
  ) : moving ? (
    <>
      {failed ? null : <Transfer id={MOBILE_EMBED_MODEL.filename} name={S.models.documentModel} screen="onboarding-documents" />}
      <Button variant={failed ? 'default' : 'primary'} block testid="m-onboarding-next" onPress={next}>
        {S.common.continue}
      </Button>
    </>
  ) : (
    <>
      <Button
        variant="primary"
        block
        icon={Download}
        testid="m-onboarding-documents-install"
        el="A3.2"
        busy={starting}
        disabled={!installed.ready || !online}
        disabledReason={!online ? S.common.noInternet : undefined}
        onPress={() => void install()}
      >
        {S.setupDocs.install(size)}
      </Button>
      <Button variant="quiet" block testid="m-onboarding-skip" el="A3.3" onPress={next}>
        {S.common.skip}
      </Button>
    </>
  )

  return (
    <Page title={S.setupDocs.title} screen="onboarding-documents" footer={<FootStack>{footer}</FootStack>}>
      <Steps step={2} />
      {/* The sentence, and the download when it failed, in the middle of the room under the steps (ui/Layout.tsx, Sparse). */}
      <Sparse>
        <div className="m-empty" data-testid="m-onboarding-documents-intro" data-state={there ? 'installed' : moving ? 'moving' : 'idle'}>
          <Icon icon={there ? Check : FileText} />
          <p className="m-t2" style={{ maxWidth: '22rem', color: 'var(--m-t1)' }}>{S.setupDocs.text(size)}</p>
          {there ? (
            <p style={{ color: 'var(--m-ok)' }} role="status" data-testid="m-onboarding-documents-ready">
              {startedHere ? S.setupDocs.ready : S.setupDocs.already}
            </p>
          ) : !online && !moving ? (
            <p data-testid="m-onboarding-documents-offline">{S.setupDocs.offline}</p>
          ) : null}
        </div>
        {failed ? <Transfer id={MOBILE_EMBED_MODEL.filename} name={S.models.documentModel} screen="onboarding-documents" /> : null}
      </Sparse>
    </Page>
  )
}
