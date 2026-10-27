import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { testProps, type Testable } from './common'

export interface SegmentOption<V extends string> {
  value: V
  label: string
  disabled?: boolean
  testid?: string
}

export interface SegmentedProps<V extends string> extends Testable {
  /** Required accessible name of the group ("Theme"). */
  label: string
  options: ReadonlyArray<SegmentOption<V>>
  value: V
  onChange: (value: V) => void
  /**
   * 'box' (default): the options in a grey box, the chosen one a raised pill. 'tabs' (round 57, David): no box, two
   * halves on a hairline, the chosen one in full text with a thin line under it. For a switch that heads a page.
   */
  look?: 'box' | 'tabs'
}

/** Inner padding of an option at both sides, gap between options and padding of the group, as in styles/components.css. */
const OPTION_PAD_PX = 16
/** The least width of an option where the stylesheet names none: --m-touch on iOS and in a browser (styles/tokens.css). */
const OPTION_MIN_PX = 44
const GAP_PX = 2
const GROUP_PAD_PX = 6

/**
 * Pure: do the options fit next to each other. `labels` are the widths of
 * the label texts on one line, `available` the inner width of the group,
 * `optionMin` the least width of one option (the touch target of the platform).
 */
export function segmentsFit(labels: readonly number[], available: number, optionMin: number = OPTION_MIN_PX): boolean {
  if (labels.length === 0 || available <= 0) return true
  const need = labels.reduce((sum, width) => sum + Math.max(optionMin, Math.ceil(width) + OPTION_PAD_PX), 0) + GAP_PX * (labels.length - 1) + GROUP_PAD_PX
  return need <= available + 0.5
}

/**
 * Two to four options, one of them chosen. When they do not fit next to each
 * other (large text, a small phone) ALL of them go under each other at full
 * width: never two in one row and a lone third below, and never a label that
 * is cut.
 */
export function Segmented<V extends string>(props: SegmentedProps<V>) {
  const { label, options, value, onChange, look = 'box' } = props
  const ref = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  const labelKey = options.map((option) => option.label).join('\u0000')

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    const measure = () => {
      // The labels are measured on one line, whatever the group looks like right now.
      root.setAttribute('data-measuring', '')
      const widths = Array.from(root.querySelectorAll<HTMLElement>('.m-seg-label')).map((el) => el.getBoundingClientRect().width)
      root.removeAttribute('data-measuring')
      // The least width of an option is the touch target, and that is larger on Android (styles/tokens.css).
      const touch = parseFloat(getComputedStyle(root).getPropertyValue('--m-touch'))
      setStacked(!segmentsFit(widths, root.clientWidth, Number.isFinite(touch) && touch > 0 ? touch : undefined))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(root)
    // The text size of the system changed, or the app font arrived: the labels have another width, the group has not.
    window.addEventListener('lu:font-scale', measure)
    let alive = true
    void document.fonts?.ready.then(() => {
      if (alive) measure()
    })
    return () => {
      alive = false
      observer?.disconnect()
      window.removeEventListener('lu:font-scale', measure)
    }
  }, [labelKey])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!step) return
    const enabled = options.filter((o) => !o.disabled)
    const at = enabled.findIndex((o) => o.value === value)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    if (!next) return
    event.preventDefault()
    onChange(next.value)
    const index = options.indexOf(next)
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[index]?.focus()
  }

  return (
    <div ref={ref} role="radiogroup" aria-label={label} className={look === 'tabs' ? 'm-seg m-seg--tabs' : 'm-seg'} data-stacked={stacked ? '' : undefined} onKeyDown={onKeyDown} {...testProps(props)}>
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={option.disabled}
            className="m-seg-opt"
            data-testid={option.testid}
            onClick={() => {
              if (!checked) onChange(option.value)
            }}
          >
            <span className="m-seg-label">{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
