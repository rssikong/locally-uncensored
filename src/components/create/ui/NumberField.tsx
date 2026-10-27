import { useState } from 'react'
import { Dices } from 'lucide-react'
import { cn } from './cn'

interface Props {
  label?: string
  value: number
  min?: number
  max?: number
  step?: number
  /** The grid a typed value is rounded to when it is committed; `step` when
   *  not given. `step` stays what the arrows and the stepper move by. */
  grid?: number
  onChange: (v: number) => void
  onRandomize?: () => void
  mono?: boolean
  suffix?: string
  className?: string
}

/**
 * Bring a typed value inside the declared bounds and onto the step grid.
 *
 * `min` / `max` / `step` on an <input type="number"> are advisory: React takes
 * whatever was typed or pasted, so a Width declared 64..4096 step 64 reached
 * the generator as 9999 or 3 and the job failed in the backend — in cloud mode
 * after the request was already on its way. Applied on BLUR or Enter, never
 * per keystroke: clamping while typing turns "1024" into 64 at the first digit.
 */
export function commitNumber(v: number, min?: number, max?: number, step?: number): number {
  let out = v
  if (typeof step === 'number' && step > 0 && typeof min === 'number') {
    out = min + Math.round((out - min) / step) * step
  }
  if (typeof min === 'number') out = Math.max(min, out)
  if (typeof max === 'number') out = Math.min(max, out)
  return out
}

export function NumberField({ label, value, min, max, step = 1, grid, onChange, onRandomize, mono = true, suffix, className }: Props) {
  // What is typed stays in the field as typed until it is committed. Only a
  // number already inside the bounds goes to the store while typing, so the
  // store's own clamp never rewrites a half-typed value (Discord
  // #bug-reports 22.10.2026: emptying Width and typing 1920 showed 64 at
  // the first digit, then 641). The arrows and the stepper land inside the
  // bounds and so still take effect at once.
  const [draft, setDraft] = useState<string | null>(null)
  const fits = (n: number) => (typeof min !== 'number' || n >= min) && (typeof max !== 'number' || n <= max)
  const commit = () => {
    if (draft === null) return
    setDraft(null)
    const v = parseFloat(draft)
    if (Number.isNaN(v)) return
    const fixed = commitNumber(v, min, max, grid ?? step)
    if (fixed !== value) onChange(fixed)
  }
  return (
    <div className={cn('space-y-1.5', className)}>
      {label !== undefined && <div className="t-control text-gray-400">{label}</div>}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center flex-1 h-[var(--control-h-md)] px-2.5 rounded-[var(--radius-control)] bg-white/[0.04] border border-white/[0.08] focus-within:border-white/20">
          <input
            type="number"
            aria-label={label}
            value={draft ?? value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => {
              const text = e.target.value
              setDraft(text)
              const v = parseFloat(text)
              if (!Number.isNaN(v) && fits(v)) onChange(v)
            }}
            onBlur={commit}
            onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
            className={cn('bg-transparent outline-none w-full t-control text-gray-200', mono && 'lu-hud-num')}
          />
          {suffix && <span className="t-mono text-gray-600 shrink-0 pl-1">{suffix}</span>}
        </div>
        {onRandomize && (
          <button
            onClick={onRandomize}
            title="Randomize"
            className="h-[var(--control-h-md)] aspect-square inline-flex items-center justify-center rounded-[var(--radius-control)] bg-white/[0.06] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Dices size={14} />
          </button>
        )}
      </div>
    </div>
  )
}
