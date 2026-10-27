import type { PermissionLevel } from '../../../../api/mcp/types'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { Segmented } from '../../../ui'
import { LEVELS, LEVEL_TEXT, type PermissionGroup } from './permission-groups'

export interface PermissionRowProps {
  group: PermissionGroup
  level: PermissionLevel
  onChange: (level: PermissionLevel) => void
  /** Prefix of the data-testid: <prefix>-<group id>, the options get <prefix>-<group id>-<level>. */
  idPrefix: string
  el: string
  /** A line under the hint, for example "Changed for this chat". */
  note?: string
  /** Why the group cannot be used right now. Replaces the hint and locks the three levels: a locked row is never just grey. */
  lockedReason?: string
}

/** One tool group with its three levels: Blocked, Ask, Auto (E8.1, C5.14). */
export function PermissionRow({ group, level, onChange, idPrefix, el, note, lockedReason }: PermissionRowProps) {
  return (
    <div className="m-ag-seg-row" data-testid={`${idPrefix}-${group.id}-row`} data-locked={lockedReason ? '' : undefined}>
      <span className="m-ag-seg-title">{group.title}</span>
      <span className="m-ag-seg-sub">
        {lockedReason ?? group.hint}
        {note && !lockedReason ? ` ${note}` : ''}
      </span>
      <Segmented
        label={T.permissions.levelOf(group.title)}
        value={level}
        onChange={onChange}
        options={LEVELS.map((value) => ({ value, label: LEVEL_TEXT[value], disabled: !!lockedReason, testid: `${idPrefix}-${group.id}-${value}` }))}
        testid={`${idPrefix}-${group.id}`}
        el={el}
      />
    </div>
  )
}
