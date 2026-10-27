// @vitest-environment jsdom
/**
 * Hint NH-T (check of package 18 on Android, mobile-docs/r47/reste.md). The
 * line "Your phone has room again, but LU can only save after a restart"
 * carried "Try again", which cannot reach the broken store before a restart.
 * It carries no button now, says how to restart on this phone, and does not
 * say "Free up space".
 *
 * Run: npx vitest run src/mobile/resilience/__tests__/storage-toast-restart.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const { alerts, os } = vi.hoisted(() => ({ alerts: { current: null as unknown }, os: { ios: false } }))
vi.mock('../../lib/storage-alerts', () => ({
  recheckStorageAlerts: () => {},
  useStorageAlerts: () => alerts.current,
}))
vi.mock('../../../lib/device-kind', () => ({ isIOS: () => os.ios }))

const base = { quotaExceeded: false, settingsOnly: false, dismissQuota: () => {}, writeFailures: [{ key: 'chat-conversations' }], losingData: true }

afterEach(() => { cleanup(); os.ios = false })

describe('the line when only a restart helps (NH-T)', () => {
  it('Android: no "Try again", no "Manage storage", no "Free up space", and how to restart', async () => {
    alerts.current = { ...base, losingWhy: 'restart' }
    const { StorageToast } = await import('../StorageToast')
    render(<StorageToast />)
    const line = screen.getByTestId('m-app-storage-not-saved')
    expect(line.textContent).toContain('can only save after a restart')
    expect(line.textContent).toContain('swipe it away in your recent apps')
    expect(line.textContent).not.toMatch(/free up space|try again/i)
    expect(screen.queryByTestId('m-app-storage-retry')).toBeNull()
    expect(screen.queryByTestId('m-app-storage-manage')).toBeNull()
    expect(line.querySelectorAll('button')).toHaveLength(0)
  })

  it('iPhone: the app switcher', async () => {
    os.ios = true
    alerts.current = { ...base, losingWhy: 'restart', settingsOnly: true }
    const { StorageToast } = await import('../StorageToast')
    render(<StorageToast />)
    expect(screen.getByTestId('m-app-storage-not-saved').textContent).toContain('swipe it away in the app switcher')
  })

  it('a full phone still has both buttons', async () => {
    alerts.current = { ...base, losingWhy: 'no-space' }
    const { StorageToast } = await import('../StorageToast')
    render(<StorageToast />)
    expect(screen.getByTestId('m-app-storage-retry')).toBeTruthy()
    expect(screen.getByTestId('m-app-storage-manage')).toBeTruthy()
  })
})
