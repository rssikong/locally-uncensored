// @vitest-environment jsdom
/**
 * Think budget (D12) in the composer's sampling popup and on the Settings
 * page's Generation section.
 *
 * The field writes the one global setting; on a backend without a budget it
 * is disabled and says so, instead of taking a number that does nothing.
 *
 * Run: npx vitest run src/components/chat/__tests__/think-budget-ui.test.tsx
 */
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { useChatStore } from '../../../stores/chatStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import { useModelStore } from '../../../stores/modelStore'
import { useProviderStore } from '../../../stores/providerStore'
import { SamplingControls, THINK_BUDGET_LABEL } from '../SamplingControls'

const conversation = {
  id: 'c1', title: 'c1', messages: [], model: 'm', systemPrompt: '', createdAt: 0, updatedAt: 0,
}

function setBackend(model: string, managed: boolean) {
  useModelStore.setState({ activeModel: model })
  const providers = useProviderStore.getState().providers
  useProviderStore.setState({ providers: { ...providers, openai: { ...providers.openai, managed } } })
}

function openPopup() {
  render(<SamplingControls />)
  fireEvent.click(screen.getByTestId('sampling-trigger'))
}

const field = () => screen.getByLabelText<HTMLInputElement>(THINK_BUDGET_LABEL)
const hint = () => screen.getByTestId('think-budget-hint').textContent

beforeEach(() => {
  useChatStore.setState({ conversations: [conversation] as never, activeConversationId: 'c1' })
  useSettingsStore.getState().updateSettings({ thinkingBudget: 0 })
})
afterEach(() => cleanup())

describe('think budget in the sampling popup', () => {
  it('LU Engine: enabled, auto by default, and a typed count lands in the global setting', () => {
    setBackend('openai::qwen3-8b', true)
    openPopup()
    expect(field().disabled).toBe(false)
    expect(field().value).toBe('0')
    expect(hint()).toBe('Auto: follows the effort setting. Low 1024, Medium 4096, High no limit.')
    fireEvent.change(field(), { target: { value: '2048' } })
    expect(useSettingsStore.getState().settings.thinkingBudget).toBe(2048)
    expect(hint()).toBe('Thinking stops after this many tokens.')
  })

  it('Anthropic: enabled and names the API floor', () => {
    setBackend('anthropic::claude-sonnet-4-20250514', false)
    useSettingsStore.getState().updateSettings({ thinkingBudget: 500 })
    openPopup()
    expect(field().disabled).toBe(false)
    expect(hint()).toContain('1024')
  })

  for (const [name, model, managed] of [
    ['Ollama', 'qwen3:8b', false],
    ['LM Studio or another OpenAI-compatible server', 'openai::qwen3-8b', false],
    ['the hosted models', 'lu-cloud::glm-5', false],
  ] as const) {
    it(`${name}: disabled and says it is not supported`, () => {
      setBackend(model, managed)
      useSettingsStore.getState().updateSettings({ thinkingBudget: 4000 })
      openPopup()
      expect(field().disabled).toBe(true)
      expect(hint()).toBe('Not supported by this backend.')
    })
  }

  it('clearing the field goes back to auto, and the chat Reset leaves the global value alone', () => {
    setBackend('openai::qwen3-8b', true)
    openPopup()
    fireEvent.change(field(), { target: { value: '1500' } })
    fireEvent.change(field(), { target: { value: '' } })
    expect(useSettingsStore.getState().settings.thinkingBudget).toBe(0)
    fireEvent.change(field(), { target: { value: '900' } })
    fireEvent.change(screen.getByLabelText('Temperature'), { target: { value: '1.2' } })
    fireEvent.click(screen.getByText('Reset'))
    expect(useSettingsStore.getState().settings.thinkingBudget).toBe(900)
  })

  it('a negative or fractional entry is stored as a whole count', () => {
    setBackend('openai::qwen3-8b', true)
    openPopup()
    fireEvent.change(field(), { target: { value: '-20' } })
    expect(useSettingsStore.getState().settings.thinkingBudget).toBe(0)
    fireEvent.change(field(), { target: { value: '777.9' } })
    expect(useSettingsStore.getState().settings.thinkingBudget).toBe(777)
  })
})

describe('think budget on the Settings page', () => {
  const page = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../settings/SettingsPage.tsx'), 'utf8',
  )
  it('sits in the Generation section, right after Max Tokens', () => {
    const generation = page.indexOf('<Section title="Generation">')
    const maxTokens = page.indexOf('aria-label="Max Tokens"', generation)
    const budget = page.indexOf('aria-label="Think budget"', generation)
    expect(generation).toBeGreaterThan(-1)
    expect(budget).toBeGreaterThan(maxTokens)
    expect(page).toContain('updateSettings({ thinkingBudget: normalizeThinkBudget(')
  })
})
