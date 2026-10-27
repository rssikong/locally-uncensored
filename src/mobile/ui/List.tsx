import type { ReactNode } from 'react'
import { BETA_LABEL, betaNote, type BetaFeature } from '../../lib/beta'
import { ChevronRight } from 'lucide-react'
import { haptic } from '../platform/haptics'
import { cx, riskProps, testProps, type RiskMarked, type Testable } from './common'
import { hyphenated } from './hyphenate'
import { Icon, type IconType } from './Icon'
import { SwitchTrack } from './Switch'

export interface ListGroupProps extends Testable {
  /** Group title in capitals above the rows. */
  title?: string
  /** A small mark after the title, for example the Beta mark of a group. */
  titleMark?: ReactNode
  children: ReactNode
  /** radiogroup when the rows are radio choices; then `label` (or `title`) names the group. */
  role?: 'radiogroup'
  label?: string
  /**
   * A flat list: the rows run from edge to edge with hairlines between them, no card around them (round 57).
   * For lists of things (chats, desktops). Settings and choices keep the card.
   */
  flat?: boolean
}

/** A group of rows with hairlines between them. */
export function ListGroup(props: ListGroupProps) {
  const { title, titleMark, children, role, label, flat } = props
  return (
    <section {...testProps(props)}>
      {title ? (
        <h2 className={cx('m-label m-group-label', flat && 'm-group-label--flat')}>
          {hyphenated(title)}
          {titleMark ? <span className="m-group-label-mark">{titleMark}</span> : null}
        </h2>
      ) : null}
      <div className={cx('m-group', flat && 'm-group--flat')} role={role} aria-label={role ? (label ?? title) : undefined}>
        {children}
      </div>
    </section>
  )
}

/** Several groups under each other. Only a wrapper, for readable screens. */
export function List({ children, ...rest }: { children: ReactNode } & Testable) {
  return <div {...testProps(rest)}>{children}</div>
}

export interface RowProps extends Testable, RiskMarked {
  title: string
  /**
   * The stable id of the entry this row stands for (a chat id, a model name),
   * written as data-m-id next to the data-testid of the list. A test finds
   * one row of many by it.
   */
  id?: string
  /** A state a test or a style can read ("loaded", "active"), written as data-state. */
  state?: string
  /** Second line: an addition, or the reason why the row is disabled. */
  subtitle?: ReactNode
  icon?: IconType
  /** Current value at the right ("Dark"). */
  value?: string
  /** The whole row is the target. */
  onPress?: () => void
  /** Show a chevron: the row leads to a page. Default true when onPress is set and nothing else is at the end. */
  chevron?: boolean
  /** The row is a switch. Acts at once. */
  switch?: { checked: boolean; onChange: (next: boolean) => void; tone?: 'accent' | 'cloud' }
  /**
   * The row is one choice of a radiogroup (put it in a ListGroup with role="radiogroup").
   * With `reselect`, a tap on the row that is already chosen calls onSelect as
   * well: a sheet that closes on a choice closes on that tap too. Without it
   * the tap does nothing, so a choice that loads or sends is never repeated.
   */
  radio?: { checked: boolean; onSelect: () => void; reselect?: boolean }
  /**
   * A second, separate target at the end, for example the "More" button of a
   * chat row. The row then has two buttons of 44 px each, never one inside the other.
   */
  trailing?: ReactNode
  /** Static content at the end, inside the row's own target (a badge, a time). */
  end?: ReactNode
  disabled?: boolean
  /** Why it is disabled. Shown as the second line: a disabled row is never just grey. */
  disabledReason?: string
  danger?: boolean
  /** Accessible name when the visible text is not enough ("More for Trip plan"). */
  label?: string
}

/** A list row, at least 52 px high. Text wraps, nothing is cut off. */
export function Row(props: RowProps) {
  const { title, subtitle, icon, value, onPress, chevron, switch: sw, radio, trailing, end, disabled, disabledReason, danger, label, id, state, risk } = props
  const second = disabled && disabledReason ? disabledReason : subtitle
  const showChevron = chevron ?? (!!onPress && !sw && !radio && !end)
  const body = (
    <>
      {icon ? <Icon icon={icon} /> : null}
      <span className="m-row-text">
        <span className="m-row-title">{hyphenated(title)}</span>
        {second ? <span className="m-row-sub">{second}</span> : null}
      </span>
      {value || end || sw || radio || showChevron ? (
        <span className="m-row-end">
          {value ? <span className="m-row-val">{value}</span> : null}
          {end}
          {sw ? <SwitchTrack tone={sw.tone} /> : null}
          {radio ? <span className="m-radio" aria-hidden="true" /> : null}
          {showChevron ? <Icon icon={ChevronRight} small className="m-row-chev" /> : null}
        </span>
      ) : null}
    </>
  )
  const className = cx('m-row', danger && 'm-row--danger')
  const interactive = !!(onPress || sw || radio)
  const marks = { 'data-m-id': id, 'data-state': state, ...riskProps(risk) }

  let row: ReactNode
  if (!interactive) {
    row = (
      <div className={className} aria-disabled={disabled || undefined} {...marks} {...testProps(props)}>
        {body}
      </div>
    )
  } else {
    const role = sw ? 'switch' : radio ? 'radio' : undefined
    const checked = sw ? sw.checked : radio ? radio.checked : undefined
    row = (
      <button
        type="button"
        role={role}
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={className}
        onClick={() => {
          if (sw) {
            haptic('light')
            sw.onChange(!sw.checked)
          } else if (radio) {
            if (!radio.checked || radio.reselect) radio.onSelect()
          } else {
            onPress?.()
          }
        }}
        {...marks}
        {...testProps(props)}
      >
        {body}
      </button>
    )
  }
  if (!trailing) return row
  return (
    <div className="m-rowwrap">
      {row}
      {trailing}
    </div>
  )
}

export interface CardProps extends Testable {
  title?: string
  children?: ReactNode
}

/** A card: surface, 14 px radius. No border and no shadow in the dark theme, a hairline in the light one. */
export function Card(props: CardProps) {
  return (
    <div className="m-card" {...testProps(props)}>
      {props.title ? <h3 className="m-card-title">{hyphenated(props.title)}</h3> : null}
      {props.children}
    </div>
  )
}

/** A small mark on a model row or card ("Vision", "No Filter"). */
export function Tag({ children, accent }: { children: ReactNode; accent?: boolean }) {
  return <span className={cx('m-tag', accent && 'm-tag--accent')}>{children}</span>
}

/**
 * The one Beta mark of the app on the phone: the word in a hairline frame, no
 * colour. Word and list are the desktop's (lib/beta.ts); a feature that has
 * left the list draws nothing. The sentence a desktop shows on hover is what
 * a screen reader reads here.
 */
export function BetaTag({ feature }: { feature: BetaFeature }) {
  const note = betaNote(feature)
  if (!note) return null
  return (
    <span className="m-beta" data-testid="m-beta" data-m-beta={feature} aria-label={note}>
      {BETA_LABEL}
    </span>
  )
}
