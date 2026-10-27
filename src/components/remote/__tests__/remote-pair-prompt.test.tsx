// @vitest-environment jsdom
/**
 * The pairing question at the desktop: the comparison code on both paths, a
 * warning when several phones ask at once, and Allow/Deny that wait a second
 * after the question changed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => null), isTauri: () => false, isMacOS: () => false, openExternal: vi.fn(),
}))

const { RemotePairPrompt, PROMPT_ARM_MS } = await import('../RemotePairPrompt')
const { useRemoteStore } = await import('../../../stores/remoteStore')

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useRemoteStore.setState({ pairRequests: [] })
})

const allow = () => screen.getByRole('button', { name: 'Allow' }) as HTMLButtonElement

describe('RemotePairPrompt', () => {
  it('shows the comparison code and arms the buttons only after a second', () => {
    vi.useFakeTimers()
    useRemoteStore.setState({ pairRequests: [{ requestId: 'r1', name: 'Pixel 8', platform: 'android', comparisonCode: '568868', fingerprint: '3F2A 9C01' }] })
    render(<RemotePairPrompt />)
    expect(screen.getByText('568 868')).toBeTruthy()
    // The name sits in its own direction island.
    expect(document.querySelector('bdi')?.textContent).toBe('Pixel 8')
    expect(screen.getByText('3F2A 9C01')).toBeTruthy()
    expect(allow().disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(PROMPT_ARM_MS) })
    expect(allow().disabled).toBe(false)
  })

  it('warns about a second phone and waits again when the question changes', () => {
    vi.useFakeTimers()
    useRemoteStore.setState({ pairRequests: [
      { requestId: 'r1', name: 'Pixel 8', platform: 'android', comparisonCode: '111111' },
      { requestId: 'r2', name: 'Other', platform: 'ios', comparisonCode: '222222' },
    ] })
    render(<RemotePairPrompt />)
    expect(screen.getByRole('status').textContent).toContain('One more phone asks')
    act(() => { vi.advanceTimersByTime(PROMPT_ARM_MS) })
    expect(allow().disabled).toBe(false)
    act(() => { useRemoteStore.setState({ pairRequests: [{ requestId: 'r2', name: 'Other', platform: 'ios', comparisonCode: '222222' }] }) })
    expect(allow().disabled).toBe(true)
    act(() => { vi.advanceTimersByTime(PROMPT_ARM_MS) })
    expect(allow().disabled).toBe(false)
  })
})
