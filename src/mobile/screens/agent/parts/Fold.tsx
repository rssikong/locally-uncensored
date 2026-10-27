import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Icon, testProps, type IconType, type Testable } from '../../../ui'

export interface FoldProps extends Testable {
  /** Visible title of the header. */
  title: ReactNode
  /** A second line under the title. */
  sub?: ReactNode
  /** Mono text at the end of the header (a duration, a count). */
  meta?: string
  icon?: IconType
  /** Accessible name when the visible title is not enough. */
  label?: string
  /** Colours the icon: done green, failed and denied red. */
  state?: string
  defaultOpen?: boolean
  /** A second, separate target next to the header ("Remove"). Never inside the header button. */
  trailing?: ReactNode
  /** The body is only built while the block is open. */
  children: () => ReactNode
}

/**
 * A block that opens and closes: the thinking block, a tool line, the band
 * of several steps, the compaction block. The header is one 44 px target
 * with aria-expanded; the body is a region named by the header.
 */
export function Fold(props: FoldProps) {
  const { title, sub, meta, icon, label, state, defaultOpen = false, trailing, children } = props
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <div className="m-ag-fold" data-state={state} data-open={open ? '' : undefined}>
      <div className="m-ag-fold-top">
        <button type="button" className="m-ag-fold-head" aria-expanded={open} aria-controls={id} aria-label={label} onClick={() => setOpen((o) => !o)} {...testProps(props)}>
          {icon ? <Icon icon={icon} small /> : null}
          <span className="m-ag-fold-title">
            {title}
            {sub ? <small>{sub}</small> : null}
          </span>
          {meta ? <span className="m-ag-fold-meta">{meta}</span> : null}
          <Icon icon={ChevronDown} small className="m-ag-fold-chev" />
        </button>
        {trailing}
      </div>
      {open ? (
        <div className="m-ag-fold-body" id={id} role="region" aria-label={typeof title === 'string' ? title : label}>
          {children()}
        </div>
      ) : null}
    </div>
  )
}
