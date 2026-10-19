/**
 * @vitest-environment jsdom
 *
 * The REA row under Plugins (3.0.7): a switch that writes
 * settings.reaPluginEnabled (lib/plugins/rea-runtime follows it), and a line
 * for the step a start is at, an error in its own words, or, once it runs,
 * how many tools the agents got and what REA reads without extra programs.
 *
 * Run: npx vitest run src/components/chat/__tests__/plugins-menu-has-rea.test.tsx
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { ReaPluginRow, reaPhaseLine } from '../ReaPluginRow'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useReaRuntime } from '../../../lib/plugins/rea-runtime'

beforeEach(() => {
  useSettingsStore.getState().updateSettings({ reaPluginEnabled: false })
  useReaRuntime.setState({ phase: 'off', tools: 0, error: null })
})
afterEach(() => cleanup())

describe('the REA row', () => {
  it('starts off, and its switch turns the plugin on and off', () => {
    render(<ReaPluginRow />)
    const sw = screen.getByTestId('plugins-rea-switch')
    expect(sw.getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByTestId('plugins-rea-line')).toBeNull()
    fireEvent.click(sw)
    expect(useSettingsStore.getState().settings.reaPluginEnabled).toBe(true)
    fireEvent.click(sw)
    expect(useSettingsStore.getState().settings.reaPluginEnabled).toBe(false)
  })

  it('says the step a start is at, an error as it came, and what runs', () => {
    useSettingsStore.getState().updateSettings({ reaPluginEnabled: true })
    render(<ReaPluginRow />)
    act(() => { useReaRuntime.setState({ phase: 'fetching' }) })
    expect(screen.getByTestId('plugins-rea-line').textContent).toMatch(/official REA 6\.5\.0 package/)
    act(() => { useReaRuntime.setState({ phase: 'error', error: 'REA needs Node.js 22.19 or newer within 22' }) })
    expect(screen.getByTestId('plugins-rea-line').textContent).toBe('REA needs Node.js 22.19 or newer within 22')
    act(() => { useReaRuntime.setState({ phase: 'on', tools: 41, error: null }) })
    const line = screen.getByTestId('plugins-rea-line').textContent ?? ''
    expect(line).toMatch(/^41 reverse engineering tools for Agent and Code/)
    expect(line).toMatch(/Ghidra, Hopper, JADX and Frida are used where you have them installed; LU installs none of them/)
  })

  it('has no line for a plugin that is off', () => {
    expect(reaPhaseLine('off', 0, null)).toBeNull()
  })
})
