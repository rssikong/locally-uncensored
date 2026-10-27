/**
 * @vitest-environment jsdom
 *
 * A37 (26.10.2026), checked on the Agent surface after xxcoder's report that
 * the Code tab ran without asking while it showed Ask.
 *
 * The per-chat category rows say only on or off. Switching a row back on wrote
 * 'auto', so Shell, which the Settings keep on "asks first", came back as
 * "runs unattended" after one off-and-on, and the row looked the same as
 * before. On now restores the Settings level; a category the Settings block
 * comes back asking.
 *
 * Run: npx vitest run src/components/chat/__tests__/agent-category-off-and-on-keeps-asking.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

vi.mock('../../../hooks/useToolSupport', () => ({
  useToolSupport: () => ({ canUseTools: true, reason: '' }),
}))

const { PermissionOverrideBar, levelWhenSwitchedOn } = await import('../PermissionOverrideBar')
const { usePermissionStore } = await import('../../../stores/permissionStore')
const { useChatStore } = await import('../../../stores/chatStore')

beforeEach(() => {
  usePermissionStore.getState().resetToDefaults()
  useChatStore.setState({ activeConversationId: 'agent-1' })
})

afterEach(() => cleanup())

describe('a category switched off and on again in one chat', () => {
  it('Shell asks again, as the Settings say, instead of running unattended', () => {
    expect(usePermissionStore.getState().globalPermissions.terminal).toBe('confirm')
    render(createElement(PermissionOverrideBar))
    fireEvent.click(screen.getByText('Shell'))
    expect(usePermissionStore.getState().getEffectivePermissions('agent-1').terminal).toBe('blocked')
    fireEvent.click(screen.getByText('Shell'))
    expect(usePermissionStore.getState().getEffectivePermissions('agent-1').terminal).toBe('confirm')
  })

  it('a category the Settings run unattended comes back unattended', () => {
    usePermissionStore.getState().setGlobalPermission('web', 'auto')
    render(createElement(PermissionOverrideBar))
    fireEvent.click(screen.getByText('Web'))
    fireEvent.click(screen.getByText('Web'))
    expect(usePermissionStore.getState().getEffectivePermissions('agent-1').web).toBe('auto')
  })

  it('a category the Settings block comes back asking, never unattended', () => {
    expect(levelWhenSwitchedOn('blocked')).toBe('confirm')
    expect(levelWhenSwitchedOn(undefined)).toBe('confirm')
  })
})
