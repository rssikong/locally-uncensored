// @vitest-environment jsdom
/**
 * Finding N6 (Android review): the notice "LU cannot read your saved chats" had
 * no way to try again, so after the phone had room again it stayed until a
 * restart. It carries "Try again" now, like the other storage notices.
 *
 * Run: npx vitest run src/mobile/resilience/__tests__/storage-toast-unreadable-retry.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const { recheck, alerts } = vi.hoisted(() => ({
  recheck: vi.fn(),
  alerts: { current: null as unknown },
}))
vi.mock('../../lib/storage-alerts', () => ({
  recheckStorageAlerts: recheck,
  useStorageAlerts: () => alerts.current,
}))

const base = { quotaExceeded: false, settingsOnly: false, dismissQuota: () => {}, writeFailures: [{ key: 'chat-conversations' }] }

afterEach(() => { cleanup(); recheck.mockClear() })

describe('the notice of an unreadable store', () => {
  it('offers Try again, and the button asks the storage to try again', async () => {
    alerts.current = { ...base, losingData: true, losingWhy: 'unreadable' }
    const { StorageToast } = await import('../StorageToast')
    render(<StorageToast />)
    expect(screen.getByTestId('m-app-storage-not-saved').textContent).toContain('cannot read your saved chats')
    fireEvent.click(screen.getByTestId('m-app-storage-retry'))
    expect(recheck).toHaveBeenCalledTimes(1)
  })
})
