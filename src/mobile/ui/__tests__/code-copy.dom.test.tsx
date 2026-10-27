// @vitest-environment jsdom
/**
 * A17: Copy of a code block in the chat with the computer (the Markdown of an
 * answer, idPrefix "m-remote"). The text goes to the clipboard of the system
 * through the native layer (lu-native clipboard_write_text), the button says
 * "Copied" and a toast says it once. When nobody takes the text, the button
 * stays "Copy" and the toast says that it failed.
 *
 * Run: npx vitest run src/mobile/ui/__tests__/code-copy.dom.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { __setBridgeForTests } from '../../platform/bridge'
import { useToastStore } from '../Toast'
import { Markdown } from '../Markdown'
import { COMMON } from '../../strings/common'

afterEach(() => {
  cleanup()
  __setBridgeForTests(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  useToastStore.getState().dismiss()
})

const ANSWER = 'Here:\n\n```bash\nnpm run build\n```\n'

describe('Copy in a code block of the remote chat', () => {
  it('puts the code on the clipboard of the system and says Copied', async () => {
    const native = vi.fn(async () => true)
    __setBridgeForTests({ clipboardWriteText: native })
    render(<Markdown content={ANSWER} idPrefix="m-remote" />)
    const button = screen.getByTestId('m-remote-code-copy')
    expect(button.textContent).toContain(COMMON.copy)
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(button.getAttribute('data-state')).toBe('copied'))
    expect(native).toHaveBeenCalledWith('npm run build')
    expect(button.textContent).toContain(COMMON.copied)
    expect(useToastStore.getState().current?.text).toBe(COMMON.copied)
  })

  it('says it failed when neither the system nor the WebView took it', async () => {
    __setBridgeForTests({ clipboardWriteText: async () => { throw new Error('The text could not be copied.') } })
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied') } }, configurable: true })
    const exec = vi.fn(() => false)
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true })
    render(<Markdown content={ANSWER} idPrefix="m-remote" />)
    const button = screen.getByTestId('m-remote-code-copy')
    await act(async () => {
      fireEvent.click(button)
    })
    await waitFor(() => expect(useToastStore.getState().current?.text).toBe(COMMON.copyFailed))
    expect(button.getAttribute('data-state')).toBe('idle')
  })
})
