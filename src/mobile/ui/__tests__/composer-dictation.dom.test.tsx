// @vitest-environment jsdom
/**
 * Mobile round 48: while a take is written down, the shared slot of the
 * composer is a busy microphone that takes no tap. Before, it was a live
 * microphone (a tap started a second take) and turned into Send the moment
 * the text landed, under a finger that meant the microphone.
 *
 * Run: npx vitest run src/mobile/ui/__tests__/composer-dictation.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Composer } from '../Composer'

afterEach(cleanup)

describe('the slot of the composer during a dictation', () => {
  it('transcribing: a busy microphone, a tap does nothing; with the text in, Send', () => {
    const onDictate = vi.fn()
    const onSend = vi.fn()
    const { rerender } = render(<Composer value="" onChange={() => {}} onSend={onSend} onDictate={onDictate} dictation="transcribing" replaceField={<div />} />)
    const mic = screen.getByTestId('m-chat-mic')
    expect(mic).toHaveProperty('disabled', true)
    expect(mic.getAttribute('aria-busy')).toBe('true')
    expect(mic.getAttribute('data-m-dictation')).toBe('transcribing')
    fireEvent.click(mic)
    expect(onDictate).not.toHaveBeenCalled()
    expect(onSend).not.toHaveBeenCalled()

    rerender(<Composer value="Hello from dictation" onChange={() => {}} onSend={onSend} onDictate={onDictate} />)
    expect(screen.queryByTestId('m-chat-mic')).toBeNull()
    fireEvent.click(screen.getByTestId('m-chat-send'))
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('recording over text already typed: the slot stops the take, it does not send', () => {
    const onDictate = vi.fn()
    const onSend = vi.fn()
    render(<Composer value="Buy" onChange={() => {}} onSend={onSend} onDictate={onDictate} dictation="recording" replaceField={<div />} />)
    expect(screen.queryByTestId('m-chat-send')).toBeNull()
    const mic = screen.getByTestId('m-chat-mic')
    expect(mic).toHaveProperty('disabled', false)
    fireEvent.click(mic)
    expect(onDictate).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('the text lands: Send is another element than the microphone, a tap pressed on the microphone never ends on Send', () => {
    const onSend = vi.fn()
    const { rerender } = render(<Composer value="" onChange={() => {}} onSend={onSend} onDictate={() => {}} dictation="transcribing" />)
    const mic = screen.getByTestId('m-chat-mic')
    fireEvent.pointerDown(mic)
    rerender(<Composer value="Hello from dictation" onChange={() => {}} onSend={onSend} onDictate={() => {}} />)
    const send = screen.getByTestId('m-chat-send')
    expect(send).not.toBe(mic)
    expect(mic.isConnected).toBe(false)
    // Before r48 it was one element that only changed its face: the click of the finger on it was a Send.
    fireEvent.click(mic)
    expect(onSend).not.toHaveBeenCalled()
  })

  it('no dictation: as before', () => {
    render(<Composer value="" onChange={() => {}} onSend={() => {}} onDictate={() => {}} />)
    const mic = screen.getByTestId('m-chat-mic')
    expect(mic).toHaveProperty('disabled', false)
    expect(mic.getAttribute('aria-busy')).toBeNull()
  })
})
