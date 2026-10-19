/**
 * Check files and Repair, the dialog (GH #113, wish G16).
 *
 * Opens on a bundle or a chat model, starts the check at once, shows the
 * digest's progress with a way out, then one row per file. Repair moves the
 * broken files to the Trash and fetches what is missing or broken through the
 * normal download path; the download list shows the rest. Closing the dialog
 * stops a check that is still reading, so a 20 GB digest never runs on for
 * nobody.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, Info, Loader2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { ModalActions, ModalButton } from '../ui/ModalActions'
import { ICON_SM } from '../ui/icon-size'
import { isWindows } from '../../api/backend'
import { cancelFileCheck, fileCheckStatus, startFileCheck, type FileCheckJob, type FileVerdict } from '../../api/model-verify'
import { repairDepsFor } from '../../api/model-repair'
import {
  checkPercent, checkSummary, filesToRepair, repairFiles, repairSummary,
  stateDetail, stateLabel, stateTone, type CheckTarget, type RepairReport,
} from '../../lib/model-file-check'
import { HINWEIS_TEXT } from '../../lib/hinweis'
import { formatBytes } from '../../lib/formatters'
import { log } from '../../lib/logger'

/** What the dialog checks: a name, the name its downloads are filed under,
 *  and how to find its files (a chat model's folder is asked for first). */
export interface FileCheckSubject {
  name: string
  groupName: string
  load: () => Promise<CheckTarget[]>
}

const POLL_MS = 500

type Phase =
  | { kind: 'starting' }
  | { kind: 'running'; job: FileCheckJob | null }
  | { kind: 'done'; files: FileVerdict[] }
  | { kind: 'cancelled' }
  | { kind: 'error'; message: string }
  | { kind: 'repairing' }
  | { kind: 'repaired'; report: RepairReport }

const TONE_TEXT = {
  good: 'text-gray-700 dark:text-gray-200',
  bad: HINWEIS_TEXT.fehler,
  calm: HINWEIS_TEXT.ruhig,
} as const

