import type { ReactNode } from 'react'
import { cx, riskProps, testProps, type RiskMarked, type Testable } from './common'
import { Icon, type IconType } from './Icon'

/**
 * `apple` is the button "Sign in with Apple" and nothing else: black on a light page, white on a dark one, as Apple asks.
 * `link` is a quiet offer in the accent colour without a frame, as wide as its words (round 57): the one way on
 * that is not the point of the screen, under an empty state for example. Still a 44 px target.
 */
export type ButtonVariant = 'primary' | 'cloud' | 'default' | 'quiet' | 'link' | 'danger' | 'apple'

export interface ButtonProps extends Testable, RiskMarked {
  children: ReactNode
  onPress?: () => void
  /** primary: the one filled button of a screen. cloud: costs credits. danger: destructive. */
  variant?: ButtonVariant
  icon?: IconType
  /** Full width. */
  block?: boolean
  compact?: boolean
  disabled?: boolean
  /** Why it is disabled, shown under the label. A disabled button never is just grey (DESIGN.md C5). */
  disabledReason?: string
  /** Shows a ring and ignores taps, so a double tap cannot fire twice. */
  busy?: boolean
  /** Accessible name when it must differ from the visible text. */
  label?: string
  type?: 'button' | 'submit'
  autoFocus?: boolean
}

export function Button(props: ButtonProps) {
  const { children, onPress, variant = 'default', icon, block, compact, disabled, disabledReason, busy, label, type = 'button', autoFocus, risk } = props
  const blocked = disabled || busy
  return (
    <button
      type={type}
      className={cx('m-btn', variant !== 'default' && `m-btn--${variant}`, block && 'm-btn--block', compact && 'm-btn--compact')}
      disabled={disabled}
      aria-busy={busy || undefined}
      aria-label={label}
      data-m-autofocus={autoFocus ? '' : undefined}
      onClick={blocked ? undefined : onPress}
      {...riskProps(risk)}
      {...testProps(props)}
    >
      {busy ? <span className="m-ring" aria-hidden="true" /> : icon ? <Icon icon={icon} small /> : null}
      <span>
        {children}
        {disabled && disabledReason ? <span className="m-btn-hint">{disabledReason}</span> : null}
      </span>
    </button>
  )
}
