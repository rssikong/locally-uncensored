import { usePermissionStore } from '../../../../../stores/permissionStore'
import { nav } from '../../../../nav'
import { AGENT_STRINGS as T } from '../../../../strings/agent'
import { Button, ListGroup, Row, Sheet, toast } from '../../../../ui'
import { touchChat } from '../chat-ref'
import { chatDiffers, hasChatLevel, levelOf, PERMISSION_GROUPS, setChatLevel } from '../permission-groups'
import { PermissionRow } from '../PermissionRows'
import { useSubAgentsOffered } from '../sub-agents-here'

const S = T.options.permissionsPage

/** C5.14: one row per tool group with Blocked, Ask, Auto for this chat, and "Use app defaults". */
export function PermissionsPage({ chatKey }: { chatKey: string }) {
  const global = usePermissionStore((s) => s.globalPermissions)
  const perTool = usePermissionStore((s) => s.perToolOverrides)
  const overrides = usePermissionStore((s) => s.conversationOverrides[chatKey])
  // Different from the app, not "touched once": a level moved back to the default is no change (round 16, F12).
  const own = chatDiffers(overrides, global)
  // A model of this phone gets no sub agents, so the row does not point at a setting that is locked there.
  const subAgents = useSubAgentsOffered()
  return (
    <Sheet title={S.title}>
      <p className="m-ag-text">{S.text}</p>
      <div className="m-group" data-testid="m-options-permissions">
        {PERMISSION_GROUPS.filter((g) => g.perChat).map((group) => (
          <PermissionRow
            key={group.id}
            group={group}
            level={levelOf(group, global, perTool, overrides)}
            note={hasChatLevel(group, overrides, global) ? T.options.permissionsOwn : undefined}
            onChange={(level) => {
              touchChat(chatKey)
              setChatLevel(chatKey, group, level)
            }}
            idPrefix="m-options-perm"
            el="C5.14"
          />
        ))}
      </div>
      <p className="m-ag-text">{T.permissions.explain}</p>
      <div className="m-ag-actions">
        <Button
          block
          disabled={!own}
          onPress={() => {
            usePermissionStore.getState().clearConversationOverrides(chatKey)
            toast(S.defaultsDone, { testid: 'perm-defaults' })
          }}
          testid="m-options-perm-defaults"
          el="C5.14"
        >
          {S.useDefaults}
        </Button>
      </div>
      <ListGroup>
        <Row title={S.appSettings} subtitle={subAgents ? `${T.permissions.groups.subagents}: ${T.permissions.appWideOnly}` : S.appSettingsSub} onPress={() => nav.push('/settings/agent')} testid="m-options-perm-app" el="C5.14" />
      </ListGroup>
    </Sheet>
  )
}
