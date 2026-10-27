// @vitest-environment jsdom
/**
 * A33 (3.0.8, Discord "help lol"): the customer's 1.9 sat on the Settings page.
 * The popup showed "Sampling: 1.90 *" in the calm tone of any changed value,
 * said nothing about it, and its Reset was greyed out, because Reset only
 * deletes the chat's own values. These pin the warning and the one click
 * that brings the chat back, wherever the number came from.
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useChatStore } from '../../../stores/chatStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useAgentModeStore } from '../../../stores/agentModeStore'
import { useModelStore } from '../../../stores/modelStore'
import { DEFAULT_SETTINGS } from '../../../lib/constants'
import { HIGH_TEMPERATURE_WARNING } from '../../../lib/sampling'
import { SamplingControls } from '../SamplingControls'
import { HighTemperatureWarning, RESET_TO_DEFAULT_LABEL } from '../HighTemperatureWarning'

const conversation = (id: string, extra: Record<string, unknown> = {}) => ({
  id, title: id, messages: [], model: 'm', systemPrompt: '', createdAt: 0, updatedAt: 0, ...extra,
})

const open = () => fireEvent.click(screen.getByTestId('sampling-trigger'))
const chat = (id = 'c1') => useChatStore.getState().conversations.find((c) => c.id === id)

beforeEach(() => {
  useChatStore.setState({ conversations: [conversation('c1'), conversation('c2')] as never, activeConversationId: 'c1' })
  useSettingsStore.getState().updateSettings({ temperature: DEFAULT_SETTINGS.temperature, personasEnabled: false })
  useAgentModeStore.setState({ agentModeActive: {} })
})

afterEach(() => cleanup())

describe('HighTemperatureWarning', () => {
  it('stays away below 1.2', () => {
    const { container } = render(<HighTemperatureWarning temperature={1.15} onReset={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('from 1.2 up says what happens and offers the way back', () => {
    render(<HighTemperatureWarning temperature={1.2} onReset={() => {}} />)
    expect(screen.getByRole('alert').textContent).toContain(HIGH_TEMPERATURE_WARNING)
    expect(screen.getByRole('button', { name: RESET_TO_DEFAULT_LABEL })).toBeTruthy()
  })
})

describe('the chat popup at a high temperature', () => {
  it('the customer case: a high value on the Settings page, one click and every chat is back', () => {
    useSettingsStore.getState().updateSettings({ temperature: 1.5 })
    render(<SamplingControls />)
    // The closed control no longer looks like any harmless change.
    expect(screen.getByTestId('sampling-changed-marker').textContent).toBe('!')
    open()
    expect(screen.getByTestId('high-temperature-warning')).toBeTruthy()
    fireEvent.click(screen.getByTestId('temperature-reset-default'))
    expect(useSettingsStore.getState().settings.temperature).toBe(DEFAULT_SETTINGS.temperature)
    expect(screen.queryByTestId('high-temperature-warning')).toBeNull()
    expect(screen.getByTestId('sampling-trigger').textContent).toContain(DEFAULT_SETTINGS.temperature.toFixed(2))
  })

  it("a high value of the chat's own: the chat's values go, the other chat stays", () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.4, topP: 0.5 })
    useChatStore.getState().setConversationSampling('c2', { temperature: 1.3 })
    render(<SamplingControls />)
    open()
    fireEvent.click(screen.getByTestId('temperature-reset-default'))
    expect(chat('c1')?.sampling).toBeUndefined()
    expect(chat('c2')?.sampling).toEqual({ temperature: 1.3 })
  })

  it("a high value from the chat's persona: the persona loses its temperature", () => {
    useSettingsStore.getState().updateSettings({ personasEnabled: true })
    useSettingsStore.getState().addPersona({
      id: 'hot', name: 'Hot', icon: 'User', systemPrompt: 'x', isBuiltIn: false,
      sampling: { temperature: 1.4, topP: 0.6 },
    } as never)
    useChatStore.setState({ conversations: [conversation('c1', { personaId: 'hot', personaEnabled: true })] as never })
    useModelStore.setState({ activeModel: 'm' })
    render(<SamplingControls />)
    open()
    expect(screen.getByTestId('high-temperature-warning')).toBeTruthy()
    fireEvent.click(screen.getByTestId('temperature-reset-default'))
    const hot = useSettingsStore.getState().personas.find((p) => p.id === 'hot')
    expect(hot?.sampling).toEqual({ topP: 0.6 })
    useSettingsStore.getState().removePersona('hot')
  })

  it('the slider stops at 1.5', () => {
    render(<SamplingControls />)
    open()
    expect(screen.getByLabelText('Temperature').getAttribute('max')).toBe('1.5')
  })

  it('in Agent mode it says the Agent stays at 1.0', () => {
    useChatStore.getState().setConversationSampling('c1', { temperature: 1.1 })
    useAgentModeStore.setState({ agentModeActive: { c1: true } })
    render(<SamplingControls />)
    open()
    expect(screen.getByTestId('agent-temperature-hint').textContent).toContain('1.0')
  })

  it('NEGATIVKONTROLLE: at the default nothing warns and no Agent line shows', () => {
    useAgentModeStore.setState({ agentModeActive: { c1: true } })
    render(<SamplingControls />)
    open()
    expect(screen.queryByTestId('high-temperature-warning')).toBeNull()
    expect(screen.queryByTestId('agent-temperature-hint')).toBeNull()
  })
})
