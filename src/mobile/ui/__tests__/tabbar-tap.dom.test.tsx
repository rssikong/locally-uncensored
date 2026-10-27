// @vitest-environment jsdom
/**
 * Check on the iPhone, round 23, N14: right after a model arrived (download, load, a toast coming in) the
 * first tap on "Chat" reached the page as a touch (pointerdown) and no click followed. The tab bar now takes
 * a touch on lift-off, and the click that does come after it is the same tap.
 *
 * Run: npx vitest run src/mobile/ui/__tests__/tabbar-tap.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TAP_ECHO_MS, TabBar, isTapEcho } from '../TabBar'

afterEach(cleanup)

function pointer(type: string, target: Element, pointerType: string) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.assign(event, { pointerType, clientX: 0, clientY: 0, pointerId: 1 })
  fireEvent(target, event)
}

describe('a tap on a tab', () => {
  it('a touch that goes down and up on the tab switches, although no click follows', () => {
    const onSelect = vi.fn()
    render(<TabBar active="models" onSelect={onSelect} />)
    const chat = screen.getByTestId('m-nav-chat')
    pointer('pointerdown', chat, 'touch')
    pointer('pointerup', chat, 'touch')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('chat')
  })

  it('the click that follows the same tap does not switch a second time', () => {
    const onSelect = vi.fn()
    render(<TabBar active="models" onSelect={onSelect} />)
    const chat = screen.getByTestId('m-nav-chat')
    pointer('pointerdown', chat, 'touch')
    pointer('pointerup', chat, 'touch')
    fireEvent.click(chat)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('a click alone (keyboard, screen reader, mouse) still switches', () => {
    const onSelect = vi.fn()
    render(<TabBar active="models" onSelect={onSelect} />)
    fireEvent.click(screen.getByTestId('m-nav-create'))
    expect(onSelect).toHaveBeenCalledWith('create')
  })

  it('a touch that was cancelled, or went down on another tab, switches nothing on lift-off', () => {
    const onSelect = vi.fn()
    render(<TabBar active="models" onSelect={onSelect} />)
    const chat = screen.getByTestId('m-nav-chat')
    pointer('pointerdown', chat, 'touch')
    pointer('pointercancel', chat, 'touch')
    pointer('pointerup', chat, 'touch')
    pointer('pointerdown', screen.getByTestId('m-nav-create'), 'touch')
    pointer('pointerup', chat, 'touch')
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('a second, later tap on the same tab is a tap of its own', () => {
    expect(isTapEcho({ tab: 'chat', at: 1000 }, 'chat', 1000 + TAP_ECHO_MS - 1)).toBe(true)
    expect(isTapEcho({ tab: 'chat', at: 1000 }, 'chat', 1000 + TAP_ECHO_MS)).toBe(false)
    expect(isTapEcho({ tab: 'chat', at: 1000 }, 'models', 1100)).toBe(false)
    expect(isTapEcho(null, 'chat', 1100)).toBe(false)
  })
})
