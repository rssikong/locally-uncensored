/**
 * Device tests only (LU_E2E_REMOTE_APPROVALS=ask, src-tauri/src/e2e_remote.rs):
 * the desktop asks before shell commands and file writes, in Agent and in
 * Code, so a test can answer the approval on the phone. Reached only when a
 * build with the feature `e2e-remote` says so (lib/remote-e2e.ts).
 */
import type { PermissionLevel, ToolCategory } from '../api/mcp/types'
import { usePermissionStore } from '../stores/permissionStore'
import { useCodexStore } from '../stores/codexStore'
import { useSettingsStore } from '../stores/settingsStore'

const ASKED: ToolCategory[] = ['terminal', 'filesystem']
const ASKED_TOOLS = ['shell_execute', 'file_write', 'file_edit']

export function askBeforeTools(): void {
  const perm = usePermissionStore.getState()
  for (const c of ASKED) perm.setGlobalPermission(c, 'confirm')
  for (const t of ASKED_TOOLS) if (perm.perToolOverrides[t]) perm.clearToolOverride(t)
  // "Always for this chat" from an earlier run would answer for the phone.
  usePermissionStore.setState((s) => ({
    conversationOverrides: Object.fromEntries(
      Object.entries(s.conversationOverrides).map(([id, o]) => [
        id,
        Object.fromEntries(Object.entries(o).filter(([c]) => !ASKED.includes(c as ToolCategory))) as Partial<Record<ToolCategory, PermissionLevel>>,
      ]),
    ),
  }))
  // Code: the preset Ask, for new chats and for those set to Bypass.
  void useSettingsStore.getState().updateSettings({ codexDefaultMode: 'ask', codexConfirmShell: true })
  useCodexStore.setState((s) => ({
    lastPickedMode: s.lastPickedMode && s.lastPickedMode !== 'bypass' ? s.lastPickedMode : 'ask',
    modeByConversation: Object.fromEntries(Object.entries(s.modeByConversation).map(([id, m]) => [id, m === 'bypass' ? 'ask' : m])),
  }))
}
