interface Props {
  label?: string
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  unit?: string
  format?: (v: number) => string
}

// Upgrade of src/components/settings/SliderControl.tsx — same neutral-grey fill
// and thumb as the live app, plus a unit + tabular-mono value readout.
export function Slider({ label, value, min, max, step, onChange, unit, format }: Props) {
  // Held inside the track: a value outside min..max (a stored setting from a
  // wider range) drew the bar and the thumb past the end of the slider.
  const pct = max > min ? Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100)) : 0
  const display = format ? format(value) : `${value}${unit ? ' ' + unit : ''}`
  return (
    <div className="space-y-1.5">
      {label !== undefined && (
        <div className="flex items-center justify-between">
          <span className="t-control text-gray-400">{label}</span>
          <span className="t-mono text-gray-300">{display}</span>
        </div>
      )}
      <div className="relative h-5 flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-white/10" />
        <div className="absolute left-0 h-1 rounded-full bg-gray-400" style={{ width: `${pct}%` }} />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-x-0 w-full cursor-pointer"
          style={{ zIndex: 2, opacity: 0, top: '-4px', height: '28px' }}
        />
        <div
          className="absolute w-3.5 h-3.5 rounded-full pointer-events-none bg-gray-300 border border-gray-500"
          style={{ left: `calc(${pct}% - 7px)`, zIndex: 1, boxShadow: '0 1px 4px rgba(0,0,0,0.4)' }}
        />
      </div>
    </div>
  )
}
