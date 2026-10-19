/**
 * @vitest-environment jsdom
 *
 * How-it-works session, 3.0.7: right after an answer the composer refused a
 * second send without a word, and the text stayed in the field. The cause is
 * the double-fire guard of ChatInput (SEND_LOCK_MS, 700 ms): it held for ANY
 * message after an accepted send, and an answer faster than that (the engine
 * mock of the recordings, a fast cloud model) put the next send inside it.
 * Four e2e specs carried a retry loop for exactly this. The guard is meant
 * for two keydowns of one tick that send the same field twice; it now holds
 * only for the same message.
 *
 * Run: npx vitest run src/components/chat/__tests__/a-second-message-right-after-a-fast-answer-goes-out.test.tsx
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ChatInput } from '../ChatInput'

afterEach(() => cleanup())

function composer(onSend: (text: string) => void) {
  render(<ChatInput onSend={onSend} onStop={() => {}} isGenerating={false} modelReady={() => true} />)
  return screen.getByRole('textbox') as HTMLTextAreaElement
}

describe('the composer right after a fast answer', () => {
  it('sends the next message at once, the field empties', () => {
    const sent: string[] = []
    const field = composer((t) => sent.push(t))
    fireEvent.change(field, { target: { value: 'first' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    // The answer came back within the 700 ms; the user sends again.
    fireEvent.change(field, { target: { value: 'second' } })
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(sent).toEqual(['first', 'second'])
    expect(field.value).toBe('')
  })

  it('COUNTER-TEST: two Enter keydowns in one tick still send the field once', () => {
    const onSend = vi.fn()
    const field = composer(onSend)
    fireEvent.change(field, { target: { value: 'ok generiere jetzt' } })
    // Both handlers read the same render: no state update between them.
    const ev = () => new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    field.dispatchEvent(ev())
    field.dispatchEvent(ev())
    expect(onSend).toHaveBeenCalledTimes(1)
  })
})
