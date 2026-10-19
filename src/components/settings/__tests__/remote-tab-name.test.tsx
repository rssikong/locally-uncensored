// @vitest-environment jsdom
/**
 * GitHub #19: the Remote Access page on the phone was always called
 * "AI Terminal". Settings > Voice & Remote > Remote Access now has a field for
 * the name; the Rust server writes it into the page it serves (tested there in
 * commands/remote.rs, page_title_tests). Here: the field, its default, and the
 * hand over to Rust at boot and on every change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent } from '@testing-library/react'

const calls = vi.hoisted(() => ({ list: [] as Array<{ cmd: string; args: unknown }> }))

vi.mock('../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  isTauri: () => true,
  backendCall: vi.fn(async (cmd: string, args: unknown) => {
    calls.list.push({ cmd, args })
    if (cmd === 'remote_connected_devices') return []
    if (cmd === 'remote_server_status') return { running: false }
    return null
  }),
}))

import { RemoteAccessSettings } from '../RemoteAccessSettings'
import { useSettingsStore } from '../../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { SETTINGS_TAB_RESET_KEYS } from '../../../lib/settings-reset'
import { startRemotePageTitleSync } from '../../../lib/remote-page-title'

const field = () => screen.getByLabelText('Tab name on your phone') as HTMLInputElement
const titleCalls = () => calls.list.filter((c) => c.cmd === 'set_remote_page_title').map((c) => c.args)

beforeEach(() => {
  calls.list = []
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, remotePageTitle: '' } }))
})
afterEach(cleanup)

describe('the tab name field in Remote Access', () => {
  it('is empty by default and shows the name the phone keeps', () => {
    expect(DEFAULT_SETTINGS.remotePageTitle).toBe('')
    render(<RemoteAccessSettings />)
    expect(field().value).toBe('')
    expect(field().placeholder).toBe('AI Terminal')
    expect(field().maxLength).toBe(60)
    expect(screen.getByText(/Leave it empty for AI Terminal\. Reload the page on the phone to see a new name\./)).toBeTruthy()
  })

  it('typing stores the name in Settings', () => {
    render(<RemoteAccessSettings />)
    fireEvent.change(field(), { target: { value: 'Kitchen PC' } })
    expect(useSettingsStore.getState().settings.remotePageTitle).toBe('Kitchen PC')
    expect(field().value).toBe('Kitchen PC')
  })

  it('a Reset of the Voice & Remote tab brings the default back', () => {
    expect(SETTINGS_TAB_RESET_KEYS['voice-remote']).toContain('remotePageTitle')
  })
})

describe('the hand over to the Rust server', () => {
  it('sends the stored name at boot and again on every change', async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, remotePageTitle: 'Studio' } }))
    await startRemotePageTitleSync()
    expect(titleCalls()).toEqual([{ title: 'Studio' }])
    useSettingsStore.getState().updateSettings({ remotePageTitle: 'Living room' })
    await vi.waitFor(() => expect(titleCalls()).toEqual([{ title: 'Studio' }, { title: 'Living room' }]))
    // An unrelated setting does not resend it.
    useSettingsStore.getState().updateSettings({ temperature: 0.5 })
    await Promise.resolve()
    expect(titleCalls()).toHaveLength(2)
  })
})
