/**
 * The mark "Direct" (switch directBadge, policy/unfiltered.ts): a small tag
 * at a LU Cloud model that is named, on the server, by a word a store build
 * does not show. A tap on it shows the one sentence that says what the mark
 * means.
 *
 * A target of its own, 44 px, never inside the row it stands at: in a list
 * it goes into the slot `trailing` of the row. `compact` writes "D" where
 * there is no room for the word (the head of the chat); a screen reader
 * hears "Direct" either way.
 */
import { toast } from '../ui/Toast'
import { DIRECT_MARK, DIRECT_MARK_SHORT, DIRECT_SENTENCE } from './unfiltered'

export function DirectMark({ compact, testid = 'm-direct-mark' }: { compact?: boolean; testid?: string }) {
  return (
    <button
      type="button"
      className="m-direct"
      aria-label={DIRECT_MARK}
      data-testid={testid}
      onClick={(event) => {
        event.stopPropagation()
        toast(DIRECT_SENTENCE, { testid: 'direct-mark' })
      }}
    >
      <span className="m-tag" aria-hidden="true">
        {compact ? DIRECT_MARK_SHORT : DIRECT_MARK}
      </span>
    </button>
  )
}
