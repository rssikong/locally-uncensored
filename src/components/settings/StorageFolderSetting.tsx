// Discord "Storage Management" (12.–17.10.2026):
// choose where the models go, all of them in one folder, choose where the
// gallery lives, and stop filling drive C:. The rows below this one place each
// part on its own; this row places all of them in one folder and moves what is
// there already, after a plan and a confirmation (commands/storage.rs).
import { useEffect, useRef, useState } from 'react'
import { backendCall, isWindows } from '../../api/backend'
import {
  onStorageProgress,
  storageApply,
  storageCancel,
  storagePlan,
  storageStatus,
  type ItemGroup,
  type StorageApplied,
  type StoragePlan,
  type StorageProgress,
  type StorageStatus,
} from '../../api/storage'
import {
  GROUP_LABEL,
  PLACE_LABEL,
  driveLine,
  enoughSpace,
  groupLine,
  groupsOf,
  layoutLines,
  moveConfirmText,
  onSystemDrive,
  progressLine,
  reportHasProblems,
  reportLines,
  skippedIds,
  spaceLine,
  wantedCrossBytes,
} from '../../lib/storage-folder'
import { moveOutcomeLine } from '../../lib/runtime-folder'
import { syncCustomModelDir } from '../../lib/custom-model-dir'
import { useSettingsStore } from '../../stores/settingsStore'
import { HINWEIS_TEXT } from '../../lib/hinweis'

function errorText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return 'Something went wrong. Try again.'
}

const BUTTON =
  'px-2.5 py-1 rounded-md t-micro font-medium bg-white dark:bg-white/10 text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-white/15 border border-gray-200 dark:border-white/15 transition-colors disabled:opacity-50'

/** The other rows of the section read their state on mount; this tells them
 *  to read it again after the folder changed. */
export const STORAGE_CHANGED_EVENT = 'lu-storage-changed'

