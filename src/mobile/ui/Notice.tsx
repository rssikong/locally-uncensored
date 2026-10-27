import type { ReactNode } from 'react'
import { AlertTriangle, CircleAlert, Info, WifiOff } from 'lucide-react'
import { cx, testProps, type Testable } from './common'
import { hyphenated } from './hyphenate'
import { Icon, type IconType } from './Icon'

export interface NoticeProps extends Testable {
  /** What happened, in a few words. */
  title?: string
  /** One or two sentences: what it means and what is saved. */
  children: ReactNode
  variant?: 'info' | 'warn' | 'error'
  icon?: IconType
  /** Up to two buttons: the next step and the way out. */
  actions?: ReactNode
}

const ICONS = { info: Info, warn: AlertTriangle, error: CircleAlert } as const

/**
 * A box with icon, title, one or two sentences and up to two buttons.
 * The pattern of every error case in DESIGN.md section 5: cause, effect,
 * next step. Errors are announced (role alert), the rest is a status.
 */
export function Notice(props: NoticeProps) {
  const { title, children, variant = 'info', icon, actions } = props
  return (
    <div className={cx('m-note', variant !== 'info' && `m-note--${variant}`)} role={variant === 'error' ? 'alert' : 'status'} {...testProps(props)}>
      <Icon icon={icon ?? ICONS[variant]} small />
      <div className="m-grow">
        {title ? <strong className="m-note-title">{hyphenated(title)}</strong> : null}
        <div>{children}</div>
        {actions ? <div className="m-note-actions">{actions}</div> : null}
      </div>
    </div>
  )
}

/** The full page version of Notice: a screen could not show its content. In the middle of the free area, like an EmptyState. */
export function ErrorState(props: NoticeProps) {
  return (
    <div className="m-empty" role="alert" data-m-sparse="" {...testProps(props)}>
      <Icon icon={props.icon ?? CircleAlert} />
      {props.title ? <h2 className="m-empty-title">{hyphenated(props.title)}</h2> : null}
      <p>{props.children}</p>
      {props.actions ? <div className="m-empty-actions">{props.actions}</div> : null}
    </div>
  )
}

export interface BannerAction extends Testable {
  label: string
  onPress: () => void
}

export interface BannerProps extends Testable {
  children: ReactNode
  variant?: 'info' | 'warn' | 'error'
  icon?: IconType
  /** One button at the end: the next step ("Load again"). */
  action?: BannerAction
  /** Up to two buttons: the next step and the way out ("Open chat", "Dismiss"). They move under the text when the line is full. */
  actions?: readonly BannerAction[]
}

/** Pure: the buttons a banner draws, `action` first, never more than two. */
export function bannerActions(action: BannerAction | undefined, actions: readonly BannerAction[] | undefined): BannerAction[] {
  return [...(action ? [action] : []), ...(actions ?? [])].slice(0, 2)
}

/** A slim line under the header (G7 offline, G8 after a return, G10 engine notices). */
export function Banner(props: BannerProps) {
  const { children, variant = 'info', icon, action, actions } = props
  const buttons = bannerActions(action, actions)
  return (
    <div className={cx('m-banner', variant !== 'info' && `m-banner--${variant}`)} role="status" {...testProps(props)}>
      <Icon icon={icon ?? (variant === 'info' ? Info : AlertTriangle)} small />
      <span className="m-grow">{children}</span>
      {buttons.length > 0 ? (
        <span className="m-banner-actions">
          {buttons.map((button) => (
            <button key={button.label} type="button" className="m-banner-action" onClick={button.onPress} {...testProps(button)}>
              {button.label}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  )
}

export const OfflineIcon = WifiOff
