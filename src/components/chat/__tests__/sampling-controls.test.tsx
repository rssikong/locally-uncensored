// @vitest-environment jsdom
/**
 * R5-10/R5-11 (3.0.1-Liste), Entscheid vom 18.09.2026.
 *
 * Until this change the popup read and wrote the GLOBAL settings, so two
 * chats open one after another shared one temperature: moving the slider in
 * chat A silently changed what chat B would send on its next turn. The test
 * that matters most here is the one that watches a SECOND, untouched chat
 * stay exactly where it was.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useChatStore } from '../../../stores/chatStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { SAMPLING_CLOSE_LABEL, SAMPLING_DIALOG_LABEL, SamplingControls } from '../SamplingControls'

const conversation = (id: string) => ({
  id,
  title: id,
  messages: [],
  model: 'm',
  systemPrompt: '',
  createdAt: 0,
  updatedAt: 0,
})

const chat = (id = 'c1') => useChatStore.getState().conversations.find((c) => c.id === id)
const trigger = () => screen.getByTestId('sampling-trigger')
const open = () => fireEvent.click(trigger())

beforeEach(() => {
  useChatStore.setState({
    conversations: [conversation('c1'), conversation('c2')] as never,
    activeConversationId: 'c1',
  })
  useSettingsStore.getState().updateSettings({
    temperature: DEFAULT_SETTINGS.temperature,
    topP: DEFAULT_SETTINGS.topP,
    topK: DEFAULT_SETTINGS.topK,
    maxTokens: DEFAULT_SETTINGS.maxTokens,
  })
})

afterEach(() => cleanup())

describe('SamplingControls', () => {
  it('stays collapsed until asked, so the composer stays quiet', () => {
    render(<SamplingControls />)
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
    open()
    expect(screen.getByTestId('sampling-panel')).toBeTruthy()
  })

  it('shows nothing while no chat is open, nothing to write to means nothing to show', () => {
    useChatStore.setState({ activeConversationId: null })
    const { container } = render(<SamplingControls />)
    expect(container.firstChild).toBeNull()
  })

  it('shows the temperature THIS chat will use while it is closed', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.15 })
    render(<SamplingControls />)
    expect(screen.getByRole('button', { name: /1\.15/ })).toBeTruthy()
  })

  it('writes the CONVERSATION and never the global settings', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.3' } })
    fireEvent.change(screen.getByLabelText('Top P'), { target: { value: '0.5' } })
    expect(chat()?.sampling).toEqual({ temperature: 1.3, topP: 0.5 })
    // The whole reason this control moved out of the settings page.
    expect(useSettingsStore.getState().settings.temperature).toBe(DEFAULT_SETTINGS.temperature)
    expect(useSettingsStore.getState().settings.topP).toBe(DEFAULT_SETTINGS.topP)
  })

  it('leaves the OTHER chat exactly as it was', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.15' } })
    expect(chat('c1')?.sampling).toEqual({ temperature: 1.15 })
    expect(chat('c2')?.sampling).toBeUndefined()
  })

  it('a chat with no override of its own follows the Settings page', () => {
    useSettingsStore.getState().updateSettings({ temperature: 1.4 })
    render(<SamplingControls />)
    expect(screen.getByRole('button', { name: /1\.4\b/ })).toBeTruthy()
    expect(chat()?.sampling).toBeUndefined()
  })

  /**
   * R5-13. Top K moved nothing on the paid default path: the OpenAI-compatible
   * body has no field for it and `openai-provider.ts` never reads it, so on LU
   * Cloud and on this app's own engine the slider was a dead control. It also
   * carried a second scale, 0..200 here against 1..100 on the settings page.
   * It belongs on the settings page, where Ollama and Anthropic read it.
   */
  it('R5-13: carries no Top K, because it moves nothing on the cloud path', () => {
    render(<SamplingControls />)
    open()
    expect(screen.queryByLabelText('Top K')).toBeNull()
    expect(screen.queryByText('Top K')).toBeNull()
  })

  it('R5-13 NEGATIVKONTROLLE: Top K keeps its stored value, this popup only stops showing it', () => {
    useSettingsStore.getState().updateSettings({ topK: 55 })
    render(<SamplingControls />)
    open()
    expect(useSettingsStore.getState().settings.topK).toBe(55)
    expect(screen.getByLabelText('Temperature')).toBeTruthy()
  })

  /**
   * R5-14. The trigger was bare text, so a screen reader announced a number
   * and nothing else. Both strings are word for word the web app's
   * (the web app).
   */
  it('R5-14: the trigger has the same name and title as the web app', () => {
    render(<SamplingControls />)
    expect(trigger().getAttribute('title')).toBe('Sampling for this chat')
    expect(trigger().getAttribute('aria-label')).toBe('Sampling: temperature 0.7')
    expect(screen.getByRole('button', { name: 'Sampling: temperature 0.7' })).toBeTruthy()
  })

  it('never lets max tokens go negative', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Max tokens'), { target: { value: '-500' } })
    expect(chat()?.sampling?.maxTokens).toBe(0)
  })

  const maxTokens = () => screen.getByLabelText('Max tokens') as HTMLInputElement
  const typeInto = (field: HTMLInputElement, chars: string) => {
    for (const c of chars) fireEvent.change(field, { target: { value: field.value + c } })
  }

  it('replaces what stands in max tokens instead of appending to it', () => {
    render(<SamplingControls />)
    open()
    const field = maxTokens()
    expect(field.value).toBe('0')
    typeInto(field, '512')
    expect(field.value).toBe('512')
    expect(chat()?.sampling?.maxTokens).toBe(512)
  })

  it('falls back to the app default when max tokens is cleared, and shows it again on blur', () => {
    useChatStore.getState().setConversationSampling('c1', { maxTokens: 512 })
    render(<SamplingControls />)
    open()
    const field = maxTokens()
    fireEvent.change(field, { target: { value: '' } })
    expect(chat()?.sampling?.maxTokens).toBe(DEFAULT_SETTINGS.maxTokens)
    expect(field.value).toBe('')
    fireEvent.blur(field)
    expect(field.value).toBe(String(DEFAULT_SETTINGS.maxTokens))
  })

  it('keeps max tokens a whole number, because a fraction is not a token count', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(maxTokens(), { target: { value: '512.7' } })
    expect(chat()?.sampling?.maxTokens).toBe(512)
    expect(Number.isInteger(chat()?.sampling?.maxTokens)).toBe(true)
  })

  it('marks a changed chat, and deletes ALL of its own values on Reset', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.1, topP: 0.3, maxTokens: 512 })
    render(<SamplingControls />)
    expect(screen.getByTitle(/Changed from the defaults/)).toBeTruthy()
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    // The owner's decision: Reset DELETES the chat's own values instead of
    // writing today's defaults into it (see SamplingControls.tsx). Deleted,
    // not "set to defaults": the negative control right below is the whole
    // point of that distinction.
    expect(chat()?.sampling).toBeUndefined()
    expect(screen.queryByTitle(/Changed from the defaults/)).toBeNull()
  })

  it('NEGATIVKONTROLLE: after Reset the chat follows LATER Settings page changes, unlike a chat pinned to the old defaults', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.1 })
    render(<SamplingControls />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    cleanup()
    // The Settings page moves AFTER the reset, and a chat truly following it
    // again must pick the new number up, not stay pinned to the moment Reset
    // was pressed.
    useSettingsStore.getState().updateSettings({ temperature: 1.1 })
    render(<SamplingControls />)
    expect(screen.getByRole('button', { name: /1\.1\b/ })).toBeTruthy()
    expect(chat()?.sampling).toBeUndefined()
  })

  it('R5-13: Reset stays inside this popup and leaves Top K alone', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.1 })
    useSettingsStore.getState().updateSettings({ topK: 55 })
    render(<SamplingControls />)
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(useSettingsStore.getState().settings.topK).toBe(55)
  })

  it('offers no reset while everything is at its default', () => {
    render(<SamplingControls />)
    open()
    expect((screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('F1 (review-w2ui.md, 18.09.2026): Reset is disabled for a chat that only follows an already-moved Settings page', () => {
    // Reset can only delete THIS chat's own override. A chat with no
    // override that merely inherits a moved Settings slider has nothing of
    // its own to delete, so the button must stay disabled: before this fix
    // it read `changed` (something is on the wire, from EITHER source) and
    // showed itself as clickable here, and clicking it deleted a field
    // (`sampling`) that never existed: no error, but no effect either.
    useSettingsStore.getState().updateSettings({ temperature: 1.1 })
    render(<SamplingControls />)
    open()
    const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement
    expect(reset.disabled).toBe(true)
    expect(reset.title).toMatch(/already follows the Settings page/)
  })

  it('F1: Reset becomes enabled the moment this chat gets its own value, even while the Settings page also differs', () => {
    useSettingsStore.getState().updateSettings({ temperature: 1.1 })
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.2 })
    render(<SamplingControls />)
    open()
    const reset = screen.getByRole('button', { name: 'Reset' }) as HTMLButtonElement
    expect(reset.disabled).toBe(false)
    expect(reset.title).toBeFalsy()
  })

  it('says plainly that reasoning models react less, instead of hiding the control', () => {
    render(<SamplingControls />)
    open()
    expect(screen.getByText(/Reasoning models accept these/)).toBeTruthy()
  })
})

