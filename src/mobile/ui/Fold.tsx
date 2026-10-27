import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { testProps, type Testable } from './common'
import { Icon, type IconType } from './Icon'

export interface FoldProps extends Testable {
  /** Visible title of the header. */
  title: ReactNode
  /** A second line under the title. */
  sub?: ReactNode
  /** Mono text at the end of the header (a duration, a count). */
  meta?: string
  icon?: IconType
  /** Accessible name when the visible title is not enough, and the name of the body when the title is not a text. */
  label?: string
  /** Colours the icon: "done" green, "failed" and "denied" red. Written as data-state. */
  state?: string
  defaultOpen?: boolean
  /** Hand in both to hold the state outside (a block that opens when a run fails). */
  open?: boolean
  onToggle?: (open: boolean) => void
  /** A second, separate target next to the header ("Remove"). Never inside the header button. */
  trailing?: ReactNode
  /** The body. As a function it is only built while the block is open. */
  children: ReactNode | (() => ReactNode)
}

/**
 * A block that opens and closes: a thinking block, a tool line, an advanced
 * section of a settings page. The header is one 44 px target with
 * aria-expanded; the body is a region named by the header.
 */
export function Fold(props: FoldProps) {
  const { title, sub, meta, icon, label, state, defaultOpen = false, open: held, onToggle, trailing, children } = props
  const [own, setOwn] = useState(defaultOpen)
  const open = held ?? own
  const id = useId()
  const toggle = () => {
    if (held === undefined) setOwn(!open)
    onToggle?.(!open)
  }
  return (
    <div className="m-fold" data-state={state} data-open={open ? '' : undefined}>
      <div className="m-fold-top">
        <button type="button" className="m-fold-head" aria-expanded={open} aria-controls={id} aria-label={label} onClick={toggle} {...testProps(props)}>
          {icon ? <Icon icon={icon} small /> : null}
          <span className="m-fold-title">
            {title}
            {sub ? <small>{sub}</small> : null}
          </span>
          {meta ? <span className="m-fold-meta">{meta}</span> : null}
          <Icon icon={ChevronDown} small className="m-fold-chev" />
        </button>
        {trailing}
      </div>
      {open ? (
        <div className="m-fold-body" id={id} role="region" aria-label={typeof title === 'string' ? title : label}>
          {typeof children === 'function' ? children() : children}
        </div>
      ) : null}
    </div>
  )
}
