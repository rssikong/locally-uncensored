// Discord wish D2: "choose where the models go, LU on another drive". The
// model, ComfyUI and trainer folders could already be chosen; the voice
// engine, the read-aloud voices and LU's own Python sat in the app data
// folder on the system drive. This row gives them one folder of their own.
// Choosing it moves nothing; the Move button does, on a click, and puts the
// old files in the trash only after the copy has been checked and started.
import { useEffect, useState } from 'react'
import { backendCall, isWindows } from '../../api/backend'
import {
  moveRuntimeFolder,
  runtimeFolderStatus,
  setRuntimeFolder,
  type MoveOutcome,
  type RuntimeFolderStatus,
} from '../../api/runtime-folder'
import {
  RUNTIME_FOLDER_CLASH,
  RUNTIME_KIND_LABEL,
  canMoveRuntime,
  moveConfirmText,
  moveOutcomeLine,
  runtimeEntryNote,
  runtimeFolderClash,
} from '../../lib/runtime-folder'
import { useSettingsStore } from '../../stores/settingsStore'
import { HINWEIS_TEXT } from '../../lib/hinweis'

function errorText(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  return 'Something went wrong. Try again.'
}

const BUTTON =
  'px-2.5 py-1 rounded-md text-[0.6rem] font-medium bg-white dark:bg-white/10 text-gray-800 dark:text-white hover:bg-gray-100 dark:hover:bg-white/15 border border-gray-200 dark:border-white/15 transition-colors disabled:opacity-50'

export function RuntimeFolderSetting() {
  const modelFolder = useSettingsStore((s) => s.settings.hfDownloadPathOverride)
  const [status, setStatus] = useState<RuntimeFolderStatus | null>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [moving, setMoving] = useState(false)
  const [outcomes, setOutcomes] = useState<MoveOutcome[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      void runtimeFolderStatus()
        .then((s) => { if (alive) setStatus(s) })
        .catch((e) => { if (alive) setError(errorText(e)) })
    }
    load()
    // The Storage folder row above chooses this folder too.
    window.addEventListener('lu-storage-changed', load)
    return () => { alive = false; window.removeEventListener('lu-storage-changed', load) }
  }, [])

  const chosen = status?.chosen ?? null
  const shown = draft ?? chosen ?? ''

  async function commit(next: string) {
    const path = next.trim()
    setDraft(null)
    if (path === (chosen ?? '')) return
    if (path && runtimeFolderClash(path, modelFolder)) {
      setDraft(next)
      setError(RUNTIME_FOLDER_CLASH)
      return
    }
    setError(null)
    setOutcomes(null)
    setConfirming(false)
    try {
      setStatus(await setRuntimeFolder(path))
    } catch (e) {
      // The typed path stays in the box, so it can be corrected.
      setDraft(next)
      setError(errorText(e))
    }
  }

  async function pickFolder() {
    setError(null)
    try {
      const picked = await backendCall<string | null>('pick_folder')
      if (picked) await commit(picked)
    } catch (e) {
      setError(`The folder picker did not open. Type or paste the path into the field instead. ${errorText(e)}`)
    }
  }

  async function move() {
    setConfirming(false)
    setMoving(true)
    setError(null)
    setOutcomes(null)
    try {
      setOutcomes(await moveRuntimeFolder())
    } catch (e) {
      setError(errorText(e))
    } finally {
      setMoving(false)
      try { setStatus(await runtimeFolderStatus()) } catch { /* the old status stays on screen */ }
    }
  }

  const movable = status ? canMoveRuntime(status.entries, chosen) : false

  return (
    <div className="space-y-2 py-1 border-t border-white/5 mt-2 pt-2" data-testid="runtime-folder-setting">
      <p className="t-micro font-semibold text-gray-700 dark:text-gray-300">Voice and Python folder</p>
      <div className="text-[0.6rem] text-gray-500 leading-relaxed">
        Where LU keeps the voice engine, the read-aloud voices and its own Python. Leave it empty and LU uses its app data folder. Choosing a folder moves nothing: new installs go there, and what is installed keeps working where it is until you move it.
      </div>
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={shown}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { if (draft !== null) void commit(draft) }}
          onKeyDown={(e) => { if (e.key === 'Enter' && draft !== null) void commit(draft) }}
          placeholder={status ? `LU's app data folder: ${status.defaultFolder}` : "LU's app data folder"}
          aria-label="Voice and Python folder"
          disabled={moving}
          className="flex-1 px-2 py-1 rounded bg-transparent border border-white/8 text-[0.65rem] text-gray-700 dark:text-gray-300 font-mono focus:outline-none focus:border-white/20"
        />
        <button onClick={pickFolder} disabled={moving} className={BUTTON}>
          Browse…
        </button>
        {chosen && (
          <button
            onClick={() => void commit('')}
            disabled={moving}
            className="px-2.5 py-1 rounded-md text-[0.6rem] text-gray-500 hover:text-red-400 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
      {!status && !error && (
        <p className="t-micro text-gray-500" role="status" data-testid="runtime-folder-loading">Looking for what is installed…</p>
      )}
      {status && (
        <ul className="space-y-1" data-testid="runtime-folder-entries">
          {status.entries.map((entry) => (
            <li key={entry.kind} className="t-micro leading-relaxed">
              <span className="font-semibold text-gray-600 dark:text-gray-400">{RUNTIME_KIND_LABEL[entry.kind]}</span>
              <code className="block font-mono text-gray-400 break-all select-text">{entry.path}</code>
              <span className="text-gray-500">{runtimeEntryNote(entry, chosen)}</span>
            </li>
          ))}
        </ul>
      )}
      {movable && !confirming && !moving && (
        <button onClick={() => setConfirming(true)} className={BUTTON} data-testid="runtime-folder-move">
          Move to this folder
        </button>
      )}
      {confirming && (
        <div className="space-y-1.5" data-testid="runtime-folder-confirm">
          <p className="t-micro text-gray-500 leading-relaxed">{moveConfirmText(isWindows())}</p>
          <div className="flex gap-2">
            <button onClick={() => void move()} className={BUTTON}>Move now</button>
            <button onClick={() => setConfirming(false)} className="px-2.5 py-1 rounded-md text-[0.6rem] text-gray-500">Cancel</button>
          </div>
        </div>
      )}
      {moving && (
        <p className="t-micro text-gray-500" role="status">Moving the files. This can take several minutes.</p>
      )}
      {outcomes && outcomes.length > 0 && (
        <ul className="space-y-1" data-testid="runtime-folder-outcomes">
          {outcomes.map((o) => (
            <li key={o.kind} className={`t-micro leading-relaxed ${o.status === 'moved' ? HINWEIS_TEXT.ruhig : HINWEIS_TEXT.fehler}`}>
              {moveOutcomeLine(o)}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-[0.55rem] text-red-500 dark:text-red-400 leading-snug whitespace-pre-line">
          {error}
        </p>
      )}
    </div>
  )
}
