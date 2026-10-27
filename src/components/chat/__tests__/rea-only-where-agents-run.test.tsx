// @vitest-environment jsdom
/**
 * REA reaches Agent and Code only (3.0.8, A6). Its tools never went to plain
 * chat, so its row, its dot and its line under Plugins stay out of plain chat
 * too: a switch there promised tools the chat never gets.
 *
 * Run: npx vitest run src/components/chat/__tests__/rea-only-where-agents-run.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../../api/backend', async (orig) => ({ ...(await orig<typeof import('../../../api/backend')>()), isTauri: () => true }))

import { PluginsDropdown, reaInPlugins } from '../PluginsDropdown'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useChatStore } from '../../../stores/chatStore'
import { BUILT_IN_PERSONAS, DEFAULT_SETTINGS } from '../../../lib/constants'
import { CHAT_TOOLS } from '../../../lib/chat-tool-intent'
import { reaToolsFor } from '../../../lib/plugins/rea-tools'

beforeEach(() => {
  useSettingsStore.setState({
    settings: { ...DEFAULT_SETTINGS, appMode: 'local', reaPluginEnabled: true },
    personas: [...BUILT_IN_PERSONAS],
  })
  useChatStore.setState({ conversations: [], activeConversationId: null })
})
afterEach(() => cleanup())

describe('REA under Plugins', () => {
  it('is offered in the desktop app on an agent surface only', () => {
    expect(reaInPlugins(true, true)).toBe(true)
    expect(reaInPlugins(true, false)).toBe(false)
    expect(reaInPlugins(false, true)).toBe(false)
  })

  it('plain chat: no row and no dot, even with REA switched on', async () => {
    render(<PluginsDropdown openUpward />)
    expect(screen.queryByTestId('plugins-dot-rea')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Plugins/ }))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('plugins-rea')).toBeNull()
  })

  it('Agent on in chat: the row and the dot are there', async () => {
    render(<PluginsDropdown openUpward agentTools />)
    expect(screen.getByTestId('plugins-dot-rea')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Plugins/ }))
    expect(await screen.findByTestId('plugins-rea')).toBeTruthy()
  })

  it('Code: the row is there', async () => {
    render(<PluginsDropdown iconOnly agentTools />)
    fireEvent.click(screen.getByRole('button', { name: /Plugins/ }))
    expect(await screen.findByTestId('plugins-rea')).toBeTruthy()
  })

  it('the plain chat tool list holds no REA tool', () => {
    // Plain chat runs the loop on this list alone (hooks/useAgentChat.ts,
    // curatedTools), so no REA tool can come along there.
    const rea = reaToolsFor('take apart this electron app.exe', ['open_binary', 'binary_overview', 'analyze_javascript_application'])
    expect(rea.length).toBeGreaterThan(0)
    expect(rea.some((t) => (CHAT_TOOLS as readonly string[]).includes(t))).toBe(false)
  })
})