/**
 * 2026-09-11: "der sample anklickbar im prompt fenster muss ein pop up
 * sein, und nicht das prompt fenster veraendern. mit einem sauberen x zum
 * wegklicken und nicht einfach wieder auf den text klicken zum entfernen, soll
 * windows mac und webapp ueberall gleich sein."
 *
 * This form is untouched by the R5-10/R5-11 rewrite. HAUSREGEL: a sampling
 * popup with an X, Escape closes it too, unchanged everywhere.
 */
describe('the sampling popup', () => {
  it('is a popup over the row, not a panel inside it', () => {
    render(<SamplingControls />)
    open()
    const panel = screen.getByTestId('sampling-panel')
    expect(panel.style.position).toBe('absolute')
    expect(panel.style.bottom).toBe('100%')
    expect(panel.getAttribute('role')).toBe('dialog')
    expect(panel.getAttribute('aria-label')).toBe(SAMPLING_DIALOG_LABEL)
  })

  it('says on the trigger whether it is open, and which panel it owns', () => {
    render(<SamplingControls />)
    expect(trigger().getAttribute('aria-expanded')).toBe('false')
    open()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
    expect(trigger().getAttribute('aria-controls')).toBe(screen.getByTestId('sampling-panel').id)
  })

  it('closes on the X, which is what the X is for', () => {
    render(<SamplingControls />)
    open()
    fireEvent.click(screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL }))
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<SamplingControls />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
  })

  it('closes on a press outside, the way a phone sends it', () => {
    render(<SamplingControls />)
    open()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByTestId('sampling-panel')).toBeNull()
  })

  it('stays open when its own contents are pressed', () => {
    render(<SamplingControls />)
    open()
    fireEvent.pointerDown(screen.getByTestId('sampling-panel'))
    expect(screen.queryByTestId('sampling-panel')).not.toBeNull()
  })

  it('does NOT close when the trigger is pressed a second time', () => {
    render(<SamplingControls />)
    open()
    open()
    expect(screen.getByTestId('sampling-panel')).toBeTruthy()
    expect(trigger().getAttribute('aria-expanded')).toBe('true')
  })

  it('still holds the values after closing and opening again', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.45' } })
    fireEvent.change(screen.getByLabelText('Max tokens'), { target: { value: '2048' } })
    fireEvent.click(screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL }))
    open()
    expect((screen.getByLabelText('Temperature') as HTMLInputElement).value).toBe('1.45')
    expect((screen.getByLabelText('Max tokens') as HTMLInputElement).value).toBe('2048')
    expect(chat()?.sampling).toEqual({ temperature: 1.45, maxTokens: 2048 })
  })

  it('takes the keyboard into the popup and hands it back to the trigger', () => {
    render(<SamplingControls />)
    open()
    const x = screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL })
    expect(document.activeElement).toBe(x)
    fireEvent.click(x)
    expect(document.activeElement).toBe(trigger())
  })

  it('hands the keyboard back on Escape too', () => {
    render(<SamplingControls />)
    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(document.activeElement).toBe(trigger())
  })
})

