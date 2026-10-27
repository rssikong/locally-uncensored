import type { ReactNode } from 'react'
import { cx, riskProps, testProps, type RiskMarked, type Testable } from './common'
import { Icon, type IconType } from './Icon'

export interface ChipProps extends Testable, RiskMarked {
  children: ReactNode
  onPress?: () => void
  /**
   * filter  a toggle, several may be on (aria-pressed)
   * choice  one of a group (role radio, aria-checked); put the chips in a ChipGroup with role radiogroup
   * action  a plain button, for status chips that open something
   */
  kind?: 'filter' | 'choice' | 'action'
  selected?: boolean
  icon?: IconType
  /** Looks 28 px high, the target stays 44 px high and at least 44 px wide. For the status row of the composer. */
  mini?: boolean
  tone?: 'default' | 'ok' | 'cloud' | 'warn'
  /** Accessible name when it must say more than the visible text. */
  label?: string
  disabled?: boolean
}

export function Chip(props: ChipProps) {
  const { children, onPress, kind = 'filter', selected = false, icon, mini, tone = 'default', label, disabled, risk } = props
  const state = kind === 'filter' ? { 'aria-pressed': selected } : kind === 'choice' ? { role: 'radio' as const, 'aria-checked': selected } : {}
  const content = (
    <>
      {icon ? <Icon icon={icon} small /> : null}
      {children}
    </>
  )
  return (
    <button
      type="button"
      className={cx('m-chip', mini && 'm-chip--mini', tone !== 'default' && `m-chip--${tone}`)}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
      {...riskProps(risk)}
      {...state}
      {...testProps(props)}
    >
      {mini ? <span>{content}</span> : content}
    </button>
  )
}

export interface ChipGroupProps extends Testable {
  children: ReactNode
  /** Accessible name of the row ("Filters"). */
  label: string
  /** radiogroup when the chips are choices. */
  role?: 'group' | 'radiogroup'
  /** Wrap instead of scrolling sideways. */
  wrap?: boolean
}

/** A row of chips. Scrolls sideways and starts 16 px from the edge, so it never meets the back swipe. */
export function ChipGroup(props: ChipGroupProps) {
  const { children, label, role = 'group', wrap } = props
  return (
    <div className={cx('m-chips', wrap && 'm-chips--wrap')} role={role} aria-label={label} {...testProps(props)}>
      {children}
    </div>
  )
}
