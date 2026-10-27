// @vitest-environment jsdom
/**
 * The bar "Your phone continued <Chat>. Open" (PhoneContinuedBar.tsx).
 */
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { PhoneContinuedBar } from '../PhoneContinuedBar'
import { createDeskGate, setWindowDeskGate, useDeskGateStore } from '../../../lib/remote-desk-gate'

describe('PhoneContinuedBar', () => {
  it('shows nothing without a waiting turn, then the chat and Open', async () => {
    useDeskGateStore.setState({ waiting: [] })
    const { container } = render(<PhoneContinuedBar />)
    expect(container.textContent).toBe('')
    const gate = createDeskGate({ now: () => 0, setTimer: () => 0, clearTimer: () => {}, isOpen: () => false })
    setWindowDeskGate(gate)
    gate.typed()
    let ran = false
    act(() => { void gate.wait('c1', 'Holiday plans').ready.then((ok) => { ran = ok }) })
    expect(screen.getByText(/Your phone continued/).textContent).toBe('Your phone continued Holiday plans.')
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Open' })) })
    await act(async () => {})
    expect(ran).toBe(true)
    expect(container.textContent).toBe('')
    setWindowDeskGate(null)
  })
})
