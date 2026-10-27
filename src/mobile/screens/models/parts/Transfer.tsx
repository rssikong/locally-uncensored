/**
 * One download, as every screen of the strand shows it: the bar with what
 * moves, Pause or Resume and Cancel, and for a failure the box that says
 * what happened, what is kept and what to do next (DESIGN.md M3, 5.2, 5.4).
 *
 * Used by the onboarding (A2, A3), the cards in M1, the detail page M2 and
 * the list M3. `screen` picks the test ids, `els` the element numbers.
 */
import type { ReactNode } from 'react'
import { Pause, Play, RotateCw, Signal, Trash2, X } from 'lucide-react'
import { checkDownloadSpace } from '../../../../api/discover'
import { useDownloadStore } from '../../../../stores/downloadStore'
import { nav } from '../../../nav'
import { showStorageDialog } from '../../../resilience/StorageDialog'
import { useOnline } from '../../../resilience/useOnline'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { Button, Notice, Progress, toast } from '../../../ui'
import { heldForWifi, useOnMobileData } from './adapters/connection'
import { cancelFile, resumeFile } from './adapters/downloads'
import { usePref } from './adapters/prefs'
import { measuredPace } from './pace'
import { downloadKind, errorKind, failureText, isFailure, paceText, remainingBytes, shareOf, sizesText, spaceShortfall, stateWord, totalBytesOf, type DownloadKind } from './download-state'
import { wasFoundAfterRestart } from './watch'
import { riskMark } from './risk'
import { mayResumeNow, allowMobileDataFor } from './start-download'
import { formatBytes } from '../../../../lib/formatters'

export interface TransferEls {
  /** Pause and Resume share a number in DESIGN.md. */
  pause?: string
  cancel?: string
  remove?: string
  retry?: string
}

export interface TransferProps {
  /** The download id: the file name. */
  id: string
  /** Name of the model on screen. */
  name: string
  /** Prefix of the test ids: m-<screen>-progress, m-<screen>-cancel and so on. */
  screen: string
  els?: TransferEls
  /** Shown instead of nothing when the download is done. */
  done?: ReactNode
  /** Leave the box of a failure without its side margins (inside a card). */
  inset?: boolean
}

export function useTransferKind(id: string): DownloadKind | null {
  const row = useDownloadStore((s) => s.downloads[id])
  const online = useOnline()
  return row ? downloadKind(row, online) : null
}

async function resume(id: string, name: string): Promise<void> {
  // A download that stopped for want of room is asked again before it goes on: is there room for the rest now.
  const { downloads, downloadMeta } = useDownloadStore.getState()
  const row = downloads[id]
  const meta = downloadMeta[id]
  if (row && meta?.destDir && errorKind(row.error) === 'storage') {
    const rest = remainingBytes(row, meta.expectedBytes)
    const shortfall = rest > 0 ? spaceShortfall(await checkDownloadSpace({ destDir: meta.destDir }, rest), rest) : null
    if (shortfall) {
      await showStorageDialog({ name, shortfall, resume: true })
      return
    }
  }
  // "Download on Wi-Fi only" and the phone on mobile data: the same question as at the start (M3).
  const rest = row ? remainingBytes(row, meta?.expectedBytes) : 0
  if (!(await mayResumeNow(id, rest > 0 ? formatBytes(rest) : ''))) return
  const ok = await resumeFile(id).catch(() => false)
  if (!ok) toast(S.download.startFailed, { tone: 'error', testid: 'download-failed' })
}

/**
 * Cancel removes what was downloaded, and its button stands right next to
 * Pause: it asks first (acceptance Android 08.10.2026, N4). "Remove" in the
 * box of a failure is `quiet`: there the transfer is over and the user reads
 * a sentence about it before tapping.
 */
async function cancel(id: string, name: string, quiet = false): Promise<void> {
  if (!quiet) {
    const row = useDownloadStore.getState().downloads[id]
    const got = row && row.progress > 1 ? formatBytes(row.progress) : ''
    const yes = await nav.confirm({
      title: S.download.cancelTitle(name),
      text: got ? S.download.cancelText(got) : S.download.cancelTextNothing,
      confirmLabel: S.download.cancelConfirm,
      cancelLabel: S.download.cancelKeep,
      tone: 'danger',
      testid: 'download-cancel',
    })
    if (!yes) return
  }
  await cancelFile(id).catch(() => {})
  if (!quiet) toast(S.download.cancelled, { testid: 'download-cancelled' })
}

/** A Notice brings the margins of a page. Inside a card they are taken back. */
const INSET = { margin: '0 calc(var(--m-gutter) * -1) calc(var(--m-s3) * -1)' } as const

