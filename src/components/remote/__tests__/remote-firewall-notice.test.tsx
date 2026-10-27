// @vitest-environment jsdom
/**
 * Windows drops the Wi-Fi way for LU (commands/win_firewall.rs): the Remote
 * panel says so, "Allow LU" asks Rust for the one allowed change, and the
 * internet link is offered as the way around it. Nothing runs without a click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react'

const state = vi.hoisted(() => ({ calls: [] as string[], status: {} as unknown, after: {} as unknown }))
vi.mock('../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  isTauri: () => true,
  backendCall: vi.fn(async (cmd: string) => {
    state.calls.push(cmd)
    if (cmd === 'remote_firewall_status') return state.status
    if (cmd === 'remote_firewall_allow') return state.after
    return null
  }),
}))
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }))

import { RemoteFirewallNotice, normalizeFirewallStatus, FIREWALL_TEXT, PUBLIC_NETWORK_TEXT } from '../RemoteFirewallNotice'
import { useRemoteStore } from '../../../stores/remoteStore'

beforeEach(() => {
  state.calls = []
  useRemoteStore.setState({ enabled: true, tunnelActive: false })
})
afterEach(cleanup)

describe('the firewall line in the Remote panel', () => {
  it('reads the status field by field', () => {
    expect(normalizeFirewallStatus({ checked: true, blocked: true, reason: 'blocked', profile: 'public' })).toEqual({ checked: true, blocked: true, reason: 'blocked', profile: 'public' })
    expect(normalizeFirewallStatus({ blocked: 'yes', reason: 'x', profile: 'home' })).toEqual({ checked: false, blocked: false, reason: null, profile: null })
    expect(normalizeFirewallStatus(null).blocked).toBe(false)
  })

  it('shows nothing when the Wi-Fi way is open, and asks nothing on its own', async () => {
    state.status = { checked: true, blocked: false, reason: null, profile: 'private' }
    const { container } = render(<RemoteFirewallNotice />)
    await waitFor(() => expect(state.calls).toContain('remote_firewall_status'))
    expect(container.textContent).toBe('')
    expect(state.calls).not.toContain('remote_firewall_allow')
  })

  it('says what is wrong, allows LU only on the click, and offers the internet link', async () => {
    state.status = { checked: true, blocked: true, reason: 'blocked', profile: 'public' }
    state.after = { checked: true, blocked: false, reason: null, profile: 'public' }
    render(<RemoteFirewallNotice />)
    await screen.findByText(FIREWALL_TEXT)
    expect(screen.getByText(PUBLIC_NETWORK_TEXT)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Use the internet link instead' })).toBeTruthy()
    expect(state.calls).not.toContain('remote_firewall_allow')
    fireEvent.click(screen.getByRole('button', { name: 'Allow LU' }))
    await waitFor(() => expect(screen.queryByText(FIREWALL_TEXT)).toBeNull())
    expect(state.calls.filter((c) => c === 'remote_firewall_allow')).toHaveLength(1)
  })

  it('the internet link turns on "from anywhere" and starts the tunnel', async () => {
    state.status = { checked: true, blocked: true, reason: 'no_allow', profile: 'private' }
    const setAnywhere = vi.fn(async () => {})
    const startTunnel = vi.fn(async () => {})
    useRemoteStore.setState({ setAnywhere, startTunnel } as never)
    render(<RemoteFirewallNotice />)
    await screen.findByText(FIREWALL_TEXT)
    expect(screen.queryByText(PUBLIC_NETWORK_TEXT)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Use the internet link instead' }))
    await waitFor(() => expect(startTunnel).toHaveBeenCalledOnce())
    expect(setAnywhere).toHaveBeenCalledWith(true)
  })
})
