// @vitest-environment jsdom
/**
 * GitHub #112 (DwarfStar): a server can serve a model id it does not list in
 * /models, and LU offered only what the list said. Ids typed for an endpoint
 * now join that endpoint's list, through the real provider adapter and the
 * field in the provider card.
 *
 * Run: npx vitest run src/api/providers/__tests__/a-model-the-server-does-not-list.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createElement } from 'react'

vi.mock('../../backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: vi.fn(), isPrivateOrLanHost: () => false,
  isDirectFetchAllowed: () => true, hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(), backendCall: vi.fn(), isTauri: () => false,
}))

import { OpenAIProvider } from '../openai-provider'
import { useSettingsStore } from '../../../stores/settingsStore'
import { endpointKey, parseExtraModelIds, MAX_EXTRA_MODEL_IDS } from '../../../lib/extra-model-ids'

const base = 'https://ds4.example.com/v1'
const provider = (baseUrl = base) => new OpenAIProvider({
  id: 'openai', name: 'DwarfStar', enabled: true, isLocal: false, apiKey: '', baseUrl,
})
const listing = (...ids: string[]) => vi.fn(async () => new Response(JSON.stringify({ data: ids.map((id) => ({ id })) })))

beforeEach(() => useSettingsStore.getState().updateSettings({ extraModelIds: {} }))
afterEach(() => { vi.unstubAllGlobals(); cleanup() })

describe('ids the server does not list', () => {
  it('join the list behind the ones the server named, with the provider of the endpoint', async () => {
    vi.stubGlobal('fetch', listing('deepseek-v4-flash'))
    useSettingsStore.getState().updateSettings({ extraModelIds: { [endpointKey(base)]: ['deepseek-chat'] } })
    const models = await provider().listModels()
    expect(models.map((m) => m.id)).toEqual(['deepseek-v4-flash', 'deepseek-chat'])
    expect(models[1]).toMatchObject({ name: 'deepseek-chat', provider: 'openai', providerName: 'DwarfStar', supportsTools: true })
    expect(models[1].contextLength).toBeGreaterThan(0)
  })

  it('an id the server lists keeps the server entry and is not doubled', async () => {
    vi.stubGlobal('fetch', listing('deepseek-chat'))
    useSettingsStore.getState().updateSettings({ extraModelIds: { [endpointKey(base)]: ['deepseek-chat'] } })
    expect((await provider().listModels()).map((m) => m.id)).toEqual(['deepseek-chat'])
  })

  it('belong to their endpoint only, whatever the spelling of its address', async () => {
    vi.stubGlobal('fetch', listing('a'))
    useSettingsStore.getState().updateSettings({ extraModelIds: { [endpointKey('https://DS4.example.com/v1/')]: ['b'] } })
    expect((await provider().listModels()).map((m) => m.id)).toEqual(['a', 'b'])
    expect((await provider('https://other.example.com/v1').listModels()).map((m) => m.id)).toEqual(['a'])
  })

  it('are read from what the user typed without blanks, doubles or spaces inside an id', () => {
    expect(parseExtraModelIds(' deepseek-chat \n\nqwen3:8b, deepseek-chat ,bad id,\u0007x')).toEqual(['deepseek-chat', 'qwen3:8b'])
    const many = Array.from({ length: 30 }, (_, i) => `m${i}`).join('\n')
    expect(parseExtraModelIds(many)).toHaveLength(MAX_EXTRA_MODEL_IDS)
    expect(parseExtraModelIds('x'.repeat(201))).toEqual([])
  })
})

describe('the field in the provider card', () => {
  it('stores the ids for its endpoint when it is left and asks for the model list again', async () => {
    const { ExtraModelIdsFieldForTest } = await import('../../../components/settings/ProviderConfig')
    const refresh = vi.fn()
    window.addEventListener('lu-models-refresh', refresh)
    render(createElement(ExtraModelIdsFieldForTest, { baseUrl: base }))
    const field = screen.getByTestId('extra-model-ids') as HTMLTextAreaElement
    fireEvent.change(field, { target: { value: 'deepseek-chat\nqwen3:8b' } })
    fireEvent.blur(field)
    expect(useSettingsStore.getState().settings.extraModelIds).toEqual({ [endpointKey(base)]: ['deepseek-chat', 'qwen3:8b'] })
    expect(refresh).toHaveBeenCalledTimes(1)
    fireEvent.change(field, { target: { value: '' } })
    fireEvent.blur(field)
    expect(useSettingsStore.getState().settings.extraModelIds).toEqual({})
    window.removeEventListener('lu-models-refresh', refresh)
  })
})
