import type { ReactNode } from 'react'
import { haptic } from '../platform/haptics'
import { cx, testProps, type Testable } from './common'

export interface SwitchProps extends Testable {
  checked: boolean
  onChange: (next: boolean) => void
  /** Required accessible name. Usually the visible text next to it. */
  label: string
  /** Visible text. Leave it out when the switch sits in a Row that already shows the text. */
  children?: ReactNode
  /** cloud paints the on state in cloud violet (the Cloud switch, G11). */
  tone?: 'accent' | 'cloud'
  /** A bordered pill, as the Cloud switch in the header of a root. */
  pill?: boolean
  disabled?: boolean
}

/** The bare 51 by 31 px track. Row draws it inside its own button. */
export function SwitchTrack({ tone = 'accent' }: { tone?: 'accent' | 'cloud' }) {
  return <span className={cx('m-sw', tone === 'cloud' && 'm-sw--cloud')} aria-hidden="true" />
}

/** A switch with its own 44 px target. It acts at once, there is no save button. */
export function Switch(props: SwitchProps) {
  const { checked, onChange, label, children, tone = 'accent', pill, disabled } = props
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className={cx('m-switch', pill && 'm-switch--pill', tone === 'cloud' && 'm-switch--cloud')}
      onClick={() => {
        haptic('light')
        onChange(!checked)
      }}
      {...testProps(props)}
    >
      {children}
      <SwitchTrack tone={tone} />
    </button>
  )
}
