/**
 * @vitest-environment jsdom
 *
 * 3.0.8, A28: the outage line under the header. Only for somebody signed in
 * to LU Cloud, closable, and back when the server posts a new sentence.
 *
 * Run: npx vitest run src/components/layout/__tests__/cloud-outage-banner.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react'
import { CloudOutageBanner } from '../CloudOutageBanner'
import { useCloudOutageStore } from '../../../stores/cloudOutageStore'
import { useCloudAuthStore } from '../../../stores/cloudAuthStore'

beforeEach(() => {
  useCloudOutageStore.setState({ active: false, message: null, dismissedMessage: null })
  useCloudAuthStore.setState({ status: 'signed-in', user: { id: 'u1' } })
})
afterEach(() => cleanup())

describe('CloudOutageBanner', () => {
  it('shows nothing without an outage', () => {
    render(<CloudOutageBanner />)
    expect(screen.queryByTestId('cloud-outage-banner')).toBeNull()
  })

  it('shows the server sentence during an outage', () => {
    useCloudOutageStore.setState({ active: true, message: 'LU Cloud is down for a bit.' })
    render(<CloudOutageBanner />)
    const line = screen.getByTestId('cloud-outage-banner')
    expect(line.textContent).toBe('LU Cloud is down for a bit.')
    expect(line.getAttribute('role')).toBe('status')
  })

  it('shows nothing to somebody who is not signed in to LU Cloud', () => {
    useCloudOutageStore.setState({ active: true, message: 'Down.' })
    for (const status of ['signed-out', 'probing'] as const) {
      useCloudAuthStore.setState({ status, user: null })
      render(<CloudOutageBanner />)
      expect(screen.queryByTestId('cloud-outage-banner')).toBeNull()
      cleanup()
    }
  })

  it('closes, stays closed for the same sentence and comes back with a new one', () => {
    useCloudOutageStore.setState({ active: true, message: 'Down.' })
    render(<CloudOutageBanner />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.queryByTestId('cloud-outage-banner')).toBeNull()

    act(() => useCloudOutageStore.getState().setOutage(true, 'Down.'))
    expect(screen.queryByTestId('cloud-outage-banner')).toBeNull()

    act(() => useCloudOutageStore.getState().setOutage(true, 'Still down, we are on it.'))
    expect(screen.getByTestId('cloud-outage-banner').textContent).toBe('Still down, we are on it.')
  })

  it('goes away when the outage is over', () => {
    useCloudOutageStore.setState({ active: true, message: 'Down.' })
    render(<CloudOutageBanner />)
    act(() => useCloudOutageStore.getState().setOutage(false, null))
    expect(screen.queryByTestId('cloud-outage-banner')).toBeNull()
  })
})
