import type { FitVerdict } from '../lib/device-fit'
import { cx, testProps, type Testable } from './common'

export type FitLevel = FitVerdict | 'unknown'

/** The four levels of DESIGN.md M1. The text always stands next to the dot: colour never speaks alone. */
export const FIT_TEXT: Record<FitLevel, string> = {
  fits: 'Should run well on this phone',
  tight: 'Tight fit, may be slow',
  'too-large': 'Too large for this phone',
  unknown: 'Size unknown',
}

export function FitBadge(props: { level: FitLevel; text?: string } & Testable) {
  const { level, text } = props
  return (
    <span className={cx('m-fit', level !== 'unknown' && `m-fit--${level}`)} data-fit={level} {...testProps(props)}>
      <i aria-hidden="true" />
      {text ?? FIT_TEXT[level]}
    </span>
  )
}