export function Transfer(props: TransferProps) {
  const { id, name, screen, els = {}, done = null, inset } = props
  const row = useDownloadStore((s) => s.downloads[id])
  const expected = useDownloadStore((s) => s.downloadMeta[id]?.expectedBytes)
  const online = useOnline()
  const wifiOnly = usePref('wifiOnly')
  const mobileData = useOnMobileData()
  if (!row) return null
  const kind = downloadKind(row, online)
  const t = (part: string) => `m-${screen}-${part}`
  if (kind === 'done') return <>{done}</>

  if (isFailure(kind)) {
    const text = failureText(kind, row, expected)
    const again = kind === 'checksum' ? S.download.downloadAgain : kind === 'unreachable' ? S.common.retry : S.common.resume
    return (
      <div data-testid={t('transfer')} data-state={kind} data-m-id={id}>
        <div style={inset ? INSET : undefined}>
          <Notice
            variant="error"
            title={text.title}
            testid={t('error')}
            actions={
              <>
                {kind === 'storage' ? (
                  <Button compact testid={t('error-storage')} onPress={() => nav.push('/settings/storage')}>
                    {S.download.manageStorage}
                  </Button>
                ) : null}
                {kind === 'gated' ? (
                  <Button compact testid={t('error-token')} onPress={() => nav.push('/settings/storage')}>
                    {S.download.addToken}
                  </Button>
                ) : null}
                {kind !== 'gated' && kind !== 'gone' && kind !== 'blocked' ? (
                  <Button compact icon={RotateCw} testid={t(kind === 'interrupted' || kind === 'storage' ? 'resume' : 'retry')} el={els.retry ?? els.pause} label={kind === 'interrupted' || kind === 'storage' ? S.common.resumeName(name) : S.common.retryName(name)} onPress={() => void resume(id, name)}>
                    {again}
                  </Button>
                ) : null}
                <Button compact variant="quiet" icon={Trash2} {...riskMark('destructive')} testid={t('remove')} el={els.remove} label={S.common.removeName(name)} onPress={() => void cancel(id, name, true)}>
                  {S.common.remove}
                </Button>
              </>
            }
          >
            {text.text}
          </Notice>
        </div>
      </div>
    )
  }

  // "Download on Wi-Fi only" and the phone on mobile data: native code holds the transfer, and the row says why.
  const waitsForWifi = heldForWifi(row, wifiOnly, mobileData)
  const paused = kind === 'paused' || kind === 'waiting-network' || waitsForWifi
  const word = waitsForWifi ? S.download.waitingWifi : stateWord(kind)
  // The time that is left is measured here and said only once it is known (parts/pace.ts).
  const secondsLeft = measuredPace(row.filename, kind === 'running' && row.status === 'downloading', row.progress, totalBytesOf(row, expected))
  const pace = kind === 'running' ? paceText(row, expected, secondsLeft) : ''
  const note = kind === 'paused' && wasFoundAfterRestart(id) ? S.download.keptAfterRestart : ''
  return (
    <div className="m-stackv" data-testid={t('transfer')} data-state={kind} data-m-id={id} data-m-wifi-hold={waitsForWifi ? '' : undefined}>
      <Progress
        label={S.download.progressName(name)}
        value={shareOf(row, expected)}
        detail={[word, pace].filter(Boolean).join(', ')}
        meta={sizesText(row, expected)}
        state={paused ? 'paused' : 'running'}
        testid={t('progress')}
      />
      {note ? <span className="m-cap">{note}</span> : null}
      <div className="m-rowh">
        {kind === 'paused' ? (
          <Button compact icon={Play} testid={t('resume')} el={els.pause} label={S.common.resumeName(name)} onPress={() => void resume(id, name)}>
            {S.common.resume}
          </Button>
        ) : row.status === 'error' ? null : (
          <Button compact icon={Pause} testid={t('pause')} el={els.pause} label={S.common.pauseName(name)} disabled={kind === 'pausing'} onPress={() => void useDownloadStore.getState().pause(id).catch(() => {})}>
            {S.common.pause}
          </Button>
        )}
        {waitsForWifi ? (
          <Button compact icon={Signal} testid={t('mobile-data')} label={S.download.useMobileDataName(name)} onPress={() => void allowMobileDataFor(id, remainingBytes(row, expected) > 0 ? formatBytes(remainingBytes(row, expected)) : '')}>
            {S.download.useMobileData}
          </Button>
        ) : null}
        <Button compact variant="quiet" icon={X} {...riskMark('destructive')} testid={t('cancel')} el={els.cancel} label={S.common.cancelName(name)} onPress={() => void cancel(id, name)}>
          {S.common.cancel}
        </Button>
      </div>
    </div>
  )
}
