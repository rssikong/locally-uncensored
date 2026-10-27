import { useId, useState, type CSSProperties } from 'react'
import { Minus, Plus } from 'lucide-react'
import { COMMON } from '../strings/common'
import { testProps, type Testable } from './common'
import { hyphenated } from './hyphenate'
import { IconButton } from './IconButton'

export interface NumberProps extends Testable {
  /** Required accessible name ("Temperature"). */
  label: string
  value: number
  onChange: (value: number) => void
  min: number
  max: number
  step?: number
  /** How the value is shown ("0.7", "40%"). Default: the number. */
  format?: (value: number) => string
  disabled?: boolean
}

/** Pure: one step up or down, held inside min and max, without float dust (0.1 + 0.2). */
export function stepValue(value: number, direction: 1 | -1, min: number, max: number, step: number): number {
  const decimals = Math.max(0, (String(step).split('.')[1] ?? '').length)
  const next = Number((value + direction * step).toFixed(decimals))
  return Math.min(max, Math.max(min, next))
}

/**
 * A slider with its value in mono and plus and minus buttons next to it, so
 * nobody has to drag with fine motor control (DESIGN.md 8).
 */
export function Slider(props: NumberProps) {
  const { label, value, onChange, min, max, step = 1, format, disabled } = props
  const id = useId()
  const shown = format ? format(value) : String(value)
  return (
    <div className="m-slider">
      <div className="m-slider-head">
        <label className="m-slider-name" htmlFor={id}>
          {label}
        </label>
        <span className="m-mono" aria-hidden="true">
          {shown}
        </span>
      </div>
      <div className="m-slider-row">
        <IconButton icon={Minus} label={COMMON.decrease(label)} edged disabled={disabled || value <= min} onPress={() => onChange(stepValue(value, -1, min, max, step))} />
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-valuetext={shown}
          style={{ '--m-slider-at': `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` } as CSSProperties}
          onChange={(event) => onChange(Number(event.target.value))}
          {...testProps(props)}
        />
        <IconButton icon={Plus} label={COMMON.increase(label)} edged disabled={disabled || value >= max} onPress={() => onChange(stepValue(value, 1, min, max, step))} />
      </div>
    </div>
  )
}

export interface NumberFieldProps extends NumberProps {
  /** Show `label` as a visible title in front of the control. Without it the label is only the accessible name. */
  showLabel?: boolean
  /** One sentence under the visible title. */
  hint?: string
  /** Whole numbers only: the number keyboard without a decimal point, and a typed fraction is rounded. */
  integer?: boolean
}

/**
 * Pure: what a typed text means for a number field. null while it is not a
 * number yet (empty, a lone minus), so the field can be cleared and typed
 * anew; otherwise the number, rounded for whole numbers and held inside min
 * and max.
 */
export function parseNumberInput(raw: string, min: number, max: number, integer: boolean): number | null {
  const text = raw.trim().replace(',', '.')
  if (text === '' || text === '-' || text === '.') return null
  const typed = Number(text)
  if (!Number.isFinite(typed)) return null
  const value = integer ? Math.round(typed) : typed
  return Math.min(max, Math.max(min, value))
}

/**
 * A number with plus and minus, for values typed rather than dragged ("Keep
 * at most", "Threads"). The field can be emptied while typing; the value
 * only changes once a number stands there, and a number outside min and max
 * is pulled in at once.
 */
export function NumberField(props: NumberFieldProps) {
  const { label, value, onChange, min, max, disabled, showLabel, hint, integer = false } = props
  const step = integer ? Math.max(1, Math.round(props.step ?? 1)) : (props.step ?? 1)
  const id = useId()
  const shown = Number.isFinite(value) ? String(value) : ''
  // What is in the field while the user types; null while the field follows the value.
  const [draft, setDraft] = useState<string | null>(null)
  const control = (
    <div className="m-num">
      <IconButton
        icon={Minus}
        label={COMMON.decrease(label)}
        edged
        disabled={disabled || value <= min}
        onPress={() => {
          setDraft(null)
          onChange(stepValue(value, -1, min, max, step))
        }}
      />
      <input
        id={id}
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={min}
        max={max}
        step={step}
        value={draft ?? shown}
        disabled={disabled}
        aria-label={showLabel ? undefined : label}
        aria-describedby={showLabel && hint ? `${id}-hint` : undefined}
        onChange={(event) => {
          const raw = event.target.value
          const next = parseNumberInput(raw, min, max, integer)
          // A number that was pulled inside the limits or rounded shows at once as what was taken.
          setDraft(next !== null && next !== Number(raw.replace(',', '.')) ? null : raw)
          if (next !== null && next !== value) onChange(next)
        }}
        onBlur={() => setDraft(null)}
        {...testProps(props)}
      />
      <IconButton
        icon={Plus}
        label={COMMON.increase(label)}
        edged
        disabled={disabled || value >= max}
        onPress={() => {
          setDraft(null)
          onChange(stepValue(value, 1, min, max, step))
        }}
      />
    </div>
  )
  if (!showLabel) return control
  return (
    <div className="m-numrow">
      <div className="m-numrow-text">
        <label className="m-numrow-title" htmlFor={id}>
          {hyphenated(label)}
        </label>
        {hint ? (
          <span className="m-numrow-hint" id={`${id}-hint`}>
            {hint}
          </span>
        ) : null}
      </div>
      {control}
    </div>
  )
}
