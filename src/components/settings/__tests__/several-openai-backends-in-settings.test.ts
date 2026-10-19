// @vitest-environment jsdom
/**
 * GitHub #173 in Settings, AI Backends: adding KoboldCpp while LM Studio
 * holds the OpenAI-compatible slot gives KoboldCpp a row of its own instead
 * of pushing LM Studio onto a standby card, and a backend that was pushed out
 * by an older version can be put next to the other one with one button.
 *
 * Run: npx vitest run src/components/settings/__tests__/several-openai-backends-in-settings.test.ts
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, act, fireEvent } from '@testing-library/react'
import type { ProviderConfig, ProviderId } from '../../../api/providers/types'

vi.mock('../../../api/backend', () => ({
  backendCall: vi.fn(async () => ({})),
  isTauri: () => false,
  isMacOS: () => false,
  openExternal: vi.fn(),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
  secretParkGet: vi.fn().mockRejectedValue(new Error('keychain unavailable (web build)')),
  secretParkSet: vi.fn().mockRejectedValue(new Error('keychain unavailable (web build)')),
  secretParkDelete: vi.fn().mockRejectedValue(new Error('keychain unavailable (web build)')),
}))
vi.mock('../../../api/builtin-ensure', () => ({
  readBuiltinSlotStatus: vi.fn(async () => null),
  diagnoseBuiltinEngine: vi.fn(async () => ({ ok: false, reason: '' })),
}))
vi.mock('../../../api/providers', async () => {
  const actual = await vi.importActual<typeof import('../../../api/providers')>('../../../api/providers')
  const client = { checkConnection: vi.fn(async () => true), listModels: vi.fn(async () => []) }
  return { ...actual, getProvider: () => client, getOpenAIEntryProvider: () => client }
})

const { ProviderSettings } = await import('../ProviderConfig')
const { useProviderStore } = await import('../../../stores/providerStore')

const aus = (id: ProviderId, name: string, baseUrl: string, extra: Partial<ProviderConfig> = {}): ProviderConfig =>
  ({ id, name, enabled: false, baseUrl, apiKey: '', isLocal: false, ...extra })

function baseline(openai: ProviderConfig) {
  useProviderStore.setState({
    providers: {
      ollama: aus('ollama', 'Ollama', 'http://localhost:11434'),
      openai,
      anthropic: aus('anthropic', 'Anthropic', 'https://api.anthropic.com'),
      'lu-cloud': aus('lu-cloud', 'LU Cloud', 'https://lu-labs.ai/api/inference/v1'),
    },
    openaiEntries: [],
    engineOptedOut: true,
  })
}

const lmStudio = aus('openai', 'LM Studio', 'http://localhost:1234/v1', { enabled: true, isLocal: true, managed: false })

async function open() {
  const utils = render(createElement(ProviderSettings))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  return utils
}

async function addPreset(name: string) {
  fireEvent.click(screen.getByText('Add Provider'))
  const item = screen.getAllByText(name).find((el) => el.closest('button'))!
  await act(async () => { fireEvent.click(item.closest('button')!) ; await new Promise((r) => setTimeout(r, 0)) })
}

beforeEach(() => baseline(lmStudio))
afterEach(cleanup)

describe('Settings, AI Backends, with two OpenAI-compatible backends', () => {
  it('adding KoboldCpp next to LM Studio keeps both on, each with its own row', async () => {
    await open()
    await addPreset('KoboldCpp')
    const st = useProviderStore.getState()
    expect(st.providers.openai).toMatchObject({ name: 'LM Studio', enabled: true })
    expect(st.providers.openai.displaced).toBeUndefined()
    expect(st.openaiEntries).toHaveLength(1)
    expect(st.openaiEntries[0]).toMatchObject({ name: 'KoboldCpp', baseUrl: 'http://localhost:5001/v1', enabled: true })
    expect(screen.getAllByTestId('openai-entry-row')).toHaveLength(1)
    // No sentence about one backend at a time anywhere.
    expect(screen.queryByText(/one\s+backend at a time/)).toBeNull()
    // The new row is open, with its own address and key fields.
    expect((screen.getByTestId('openai-entry-endpoint') as HTMLInputElement).value).toBe('http://localhost:5001/v1')
  })

  it('adding the same backend twice does not make a second row', async () => {
    await open()
    await addPreset('KoboldCpp')
    await addPreset('KoboldCpp')
    expect(useProviderStore.getState().openaiEntries).toHaveLength(1)
  })

  it('Run side by side turns a standby backend into its own entry', async () => {
    baseline({
      ...lmStudio, name: 'KoboldCpp', baseUrl: 'http://localhost:5001/v1',
      displaced: { name: 'LM Studio', baseUrl: 'http://localhost:1234/v1', isLocal: true },
    })
    await open()
    expect(screen.getByText(/took over the local OpenAI compatible slot from LM Studio/)).toBeTruthy()
    await act(async () => { fireEvent.click(screen.getByTestId('standby-side-by-side')); await new Promise((r) => setTimeout(r, 0)) })
    const st = useProviderStore.getState()
    expect(st.providers.openai).toMatchObject({ name: 'KoboldCpp', enabled: true })
    expect(st.providers.openai.displaced).toBeUndefined()
    expect(st.openaiEntries.map((e) => [e.name, e.baseUrl, e.enabled])).toEqual([['LM Studio', 'http://localhost:1234/v1', true]])
  })

  it('with the LU Engine waiting, Run side by side gives it the slot back and keeps the other backend', async () => {
    baseline({
      ...lmStudio,
      displaced: { name: 'LU Engine', baseUrl: 'http://127.0.0.1:8127/v1', isLocal: true, managed: true },
    })
    await open()
    await act(async () => { fireEvent.click(screen.getByTestId('standby-side-by-side')); await new Promise((r) => setTimeout(r, 0)) })
    const st = useProviderStore.getState()
    expect(st.providers.openai).toMatchObject({ name: 'LU Engine', managed: true, enabled: true })
    expect(st.openaiEntries.map((e) => [e.name, e.baseUrl])).toEqual([['LM Studio', 'http://localhost:1234/v1']])
  })

  it('Remove asks twice and then forgets the entry', async () => {
    await open()
    await addPreset('KoboldCpp')
    fireEvent.click(screen.getByTestId('openai-entry-remove'))
    expect(useProviderStore.getState().openaiEntries).toHaveLength(1)
    fireEvent.click(screen.getByTestId('openai-entry-remove'))
    expect(useProviderStore.getState().openaiEntries).toHaveLength(0)
  })

  // Negative control: with the slot free, a backend still goes into the slot.
  it('with the slot switched off, the backend takes the slot as before', async () => {
    baseline({ ...lmStudio, enabled: false })
    await open()
    await addPreset('KoboldCpp')
    const st = useProviderStore.getState()
    expect(st.openaiEntries).toHaveLength(0)
    expect(st.providers.openai).toMatchObject({ name: 'KoboldCpp', enabled: true })
  })
})
