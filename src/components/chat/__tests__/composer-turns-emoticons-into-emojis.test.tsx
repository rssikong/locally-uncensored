/**
 * @vitest-environment jsdom
 *
 * David's wish for 3.0.7: the chat composer (Chat, Agent and Code all type
 * into ChatInput) turns ":D" into 😃 once the word is over, and so on for
 * the common faces. One Backspace right after takes it back, Enter turns a
 * face that ends the message, and a switch in Settings (Appearance) turns it
 * off. The rules of what turns are in emoticons-turn-into-emojis.test.ts.
 *
 * Run: npx vitest run src/components/chat/__tests__/composer-turns-emoticons-into-emojis.test.tsx
 */
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { ChatInput } from '../ChatInput'
import { useSettingsStore } from '../../../stores/settingsStore'

beforeEach(() => { useSettingsStore.getState().updateSettings({ emojiAutoReplace: true }) })
afterEach(() => cleanup())

function composer(onSend: (text: string) => void = () => {}) {
  const view = render(
    <ChatInput onSend={(text) => onSend(text)} onStop={() => {}} isGenerating={false} modelReady={() => true} />,
  )
  return view.container.querySelector('textarea[data-lu-composer]') as HTMLTextAreaElement
}

/** Type one character at a time at the end of the field, as a keyboard does. */
function type(field: HTMLTextAreaElement, text: string) {
  for (const ch of text) fireEvent.change(field, { target: { value: field.value + ch } })
}

describe('the chat composer and emoticons', () => {
  it('turns :D into 😃 once a space follows, and the caret stays behind it', () => {
    const field = composer()
    type(field, 'hi :D')
    expect(field.value).toBe('hi :D')
    type(field, ' ')
    expect(field.value).toBe('hi 😃 ')
    expect(field.selectionStart).toBe(field.value.length)
    type(field, 'and <3 ;) ')
    expect(field.value).toBe('hi 😃 and ❤️ 😉 ')
  })

  it('takes a turn back with one Backspace right after it', () => {
    const field = composer()
    type(field, 'ok :) ')
    expect(field.value).toBe('ok 🙂 ')
    fireEvent.keyDown(field, { key: 'Backspace' })
    expect(field.value).toBe('ok :) ')
    expect(field.selectionStart).toBe('ok :) '.length)
    // The face stays as typed: the next word does not turn it again.
    type(field, 'fine ')
    expect(field.value).toBe('ok :) fine ')
  })

  it('leaves code and URLs alone', () => {
    const field = composer()
    type(field, 'run `a :) ` see http://x.io/:) ')
    expect(field.value).toBe('run `a :) ` see http://x.io/:) ')
  })

  it('turns a face at the end of the message on Enter', () => {
    let sent = ''
    const field = composer((text) => { sent = text })
    type(field, 'thanks :)')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(sent).toBe('thanks 🙂')
  })

  it('does nothing with the switch off', () => {
    useSettingsStore.getState().updateSettings({ emojiAutoReplace: false })
    let sent = ''
    const field = composer((text) => { sent = text })
    type(field, 'hi :D ok :)')
    expect(field.value).toBe('hi :D ok :)')
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(sent).toBe('hi :D ok :)')
  })
})
