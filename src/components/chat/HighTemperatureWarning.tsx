import { AlertTriangle } from 'lucide-react'
import { HINWEIS_TEXT } from '../../lib/hinweis'
import { HIGH_TEMPERATURE_WARNING, isHighTemperature } from '../../lib/sampling'

/** Label of the one-click way back, shared with its tests. */
export const RESET_TO_DEFAULT_LABEL = 'Reset to default'

/**
 * The warning under a temperature slider from TEMPERATURE_WARN up (A33), in
 * the chat popup, on the Settings page and in the persona editor. Red, not
 * the calm tone of the "changed" star: at this value the next answer is noise.
 * Renders nothing below the threshold.
 */
export function HighTemperatureWarning({ temperature, onReset }: { temperature: number | undefined; onReset?: () => void }) {
  if (!isHighTemperature(temperature)) return null
  return (
    <div role="alert" data-testid="high-temperature-warning" className={`flex items-start gap-1.5 t-micro ${HINWEIS_TEXT.fehler}`}>
      <AlertTriangle size={11} className="mt-px shrink-0" />
      <span className="flex-1">{HIGH_TEMPERATURE_WARNING}</span>
      {onReset && (
        <button
          type="button"
          data-testid="temperature-reset-default"
          className="shrink-0 underline"
          onClick={onReset}
        >
          {RESET_TO_DEFAULT_LABEL}
        </button>
      )}
    </div>
  )
}
