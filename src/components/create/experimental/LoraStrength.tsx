import { useId, useState } from 'react'
import { Slider } from '../ui/Slider'
import {
  LORA_SLIDER_MAX, LORA_SLIDER_MIN, LORA_STRENGTH_MAX, LORA_STRENGTH_MIN, LORA_STRENGTH_STEP,
  parseLoraStrength, stepLoraStrength,
} from '../../../lib/lora-strength'

interface Props {
  /** The LoRA this strength belongs to, as its row names it (a file name or
   *  a catalogue name), for the field's accessible name. */
  name: string
  value: number
  onChange: (v: number) => void
}

const shown = (v: number) => v.toFixed(2)

/**
 * The strength of one LoRA in the stack: the slider for the usual 0 to 2 and
 * a number field for the exact value, which also takes what the slider cannot
 * reach (Discord 2026-10-02: slider LoRAs for Krea 2 are made
 * for about -10 to 10, negative included; Discord 2026-10-23: some for -10 to
 * 15, so the field takes -20 to 20).
 *
 * The field is a text input on purpose. While someone types, "-" and "1," are
 * not numbers yet, and a number input hands those back as an empty string, so
 * the half-typed value could not be kept. What is typed is applied as soon as
 * it reads as a number; leaving the field shows the applied value again, so a
 * typo never stays on screen as if it counted.
 */
export function LoraStrength({ name, value, onChange }: Props) {
  const id = useId()
  const [draft, setDraft] = useState<string | null>(null)
  const label = name.replace(/^.*[\\/]/, '').replace(/\.safetensors$/i, '')
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="t-control text-gray-400">Strength</label>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-label={`Strength of ${label}`}
          title={`${LORA_STRENGTH_MIN} to ${LORA_STRENGTH_MAX}`}
          value={draft ?? shown(value)}
          onFocus={(e) => { setDraft(shown(value)); e.target.select() }}
          onChange={(e) => {
            setDraft(e.target.value)
            const typed = parseLoraStrength(e.target.value)
            if (typed !== null) onChange(typed)
          }}
          onBlur={() => setDraft(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.currentTarget.blur(); return }
            if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
            e.preventDefault()
            const next = stepLoraStrength(value, e.key === 'ArrowUp' ? 1 : -1)
            onChange(next)
            setDraft(shown(next))
          }}
          className="w-16 h-6 px-1.5 rounded-[var(--radius-control)] bg-white/[0.04] border border-white/[0.08] focus:border-white/20 outline-none text-right t-mono text-gray-200"
        />
      </div>
      <Slider
        min={LORA_SLIDER_MIN}
        max={LORA_SLIDER_MAX}
        step={LORA_STRENGTH_STEP}
        value={Math.max(LORA_SLIDER_MIN, Math.min(LORA_SLIDER_MAX, value))}
        onChange={onChange}
      />
    </div>
  )
}