describe('the Max tokens draft does not outlive the popup', () => {
  const feld = () => screen.getByLabelText('Max tokens') as HTMLInputElement
  const leeren = () => {
    fireEvent.change(feld(), { target: { value: '512' } })
    fireEvent.change(feld(), { target: { value: '' } })
  }

  it('the X drops an emptied box', () => {
    render(<SamplingControls />)
    open()
    leeren()
    expect(feld().value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: SAMPLING_CLOSE_LABEL }))
    open()
    expect(feld().value).toBe(String(DEFAULT_SETTINGS.maxTokens))
  })

  it('Escape drops an emptied box', () => {
    render(<SamplingControls />)
    open()
    leeren()
    fireEvent.keyDown(document, { key: 'Escape' })
    open()
    expect(feld().value).toBe(String(DEFAULT_SETTINGS.maxTokens))
  })

  it('a press outside drops an emptied box', () => {
    render(<SamplingControls />)
    open()
    leeren()
    fireEvent.pointerDown(document.body)
    open()
    expect(feld().value).toBe(String(DEFAULT_SETTINGS.maxTokens))
  })

  it('but a number that was typed comes back, because it was never a draft', () => {
    render(<SamplingControls />)
    open()
    fireEvent.change(feld(), { target: { value: '2048' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    open()
    expect(feld().value).toBe('2048')
    expect(chat()?.sampling?.maxTokens).toBe(2048)
  })

  it('leaving the field with the popup still open normalises it too', () => {
    render(<SamplingControls />)
    open()
    leeren()
    expect(feld().value).toBe('')
    fireEvent.blur(feld())
    expect(feld().value).toBe(String(DEFAULT_SETTINGS.maxTokens))
    expect(screen.queryByTestId('sampling-panel')).not.toBeNull()
  })
})
