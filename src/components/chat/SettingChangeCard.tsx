import { useState } from 'react'
import { Check, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useSettingsConfirmStore, type SettingChangeRequest } from '../../stores/settingsConfirmStore'
import { settingChangeState, undoSettingChange, type SettingChange } from '../../api/mcp/settings-tools'
import { findEntry, patchFor } from '../../lib/settings-catalog'

const box = 'mt-1 mb-1.5 max-w-xl rounded-lg border border-gray-200 dark:border-white/[0.1] bg-gray-50 dark:bg-white/[0.03]'
const btnYes = 'flex items-center gap-1 px-2.5 py-1 rounded t-micro font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/15 border border-emerald-500/20 dark:border-emerald-500/25 transition-colors'
const btnNo = 'flex items-center gap-1 px-2.5 py-1 rounded t-micro font-medium text-gray-700 dark:text-gray-300 bg-gray-500/10 hover:bg-gray-500/15 border border-gray-500/20 transition-colors'

function FromTo({ label, from, to }: { label: string; from: string; to: string }) {
  return (
    <span className="t-body text-gray-900 dark:text-gray-100">
      {label}: <span className="text-gray-500 dark:text-gray-400">{from}</span> → <span className="font-medium">{to}</span>
    </span>
  )
}

/** A11: the question in front of a settings change from the chat. Only a
 *  click applies it, also in Bypass. */
export function SettingChangeAsk({ req }: { req: SettingChangeRequest }) {
  const answer = useSettingsConfirmStore((s) => s.answer)
  return (
    <div role="group" aria-label="Change an app setting" data-testid="setting-change-ask" className={`${box} px-3 py-2.5`}>
      <div className="flex items-center gap-1.5">
        <SlidersHorizontal size={13} className="shrink-0 text-gray-500 dark:text-gray-400" />
        <p className="t-body font-medium text-gray-900 dark:text-gray-100">Change this setting?</p>
      </div>
      <p className="mt-1" data-testid="setting-change-fromto"><FromTo label={req.label} from={req.from} to={req.to} /></p>
      {req.note && <p className="mt-0.5 t-micro text-gray-600 dark:text-gray-400">{req.note}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        <button type="button" data-testid="setting-change-accept" className={btnYes}
          onClick={(e) => { e.stopPropagation(); answer(req.id, true) }}>
          <Check size={10} /> Accept
        </button>
        <button type="button" data-testid="setting-change-decline" className={btnNo}
          onClick={(e) => { e.stopPropagation(); answer(req.id, false) }}>
          <X size={10} /> Decline
        </button>
      </div>
    </div>
  )
}

/** After the yes: the change stays visible with Undo. The state is read from
 *  the setting itself, so the row is right after a restart and after a
 *  change by hand. */
export function SettingChangeDone({ change }: { change: SettingChange }) {
  // Re-render when the setting moves.
  useSettingsStore((s) => s.settings)
  const [confirmMoved, setConfirmMoved] = useState(false)
  const entry = findEntry(change.key)
  if (!entry) return null
  const state = settingChangeState(change)
  const from = entry.show(change.from)
  const to = entry.show(change.to)
  return (
    <div data-testid="setting-change-done" data-state={state} className={`${box} px-3 py-1.5 flex flex-wrap items-center gap-x-2 gap-y-1`}>
      <SlidersHorizontal size={11} className="shrink-0 text-gray-500 dark:text-gray-400" />
      <FromTo label={entry.label} from={from} to={to} />
      {state === 'applied' && (
        <button type="button" data-testid="setting-change-undo" className={btnNo}
          onClick={(e) => { e.stopPropagation(); undoSettingChange(change) }}>
          <RotateCcw size={10} /> Undo
        </button>
      )}
      {state === 'undone' && (
        <>
          <span className="t-micro text-gray-500 dark:text-gray-400">Undone</span>
          <button type="button" data-testid="setting-change-redo" className={btnNo}
            onClick={(e) => {
              e.stopPropagation()
              const store = useSettingsStore.getState()
              store.updateSettings(patchFor(store.settings, entry.key, change.to))
            }}>
            Apply again
          </button>
        </>
      )}
      {state === 'moved' && (
        confirmMoved ? (
          <button type="button" data-testid="setting-change-undo-anyway" className={btnNo}
            onClick={(e) => { e.stopPropagation(); undoSettingChange(change); setConfirmMoved(false) }}>
            <RotateCcw size={10} /> Set back to {from} anyway
          </button>
        ) : (
          <>
            <span className="t-micro text-gray-500 dark:text-gray-400">Changed since</span>
            <button type="button" data-testid="setting-change-undo" className={btnNo}
              onClick={(e) => { e.stopPropagation(); setConfirmMoved(true) }}>
              <RotateCcw size={10} /> Undo
            </button>
          </>
        )
      )}
    </div>
  )
}
