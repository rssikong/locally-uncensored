/**
 * Two wrappers the pages of this strand share. The shell has classes for the
 * gutter (.m-pad) and for a vertical stack (.m-stackv); what is missing is
 * the gap between two such blocks, set here from the spacing tokens.
 */
import type { CSSProperties, ReactNode } from 'react'
import { cx, testProps, type Testable } from '../../../ui'

const BLOCK: CSSProperties = { marginBottom: 'var(--m-s4)', gap: 'var(--m-s3)' }
const LEAD: CSSProperties = { paddingTop: 'var(--m-s3)' }

/** A padded vertical stack: buttons, fields, a paragraph. */
export function Block(props: { children: ReactNode; lead?: boolean; className?: string } & Testable) {
  return (
    <div className={cx('m-pad', 'm-stackv', props.className)} style={props.lead ? { ...BLOCK, ...LEAD } : BLOCK} {...testProps(props)}>
      {props.children}
    </div>
  )
}

/** A paragraph in the caption size, for the one or two sentences that explain a group. */
export function Hint(props: { children: ReactNode; strong?: boolean } & Testable) {
  return (
    <p className={props.strong ? 'm-t2' : 'm-cap'} style={{ margin: 0, overflowWrap: 'anywhere' }} {...testProps(props)}>
      {props.children}
    </p>
  )
}

/** A heading inside a text page (Privacy). */
export function Heading({ children }: { children: ReactNode }) {
  return (
    <h2 style={{ margin: 0, fontSize: 'var(--m-text-title)', fontWeight: 600, lineHeight: 1.3, color: 'var(--m-t1)', overflowWrap: 'anywhere' }}>
      {children}
    </h2>
  )
}
