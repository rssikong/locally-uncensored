/**
 * The device test hook LU_E2E_REMOTE_APPROVALS=ask, the window's half
 * (lib/remote-e2e-approvals.ts): shell and file writes ask in Agent and Code.
 */
import { describe, it, expect } from 'vitest'
import { askBeforeTools } from '../remote-e2e-approvals'
import { usePermissionStore } from '../../stores/permissionStore'
import { useCodexStore } from '../../stores/codexStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { resolveApprovalLevel } from '../agent-approval-policy'

describe('the desktop asks before tools in a device test', () => {
  it('turns shell and file writes to ask, also against earlier choices', async () => {
    const perm = usePermissionStore.getState()
    perm.setGlobalPermission('terminal', 'auto')
    perm.setGlobalPermission('filesystem', 'auto')
    perm.setToolOverride('shell_execute', 'auto')
    perm.setConversationOverride('c1', 'terminal', 'auto')
    perm.setConversationOverride('c1', 'web', 'auto')
    useCodexStore.setState({ lastPickedMode: 'bypass', modeByConversation: { k1: 'bypass', k2: 'plan' } })

    askBeforeTools()
    await Promise.resolve()

    const p = usePermissionStore.getState()
    expect(p.globalPermissions.terminal).toBe('confirm')
    expect(p.globalPermissions.filesystem).toBe('confirm')
    expect(p.perToolOverrides.shell_execute).toBeUndefined()
    expect(p.conversationOverrides.c1).toEqual({ web: 'auto' })
    const level = resolveApprovalLevel('shell_execute', {
      categoryLevel: p.getEffectivePermissions('c1').terminal, override: p.perToolOverrides.shell_execute, codexMode: null, readOnlyRun: false,
    })
    expect(level).toBe('confirm')
    expect(useCodexStore.getState().lastPickedMode).toBe('ask')
    expect(useCodexStore.getState().modeByConversation).toEqual({ k1: 'ask', k2: 'plan' })
    expect(useSettingsStore.getState().settings.codexDefaultMode).toBe('ask')
  })
})
