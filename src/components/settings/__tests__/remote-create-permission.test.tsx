// @vitest-environment jsdom
/**
 * Create over the desktop: the fifth Remote permission. It starts off, it is
 * switched here like the other four, the store sends every scope explicitly,
 * and a server answer without it (an older build) reads as off.
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
import { useRemoteStore, normalizeRemotePermissions } from '../../../stores/remoteStore'

const OFF = { filesystem: false, downloads: false, process_control: false, shell: false, create: false }

beforeEach(() => {
  calls.list = []
  useRemoteStore.setState({ permissions: { ...OFF } })
})
afterEach(cleanup)

describe('the Create permission', () => {
  it('is listed with the others, says what it does, and starts off', () => {
    render(<RemoteAccessSettings />)
    expect(screen.getByText('Create')).toBeTruthy()
    expect(screen.getByText('Let paired phones make images and videos on this computer')).toBeTruthy()
    const toggle = screen.getByRole('switch', { name: 'Create' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.getAllByRole('switch')).toHaveLength(5)
  })

  it('switching it on sends every scope, create included, and shows it on', async () => {
    render(<RemoteAccessSettings />)
    fireEvent.click(screen.getByRole('switch', { name: 'Create' }))
    await vi.waitFor(() => expect(useRemoteStore.getState().permissions.create).toBe(true))
    const sent = calls.list.filter((c) => c.cmd === 'set_remote_permissions').map((c) => c.args)
    expect(sent).toEqual([{ permissions: { ...OFF, create: true } }])
    expect(screen.getByRole('switch', { name: 'Create' }).getAttribute('aria-checked')).toBe('true')
    // The other four stay as they were.
    expect(screen.getByRole('switch', { name: 'Shell & Code Execution' }).getAttribute('aria-checked')).toBe('false')
  })

  it('an answer from an older server without the field reads as off, never as on', () => {
    expect(normalizeRemotePermissions({ filesystem: true, downloads: true, process_control: true, shell: true }))
      .toEqual({ filesystem: true, downloads: true, process_control: true, shell: true, create: false })
    expect(normalizeRemotePermissions({ create: 'true' })?.create).toBe(false)
    expect(normalizeRemotePermissions({ create: true })?.create).toBe(true)
  })
})
