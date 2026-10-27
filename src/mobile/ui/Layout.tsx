/**
 * The wrappers a page is laid out with. The shell has classes for the gutter
 * (.m-pad) and for a vertical stack (.m-stackv); these add the gap between
 * two such blocks and the text sizes of an explaining line, so no screen
 * writes a style attribute for them.
 */
import type { ReactNode } from 'react'
import { cx, testProps, type Testable } from './common'

export interface BlockProps extends Testable {
  children: ReactNode
  /** The first block of a page: room above it. */
  lead?: boolean
  className?: string
}

/** A padded vertical stack: buttons, fields, a paragraph. */
export function Block(props: BlockProps) {
  return (
    <div className={cx('m-pad', 'm-stackv', 'm-block', props.lead && 'm-block--lead', props.className)} {...testProps(props)}>
      {props.children}
    </div>
  )
}

/** A paragraph in the caption size, for the one or two sentences that explain a group. `strong` takes the size of the text around it. */
export function Hint(props: { children: ReactNode; strong?: boolean } & Testable) {
  return (
    <p className={cx('m-hint', props.strong && 'm-hint--strong')} {...testProps(props)}>
      {props.children}
    </p>
  )
}

/** A heading inside a text page (Privacy, Licenses). */
export function Heading(props: { children: ReactNode } & Testable) {
  return (
    <h2 className="m-heading" {...testProps(props)}>
      {props.children}
    </h2>
  )
}

export interface StripProps extends Testable {
  children: ReactNode
  /** Accessible name of the row ("Recent results"). */
  label: string
  /** No gutter at the sides, for a strip inside a card that has its own padding. */
  flush?: boolean
  /** list when the children are entries of a list, default group. */
  role?: 'group' | 'list'
}

/**
 * A row that scrolls sideways: thumbnails, tool chips, recent results. It
 * starts 16 px from the edge, so it never meets the back swipe, and its
 * children keep their size. The layout check of the tests lets what is
 * inside stick out (data-m-scroll-x).
 */
export function Strip(props: StripProps) {
  const { children, label, flush, role = 'group' } = props
  return (
    <div className={cx('m-strip', flush && 'm-strip--flush')} role={role} aria-label={label} data-m-scroll-x="" {...testProps(props)}>
      {children}
    </div>
  )
}

/**
 * Little content, in the middle of the free area of the page: a hint with one action, a form of one
 * field, a line that says what is going on. An EmptyState does this on its own; this is for content
 * that is not one. When it is higher than the room it starts at the top and the page scrolls
 * (styles/components.css, "Little content stands in the middle"). Lists and forms of settings do
 * not use it: they start at the top.
 */
export function Sparse(props: { children: ReactNode; className?: string } & Testable) {
  return (
    <div className={props.className} data-m-sparse="" {...testProps(props)}>
      {props.children}
    </div>
  )
}