export function StorageFolderSetting() {
  const [status, setStatus] = useState<StorageStatus | null>(null)
  const [draft, setDraft] = useState('')
  const [plan, setPlan] = useState<StoragePlan | null>(null)
  const [off, setOff] = useState<Set<ItemGroup>>(new Set())
  const [busy, setBusy] = useState<'checking' | 'applying' | 'moving' | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [progress, setProgress] = useState<StorageProgress | null>(null)
  const [applied, setApplied] = useState<StorageApplied | null>(null)
  const [error, setError] = useState<string | null>(null)
  const typed = useRef(false)

  async function reload() {
    try {
      const s = await storageStatus()
      setStatus(s)
      if (!typed.current) setDraft(s.root ?? '')
    } catch (e) {
      setError(errorText(e))
    }
  }

  useEffect(() => { void reload() }, [])

  async function check(path: string) {
    const root = path.trim()
    setError(null)
    setApplied(null)
    setConfirming(false)
    setPlan(null)
    if (!root) return
    setBusy('checking')
    try {
      const p = await storagePlan(root)
      setPlan(p)
      setDraft(p.root)
      setOff(new Set())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  async function pickFolder() {
    setError(null)
    try {
      const picked = await backendCall<string | null>('pick_folder')
      if (picked) {
        typed.current = true
        setDraft(picked)
        await check(picked)
      }
    } catch (e) {
      setError(`The folder picker did not open. Type or paste the path into the field instead. ${errorText(e)}`)
    }
  }

  async function apply(moveFiles: boolean) {
    if (!plan) return
    setConfirming(false)
    setError(null)
    setApplied(null)
    setBusy(moveFiles ? 'moving' : 'applying')
    const stop = moveFiles ? await onStorageProgress(setProgress) : () => {}
    try {
      const result = await storageApply(plan.root, moveFiles, skippedIds(plan, off))
      // The model folder lives in the settings store too: the LU Engine scans
      // it and downloads into it, and it is handed to ComfyUI from there.
      useSettingsStore.getState().updateSettings({ hfDownloadPathOverride: result.modelsDir })
      await syncCustomModelDir(result.modelsDir)
      window.dispatchEvent(new CustomEvent('lu-models-refresh'))
      window.dispatchEvent(new CustomEvent(STORAGE_CHANGED_EVENT))
      setApplied(result)
      setPlan(null)
      typed.current = false
      await reload()
    } catch (e) {
      setError(errorText(e))
    } finally {
      stop()
      setProgress(null)
      setBusy(null)
    }
  }

  const groups = plan ? groupsOf(plan) : []
  const wanted = plan ? wantedCrossBytes(plan, off) : 0
  const roomy = plan ? enoughSpace(plan, wanted) : true
  const space = plan ? spaceLine(plan, wanted) : null
  const nothingToMove = plan ? groups.every((g) => off.has(g.group)) : true
  const working = busy !== null

  return (
    <div className="space-y-2 py-1" data-testid="storage-folder-setting">
      <p className="t-micro font-semibold text-gray-700 dark:text-gray-300">Storage folder</p>
      <div className="t-micro text-gray-500 leading-relaxed">
        One folder for everything LU downloads and makes: the models of the LU Engine{status?.comfyHere ? ' and ComfyUI' : ''}, {status?.comfyHere ? 'the gallery, ' : ''}the voice engine and LU&apos;s own Python. Pick a folder on another drive to keep the system drive free. LU shows what it would move before anything happens.
      </div>

      {status && (
        <ul className="space-y-1" data-testid="storage-places">
          {status.places.map((p) => (
            <li key={p.id} className="t-micro leading-relaxed">
              <span className="font-semibold text-gray-600 dark:text-gray-400">{PLACE_LABEL[p.id]}</span>
              <code className="block font-mono text-gray-400 break-all select-text">{p.path}</code>
              <span className={onSystemDrive(p.drive) ? 'text-gray-600 dark:text-gray-300' : HINWEIS_TEXT.ruhig}>{driveLine(p.drive)}</span>
            </li>
          ))}
          {!status.comfyHere && (
            <li className="t-micro text-gray-500 leading-relaxed">On this Mac the gallery and the image and video engines keep their own folders.</li>
          )}
        </ul>
      )}

      <div className="flex items-center gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => { typed.current = true; setDraft(e.target.value); setPlan(null) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void check(draft) }}
          placeholder={status ? `For example ${status.example}` : 'A folder on another drive'}
          aria-label="Storage folder"
          disabled={working}
          className="flex-1 px-2 py-1 rounded bg-transparent border border-white/8 t-micro text-gray-700 dark:text-gray-300 font-mono focus:outline-none focus:border-white/20"
        />
        <button onClick={pickFolder} disabled={working} className={BUTTON}>Browse…</button>
        <button onClick={() => void check(draft)} disabled={working || !draft.trim()} className={BUTTON} data-testid="storage-check">
          Check
        </button>
      </div>

      {busy === 'checking' && <p className="t-micro text-gray-500" role="status">Looking at what is there…</p>}

      {plan && (
        <div className="space-y-2 rounded-md border border-white/8 p-2" data-testid="storage-plan">
          <div className="t-micro text-gray-500 leading-relaxed">
            <p className="font-semibold text-gray-600 dark:text-gray-400">New downloads and pictures go to</p>
            {layoutLines(plan).map((l) => <code key={l} className="block font-mono text-gray-400 break-all select-text">{l}</code>)}
            <p>{driveLine(plan.drive)}</p>
          </div>
          {groups.length > 0 ? (
            <div className="space-y-1">
              <p className="t-micro font-semibold text-gray-600 dark:text-gray-400">Already there, can move along</p>
              {groups.map((g) => (
                <label key={g.group} className="flex items-start gap-2 t-micro leading-relaxed text-gray-500">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!off.has(g.group)}
                    disabled={working}
                    onChange={(e) => {
                      const next = new Set(off)
                      if (e.target.checked) next.delete(g.group)
                      else next.add(g.group)
                      setOff(next)
                    }}
                    aria-label={GROUP_LABEL[g.group]}
                  />
                  <span>
                    <span className="font-semibold text-gray-600 dark:text-gray-400">{GROUP_LABEL[g.group]}</span>
                    {g.items.map((i) => <code key={i.id} className="block font-mono text-gray-400 break-all select-text">{i.from}</code>)}
                    <span className="block">{groupLine(g)}</span>
                  </span>
                </label>
              ))}
            </div>
          ) : (
            <p className="t-micro text-gray-500">Nothing to move: no files of LU&apos;s are outside this folder.</p>
          )}
          {space && <p className={`t-micro leading-relaxed ${roomy ? 'text-gray-500' : HINWEIS_TEXT.fehler}`}>{space}{roomy ? '' : ' That is not enough, so LU moves nothing. Free some space there or untick a part.'}</p>}
          {plan.blocker && groups.length > 0 && <p className={`t-micro leading-relaxed ${HINWEIS_TEXT.fehler}`}>{plan.blocker}</p>}

          {!confirming && (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => void apply(false)} disabled={working} className={BUTTON} data-testid="storage-use">
                Use for new files only
              </button>
              {groups.length > 0 && (
                <button
                  onClick={() => setConfirming(true)}
                  disabled={working || !roomy || !!plan.blocker || nothingToMove}
                  className={BUTTON}
                  data-testid="storage-move"
                >
                  Move the files and use it
                </button>
              )}
            </div>
          )}
          {confirming && (
            <div className="space-y-1.5" data-testid="storage-confirm">
              <p className="t-micro text-gray-500 leading-relaxed">{moveConfirmText(plan, isWindows())}</p>
              <div className="flex gap-2">
                <button onClick={() => void apply(true)} className={BUTTON} data-testid="storage-move-now">Move now</button>
                <button onClick={() => setConfirming(false)} className="px-2.5 py-1 rounded-md t-micro text-gray-500">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {busy === 'applying' && <p className="t-micro text-gray-500" role="status">Saving the folder…</p>}
      {busy === 'moving' && (
        <div className="space-y-1" role="status" data-testid="storage-progress">
          <p className="t-micro text-gray-500">
            {progress ? progressLine(progress.allDone, progress.allTotal, progress.file) : 'Moving the files. This can take a while.'}
          </p>
          {progress && progress.allTotal > 0 && (
            <div className="h-1 rounded bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-500/70" style={{ width: `${Math.min(100, (progress.allDone / progress.allTotal) * 100)}%` }} />
            </div>
          )}
          <button onClick={() => void storageCancel()} className="px-2.5 py-1 rounded-md t-micro text-gray-500 hover:text-red-400">Cancel</button>
        </div>
      )}

      {applied && (
        <ul className="space-y-1" data-testid="storage-report">
          <li className={`t-micro leading-relaxed ${HINWEIS_TEXT.ruhig}`}>From now on LU puts new files in {applied.root}.</li>
          {reportLines(applied).map((l) => (
            <li key={l} className={`t-micro leading-relaxed ${reportHasProblems(applied) ? HINWEIS_TEXT.fehler : HINWEIS_TEXT.ruhig}`}>{l}</li>
          ))}
          {applied.runtime.map((o) => (
            <li key={`${o.kind}-${o.to}`} className={`t-micro leading-relaxed ${o.status === 'moved' ? 'text-gray-500' : HINWEIS_TEXT.fehler}`}>{moveOutcomeLine(o)}</li>
          ))}
          {applied.stopped.length > 0 && (
            <li className="t-micro text-gray-500">{applied.stopped.join(' and ')} {applied.stopped.length === 1 ? 'starts' : 'start'} again the next time you use {applied.stopped.length === 1 ? 'it' : 'them'}.</li>
          )}
        </ul>
      )}

      {error && (
        <p role="alert" className="t-micro text-red-500 dark:text-red-400 leading-snug whitespace-pre-line">{error}</p>
      )}
    </div>
  )
}