export function ModelFileCheck({ subject, onClose }: { subject: FileCheckSubject | null; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [targets, setTargets] = useState<CheckTarget[]>([])
  const jobRef = useRef<string | null>(null)
  const runRef = useRef(0)
  const bin = isWindows() ? 'Recycle Bin' : 'Trash'

  const stopRunning = useCallback(() => {
    const id = jobRef.current
    jobRef.current = null
    if (id) void cancelFileCheck(id).catch(() => {})
  }, [])

  const run = useCallback(async (s: FileCheckSubject) => {
    const run = ++runRef.current
    setPhase({ kind: 'starting' })
    try {
      const t = await s.load()
      if (run !== runRef.current) return
      setTargets(t)
      if (t.length === 0) {
        setPhase({ kind: 'error', message: 'The catalog names no files for this model, so there is nothing to check.' })
        return
      }
      const id = await startFileCheck(t)
      if (run !== runRef.current) {
        void cancelFileCheck(id).catch(() => {})
        return
      }
      jobRef.current = id
      setPhase({ kind: 'running', job: null })
      for (;;) {
        await new Promise((r) => setTimeout(r, POLL_MS))
        if (run !== runRef.current) return
        const job = await fileCheckStatus(id)
        if (run !== runRef.current) return
        if (job.status === 'running') {
          setPhase({ kind: 'running', job })
          continue
        }
        jobRef.current = null
        if (job.status === 'done') setPhase({ kind: 'done', files: job.files })
        else if (job.status === 'cancelled') setPhase({ kind: 'cancelled' })
        else setPhase({ kind: 'error', message: job.error || 'The check stopped with an error.' })
        return
      }
    } catch (err) {
      if (run !== runRef.current) return
      // The poll failed, the job may still be reading: stop it.
      stopRunning()
      log.warn('[ModelFileCheck] check failed', { err })
      setPhase({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }, [stopRunning])

  useEffect(() => {
    if (!subject) return
    void run(subject)
    // A counter and an id, not DOM nodes: read through the objects so the
    // cleanup sees what is current when it runs.
    const runs = runRef
    const job = jobRef
    return () => {
      runs.current++
      const id = job.current
      job.current = null
      if (id) void cancelFileCheck(id).catch(() => {})
    }
  }, [subject, run])

  const close = () => {
    runRef.current++
    stopRunning()
    onClose()
  }

  const cancel = () => {
    const id = jobRef.current
    if (id) void cancelFileCheck(id).catch(() => {})
  }

  const repair = async (files: FileVerdict[]) => {
    if (!subject) return
    setPhase({ kind: 'repairing' })
    const deps = repairDepsFor(subject.groupName, targets.map((t) => t.filename))
    try {
      const report = await repairFiles(targets, files, deps)
      setPhase({ kind: 'repaired', report })
    } finally {
      deps.finish()
    }
  }

  const optionalOf = (name: string) => !!targets.find((t) => t.filename === name)?.optional

  return (
    <Modal open={!!subject} onClose={close} title="Check files">
      {subject && (
        <div className="space-y-3" data-testid="model-file-check">
          <p className="t-title text-gray-900 dark:text-white">{subject.name}</p>

          {(phase.kind === 'starting' || phase.kind === 'running') && (
            <div className="space-y-2">
              <p className="flex items-center gap-1.5 t-body text-gray-700 dark:text-gray-200">
                <Loader2 size={ICON_SM} className="animate-spin" /> Checking files…
              </p>
              {phase.kind === 'running' && phase.job && phase.job.hashTotalBytes > 0 && (
                <div>
                  <div className="h-1 rounded-full bg-gray-200 dark:bg-white/[0.08] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-lu-accent transition-[width]"
                      style={{ width: `${checkPercent(phase.job.hashedBytes, phase.job.hashTotalBytes)}%` }}
                    />
                  </div>
                  <p className={`mt-1 t-micro tabular-nums ${HINWEIS_TEXT.ruhig}`} data-testid="check-progress">
                    {phase.job.current ? `Reading ${phase.job.current}, ` : ''}
                    {formatBytes(phase.job.hashedBytes)} of {formatBytes(phase.job.hashTotalBytes)} ({checkPercent(phase.job.hashedBytes, phase.job.hashTotalBytes)}%)
                  </p>
                </div>
              )}
              <p className={`t-micro ${HINWEIS_TEXT.ruhig}`}>
                Sizes are compared with the catalog, and checksums are read where the catalog lists one. Large files take a few minutes; you can keep using the app.
              </p>
              <ModalActions>
                <ModalButton variant="quiet" onClick={cancel} disabled={phase.kind === 'starting'}>Cancel check</ModalButton>
              </ModalActions>
            </div>
          )}

          {phase.kind === 'cancelled' && (
            <div className="space-y-2">
              <p className={`t-body ${HINWEIS_TEXT.ruhig}`}>Check cancelled. Nothing was changed.</p>
              <ModalActions>
                <ModalButton variant="quiet" onClick={close}>Close</ModalButton>
                <ModalButton variant="primary" onClick={() => void run(subject)}>Check again</ModalButton>
              </ModalActions>
            </div>
          )}

          {phase.kind === 'error' && (
            <div className="space-y-2">
              <p className={`t-body ${HINWEIS_TEXT.fehler}`}>{phase.message}</p>
              <ModalActions>
                <ModalButton variant="quiet" onClick={close}>Close</ModalButton>
              </ModalActions>
            </div>
          )}

          {phase.kind === 'done' && (() => {
            const broken = filesToRepair(targets, phase.files)
            return (
              <div className="space-y-3">
                <ul className="space-y-1.5" data-testid="check-rows">
                  {phase.files.map((f) => {
                    const optional = optionalOf(f.filename)
                    const tone = stateTone(f.state, optional)
                    return (
                      <li key={f.filename} className="flex items-start gap-2" data-file-state={f.state}>
                        {tone === 'good'
                          ? <CheckCircle2 size={ICON_SM} className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
                          : tone === 'bad'
                            ? <CircleAlert size={ICON_SM} className={`mt-0.5 shrink-0 ${HINWEIS_TEXT.fehler}`} />
                            : <Info size={ICON_SM} className={`mt-0.5 shrink-0 ${HINWEIS_TEXT.ruhig}`} />}
                        <div className="min-w-0 flex-1">
                          <p className="t-body text-gray-900 dark:text-white break-all">{f.filename}</p>
                          <p className={`t-micro ${TONE_TEXT[tone]}`}>
                            <span className="font-semibold">{stateLabel(f.state, optional)}</span>. {stateDetail(f, optional)}
                          </p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
                <p className="t-body text-gray-700 dark:text-gray-200" data-testid="check-summary">{checkSummary(targets, phase.files)}</p>
                {broken.length > 0 && (
                  <p className={`t-micro ${HINWEIS_TEXT.ruhig}`}>
                    Repair downloads only these files again. A file that is there but wrong goes to the {bin} first, nothing is deleted for good.
                  </p>
                )}
                <ModalActions>
                  <ModalButton variant="quiet" onClick={close}>Close</ModalButton>
                  {broken.length > 0 && (
                    <ModalButton variant="primary" onClick={() => void repair(phase.files)}>
                      Repair {broken.length} {broken.length === 1 ? 'file' : 'files'}
                    </ModalButton>
                  )}
                </ModalActions>
              </div>
            )
          })()}

          {phase.kind === 'repairing' && (
            <p className="flex items-center gap-1.5 t-body text-gray-700 dark:text-gray-200">
              <Loader2 size={ICON_SM} className="animate-spin" /> Starting the repair…
            </p>
          )}

          {phase.kind === 'repaired' && (
            <div className="space-y-2">
              <p className="t-body text-gray-700 dark:text-gray-200" data-testid="repair-summary">{repairSummary(phase.report, bin)}</p>
              {phase.report.failed.map((f) => (
                <p key={f.filename} className={`t-micro ${HINWEIS_TEXT.fehler}`}>{f.filename}: {f.error}</p>
              ))}
              <ModalActions>
                <ModalButton variant="primary" onClick={close}>Close</ModalButton>
              </ModalActions>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
