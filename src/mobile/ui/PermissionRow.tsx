import type { PermissionLevel } from '../../api/mcp/types'
import { COMMON } from '../strings/common'
import type { Testable } from './common'
import { hyphenated } from './hyphenate'
import { Segmented, type SegmentOption } from './Segmented'

/** The three levels a tool group can have, in the words the phone shows. */
export const PERMISSION_LEVELS: ReadonlyArray<{ value: PermissionLevel; label: string }> = [
  { value: 'blocked', label: COMMON.permissionBlocked },
  { value: 'confirm', label: COMMON.permissionAsk },
  { value: 'auto', label: COMMON.permissionAuto },
]

export interface PermissionRowProps<V extends string = PermissionLevel> extends Testable {
  /** What the levels are for ("Web"). */
  title: string
  /** One sentence under the title: what the group may do. */
  hint?: string
  /** A line after the hint, for example "Changed for this chat". */
  note?: string
  value: V
  onChange: (value: V) => void
  /** Other choices than Blocked, Ask, Auto. Two to four. */
  options?: ReadonlyArray<{ value: V; label: string; disabled?: boolean }>
  /** Accessible name of the choice, default "Permission for <title>". */
  label?: string
}

/** Pure: the options of the segment with their data-testids, <testid>-<value>. */
export function permissionOptions<V extends string>(options: ReadonlyArray<{ value: V; label: string; disabled?: boolean }>, testid: string | undefined): SegmentOption<V>[] {
  return options.map((option) => ({ ...option, testid: testid ? `${testid}-${option.value}` : undefined }))
}

/**
 * A title, a sentence and a choice of levels under them (E8.1, C5.14).
 * `testid` goes to the choice, the row itself carries <testid>-row and each
 * level <testid>-<level>.
 */
export function PermissionRow<V extends string = PermissionLevel>(props: PermissionRowProps<V>) {
  const { title, hint, note, value, onChange, label, testid, el } = props
  const options = props.options ?? (PERMISSION_LEVELS as unknown as ReadonlyArray<{ value: V; label: string }>)
  return (
    <div className="m-perm" data-testid={testid ? `${testid}-row` : undefined}>
      <span className="m-perm-title">{hyphenated(title)}</span>
      {hint || note ? (
        <span className="m-perm-sub">
          {hint}
          {hint && note ? ' ' : ''}
          {note}
        </span>
      ) : null}
      <Segmented label={label ?? COMMON.permissionFor(title)} value={value} onChange={onChange} options={permissionOptions(options, testid)} testid={testid} el={el} />
    </div>
  )
}
