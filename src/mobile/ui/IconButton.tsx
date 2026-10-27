import { cx, riskProps, testProps, type RiskMarked, type Testable } from './common'
import { Icon, type IconType } from './Icon'

export interface IconButtonProps extends Testable, RiskMarked {
  icon: IconType
  /** Required: the accessible name in words ("Back", "Chat menu"). A symbol is not a name. */
  label: string
  onPress?: () => void
  /** A counter on the button. Its number goes into the name: "Downloads, 1 active". */
  count?: number
  /** Words for the counter, default "active". */
  countWord?: string
  disabled?: boolean
  /** A thin border, for plus and minus next to a number. */
  edged?: boolean
  pressed?: boolean
}

export function iconButtonName(label: string, count?: number, countWord = 'active'): string {
  return count && count > 0 ? `${label}, ${count} ${countWord}` : label
}

export function IconButton(props: IconButtonProps) {
  const { icon, label, onPress, count, countWord, disabled, edged, pressed, risk } = props
  return (
    <button
      type="button"
      className={cx('m-ib', edged && 'm-ib--edge')}
      aria-label={iconButtonName(label, count, countWord)}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onPress}
      {...riskProps(risk)}
      {...testProps(props)}
    >
      <Icon icon={icon} />
      {count && count > 0 ? (
        <span className="m-ib-dot" aria-hidden="true">
          {count > 99 ? '99' : count}
        </span>
      ) : null}
    </button>
  )
}
