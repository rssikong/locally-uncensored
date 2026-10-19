// @vitest-environment jsdom
/**
 * GH #181: the reminder is set in the persona settings, with its depth.
 *
 * Run: npx vitest run src/components/personas/__tests__/persona-reminder-field.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PersonaPanel } from '../PersonaPanel'
import { SystemPromptEditor, noteFromDraft } from '../SystemPromptEditor'
import { useSettingsStore } from '../../../stores/settingsStore'
import { BUILT_IN_PERSONAS } from '../../../lib/constants'
import { DEFAULT_NOTE_DEPTH, MAX_NOTE_DEPTH } from '../../../lib/persona-note'
import type { Persona } from '../../../types/settings'

const BARON: Persona = { id: 'baron', name: 'Baron', icon: 'User', systemPrompt: 'You are the Baron.', isBuiltIn: false, note: 'Always end with a toast.', noteDepth: 2 }

const persona = (id: string) => useSettingsStore.getState().personas.find((p) => p.id === id)
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

beforeEach(() => {
  useSettingsStore.setState({ personas: [...BUILT_IN_PERSONAS, BARON] })
})
afterEach(() => cleanup())

describe('the reminder field', () => {
  it('a new persona saves its reminder and depth', () => {
    render(<SystemPromptEditor />)
    expect((screen.getByLabelText('Reminder depth') as HTMLInputElement).value).toBe(String(DEFAULT_NOTE_DEPTH))
    fireEvent.change(screen.getByPlaceholderText('Persona name...'), { target: { value: 'Gnome' } })
    fireEvent.change(screen.getByPlaceholderText('System prompt...'), { target: { value: 'You are a gnome.' } })
    type('Reminder', '  Speak in riddles.  ')
    type('Reminder depth', '1')
    fireEvent.click(screen.getByText('Save Persona'))
    const saved = useSettingsStore.getState().personas.find((p) => p.name === 'Gnome')!
    expect([saved.note, saved.noteDepth]).toEqual(['Speak in riddles.', 1])
  })

  it('a new persona without a reminder carries no reminder fields at all', () => {
    render(<SystemPromptEditor />)
    fireEvent.change(screen.getByPlaceholderText('Persona name...'), { target: { value: 'Plain' } })
    fireEvent.change(screen.getByPlaceholderText('System prompt...'), { target: { value: 'You are plain.' } })
    fireEvent.click(screen.getByText('Save Persona'))
    const saved = useSettingsStore.getState().personas.find((p) => p.name === 'Plain')!
    expect('note' in saved).toBe(false)
    expect('noteDepth' in saved).toBe(false)
  })

  it('editing a persona shows its reminder, and clearing it removes reminder and depth', () => {
    render(<PersonaPanel />)
    const card = screen.getByText('Baron').closest('div')!.parentElement!
    fireEvent.click(within(card).getByTitle('Edit persona'))
    expect((screen.getByLabelText('Reminder') as HTMLTextAreaElement).value).toBe('Always end with a toast.')
    expect((screen.getByLabelText('Reminder depth') as HTMLInputElement).value).toBe('2')
    type('Reminder depth', '7')
    fireEvent.click(screen.getByText('Update Persona'))
    expect([persona('baron')!.note, persona('baron')!.noteDepth]).toEqual(['Always end with a toast.', 7])

    fireEvent.click(within(screen.getByText('Baron').closest('div')!.parentElement!).getByTitle('Edit persona'))
    type('Reminder', '   ')
    fireEvent.click(screen.getByText('Update Persona'))
    expect(persona('baron')!.note).toBeUndefined()
    expect(persona('baron')!.noteDepth).toBeUndefined()
    expect(JSON.parse(JSON.stringify(persona('baron')))).not.toHaveProperty('note')
  })

  it('the depth is clamped and an empty depth box means the default', () => {
    expect(noteFromDraft('x', '999')).toEqual({ note: 'x', noteDepth: MAX_NOTE_DEPTH })
    expect(noteFromDraft('x', '-2')).toEqual({ note: 'x', noteDepth: 0 })
    expect(noteFromDraft('x', '')).toEqual({ note: 'x', noteDepth: DEFAULT_NOTE_DEPTH })
    expect(noteFromDraft(' ', '3')).toEqual({ note: undefined, noteDepth: undefined })
  })

  it('says where it goes and that the chat does not keep it', () => {
    render(<SystemPromptEditor />)
    const box = screen.getByTestId('persona-note')
    expect(box.textContent).toMatch(/group chats/)
    expect(box.textContent).toMatch(/not saved in the chat/)
  })
})
