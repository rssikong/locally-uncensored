import type { ReactNode } from 'react'
import { testProps, type Testable } from './common'
import { hyphenated } from './hyphenate'
import { Icon, Monogram, type IconType } from './Icon'

export interface EmptyStateProps extends Testable {
  title: string
  /** One sentence. */
  children?: ReactNode
  /** An icon, or leave it out for the LU monogram. */
  icon?: IconType
  /** Up to two buttons. */
  actions?: ReactNode
}

/**
 * What a list or a search shows when there is nothing: mark, title, one sentence, up to two buttons.
 * It stands in the middle of the free area of its page (data-m-sparse; styles/components.css, "Little
 * content stands in the middle") and starts at the top where it is higher than the room.
 */
export function EmptyState(props: EmptyStateProps) {
  const { title, children, icon, actions } = props
  return (
    <div className="m-empty" data-m-sparse="" {...testProps(props)}>
      {icon ? <Icon icon={icon} /> : <Monogram size={56} className="m-empty-mark" />}
      <h2 className="m-empty-title">{hyphenated(title)}</h2>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="m-empty-actions">{actions}</div> : null}
    </div>
  )
}
