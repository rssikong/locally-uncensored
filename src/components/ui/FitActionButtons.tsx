/**
 * The buttons under the LU Engine's fit sentence (3.0.8, A25): "Context 16K",
 * "KV q8_0". One click saves the setting and restarts the engine with it
 * (api/engine-fit-apply.ts). Drawn wherever the sentence is: the model menu in the
 * chat, the standing line on the Models page, and Settings, LU Engine.
 *
 * Quiet text buttons in the accent, the house style for an action inside a
 * hint (lib/hinweis.ts): the sentence is information, not an alarm.
 */
import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { FitAction } from '../../lib/engine-fit'
import { applyFitAction } from '../../api/engine-fit-apply'

interface Props {
  actions: FitAction[]
  /** The model the running engine has loaded, which the restart loads again. */
  modelPath: string | null | undefined
  /** After the engine is back with the new setting. */
  onApplied?: () => void
  className?: string
}

export function FitActionButtons({ actions, modelPath, onApplied, className }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (actions.length === 0) return null
  const press = async (a: FitAction) => {
    setBusy(a.label)
    setError(null)
    try {
      await applyFitAction(a, modelPath)
      onApplied?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 ${className ?? ''}`} data-testid="fit-actions">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          disabled={busy !== null}
          onClick={() => void press(a)}
          title={a.ctx !== undefined ? `Set the context to ${a.ctx} tokens and restart the LU Engine` : `Store the KV cache as ${a.kv} and restart the LU Engine`}
          className="inline-flex items-center gap-1 text-lu-accent hover:underline disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy === a.label ? <Loader2 size={9} className="animate-spin" /> : null}
          {a.label}
        </button>
      ))}
      {error ? <span className="basis-full text-red-600 dark:text-red-300 break-all">{error}</span> : null}
    </div>
  )
}
