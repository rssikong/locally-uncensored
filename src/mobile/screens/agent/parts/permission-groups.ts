/**
 * The permission groups a phone shows (E8.1, C5.14).
 *
 * DESIGN.md lists five: Web, Files in chat, Memory, Workflows, Sub agents.
 * The permission store knows tool CATEGORIES (web, filesystem, workflow,
 * system, and four more that have no tools on a phone) plus an override per
 * tool name. So:
 *
 *   web        category web          (web_search, web_fetch)
 *   files      category filesystem   (file_read, file_write, file_edit, file_list, file_search)
 *   workflows  category workflow     (run_workflow)
 *   subagents  tool delegate_task    (its category "system" also holds the plan and the task
 *                                     list, which must not be blocked along with it)
 *
 * Memory has no tool: memories are written by a hook after the answer and by
 * a workflow step, neither asks the permission store. It is shown as a row
 * that leads to the Memory page instead of a switch that would do nothing
 * (wish in mobile-docs/geruest-wuensche/agent.md).
 *
 * Terminal, Desktop, Image and Video do not exist on a phone and are never
 * shown; their categories start blocked (lib/mobile-tools.ts).
 */
import type { PermissionLevel, PermissionMap, ToolCategory } from '../../../../api/mcp/types'
import { usePermissionStore } from '../../../../stores/permissionStore'
import { AGENT_STRINGS as T } from '../../../strings/agent'

export type PermissionGroupId = 'web' | 'files' | 'workflows' | 'subagents'

export interface PermissionGroup {
  id: PermissionGroupId
  title: string
  hint: string
  /** The category the level is stored on, or null when the group is one tool. */
  category: ToolCategory | null
  /** The tool the level is stored on when there is no category of its own. */
  tool: string | null
  /** Can a single chat have its own level? Tool overrides are app wide. */
  perChat: boolean
}

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  { id: 'web', title: T.permissions.groups.web, hint: T.permissions.hints.web, category: 'web', tool: null, perChat: true },
  { id: 'files', title: T.permissions.groups.files, hint: T.permissions.hints.files, category: 'filesystem', tool: null, perChat: true },
  { id: 'workflows', title: T.permissions.groups.workflows, hint: T.permissions.hints.workflows, category: 'workflow', tool: null, perChat: true },
  { id: 'subagents', title: T.permissions.groups.subagents, hint: T.permissions.hints.subagents, category: null, tool: 'delegate_task', perChat: false },
]

export const LEVELS: readonly PermissionLevel[] = ['blocked', 'confirm', 'auto']

export const LEVEL_TEXT: Record<PermissionLevel, string> = {
  blocked: T.permissions.blocked,
  confirm: T.permissions.ask,
  auto: T.permissions.auto,
}

export function groupById(id: PermissionGroupId): PermissionGroup {
  const found = PERMISSION_GROUPS.find((g) => g.id === id)
  if (!found) throw new Error(`unknown permission group ${id}`)
  return found
}

/** Pure: the level of a group, from the maps of the store. */
export function levelOf(
  group: PermissionGroup,
  global: PermissionMap,
  perTool: Readonly<Record<string, PermissionLevel>>,
  chatOverrides?: Partial<PermissionMap>,
): PermissionLevel {
  if (group.category) return chatOverrides?.[group.category] ?? global[group.category]
  // One tool: its own override, else the level of the category it lives in.
  return (group.tool ? perTool[group.tool] : undefined) ?? global.system
}

/**
 * Pure: the levels of a chat that differ from what the app has set.
 *
 * "Changed for this chat" means different from the default, not "touched
 * once". A level that was moved and moved back said "Changed" until round 16,
 * because the note asked whether an entry exists (acceptance android-4gb,
 * F12). An entry equal to the default is no change.
 */
export function differingLevels(chatOverrides: Partial<PermissionMap> | undefined, global: PermissionMap): Partial<PermissionMap> {
  const out: Partial<PermissionMap> = {}
  for (const [category, level] of Object.entries(chatOverrides ?? {}) as Array<[keyof PermissionMap, PermissionLevel | undefined]>) {
    if (level !== undefined && level !== global[category]) out[category] = level
  }
  return out
}

/** Pure: does this chat differ from the app in any level? */
export function chatDiffers(chatOverrides: Partial<PermissionMap> | undefined, global: PermissionMap): boolean {
  return Object.keys(differingLevels(chatOverrides, global)).length > 0
}

/** Pure: does this chat have a level of its own for the group, one that differs from the level of the app? */
export function hasChatLevel(group: PermissionGroup, chatOverrides: Partial<PermissionMap> | undefined, global: PermissionMap): boolean {
  if (!group.category) return false
  const own = chatOverrides?.[group.category]
  return own !== undefined && own !== global[group.category]
}

/** Set the app wide level of a group. */
export function setAppLevel(group: PermissionGroup, level: PermissionLevel): void {
  const store = usePermissionStore.getState()
  if (group.category) store.setGlobalPermission(group.category, level)
  else if (group.tool) store.setToolOverride(group.tool, level)
}

/** Set the level of a group for one chat. False when the group cannot differ per chat. */
export function setChatLevel(chatId: string, group: PermissionGroup, level: PermissionLevel): boolean {
  if (!group.category || !group.perChat) return false
  const store = usePermissionStore.getState()
  if (level !== store.globalPermissions[group.category]) {
    store.setConversationOverride(chatId, group.category, level)
    return true
  }
  // Back on the level of the app: the chat has no level of its own for this group any more. The entry goes, so
  // the chat follows the app again when the app changes, and nothing says "changed" about a chat that is not.
  const rest = { ...(store.conversationOverrides[chatId] ?? {}) }
  if (!(group.category in rest)) return true
  delete rest[group.category]
  store.clearConversationOverrides(chatId)
  for (const [category, kept] of Object.entries(rest) as Array<[keyof PermissionMap, PermissionLevel | undefined]>) {
    if (kept !== undefined) usePermissionStore.getState().setConversationOverride(chatId, category, kept)
  }
  return true
}
