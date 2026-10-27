import { cx, testProps, type Testable } from './common'

/** A name shorter than this is never split: it fits or it is cut at the end like any text. */
export const MIDDLE_MIN_CHARS = 12
/** The longest ending that still counts as a file ending (".jpeg", ".safetensors" does not). */
const ENDING_MAX_CHARS = 6
/** Characters kept in front of the ending, so "report (2).pdf" keeps "2).pdf". */
const KEEP_BEFORE_ENDING = 3

/**
 * Pure: where a name is cut when it does not fit. The tail always stays on
 * screen: the file ending with the last characters of the name before it, or
 * the last characters when there is no ending.
 */
export function splitMiddle(text: string): { head: string; tail: string } {
  if (text.length < MIDDLE_MIN_CHARS) return { head: text, tail: '' }
  const dot = text.lastIndexOf('.')
  const ending = dot > 0 && text.length - dot <= ENDING_MAX_CHARS ? text.length - dot : 0
  const tail = Math.min(text.length - 1, ending + KEEP_BEFORE_ENDING + (ending ? 0 : 3))
  return { head: text.slice(0, text.length - tail), tail: text.slice(text.length - tail) }
}

export interface MiddleEllipsisProps extends Testable {
  /** The whole name. It stays the text of the element, only the drawing leaves the middle out. */
  text: string
  className?: string
}

/**
 * One line that leaves out the middle when it does not fit: "beach-holid….png".
 * For file names, where the ending says more than the middle. The element
 * still holds the whole name as its text, for screen readers and for tests.
 */
export function MiddleEllipsis(props: MiddleEllipsisProps) {
  const { head, tail } = splitMiddle(props.text)
  return (
    <span className={cx('m-mid', props.className)} {...testProps(props)}>
      <span className="m-mid-head">{head}</span>
      {tail ? <span className="m-mid-tail">{tail}</span> : null}
    </span>
  )
}
