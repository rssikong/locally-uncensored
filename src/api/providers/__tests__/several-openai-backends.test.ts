// @vitest-environment jsdom
/**
 * GitHub #173: more than one OpenAI-compatible backend at the same time.
 *
 * Before 3.0.7 the `openai` slot held one backend, so enabling KoboldCpp
 * pushed LM Studio out ("took over the local OpenAI compatible slot, which
 * holds one backend at a time"), and a group chat could not mix a model from
 * each. Now the slot stays and additional entries run next to it, each with
 * its own address, key and model list, and their models are named
 * `openai:<entry>::<model>`.
 *
 * These tests drive the real provider store, the real registry and the real
 * OpenAI adapter against a stubbed network, and check three things: both
 * backends list at once and the picker groups them, a request goes to the
 * address of the backend that owns the model, and the stored settings of an
 * older version keep every `openai::<model>` pointing where it pointed.
 *
 * Run: npx vitest run src/api/providers/__tests__/several-openai-backends.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../backend', () => ({
  localFetch: vi.fn(async () => new Response('{}', { status: 404 })),
  localFetchStream: vi.fn(),
  isPrivateOrLanHost: () => false,
  isDirectFetchAllowed: () => true,
  hostnameOf: (url: string) => new URL(url).hostname,
  ensureProxyAllowsHost: vi.fn(),
  backendCall: vi.fn(async () => { throw new Error('no backend in this test') }),
  isTauri: () => false,
  isOllamaLocal: () => true,
  secretGet: vi.fn(async () => { throw new Error('no keychain here') }),
  secretSet: vi.fn(async () => { throw new Error('no keychain here') }),
  secretDelete: vi.fn(async () => { throw new Error('no keychain here') }),
  secretParkGet: vi.fn(async () => { throw new Error('no keychain here') }),
  secretParkSet: vi.fn(async () => { throw new Error('no keychain here') }),
  secretParkDelete: vi.fn(async () => { throw new Error('no keychain here') }),
}))

import { useProviderStore, migrateProviderState } from '../../../stores/providerStore'
import { getEnabledProviders, getProviderForModel, clearProviderCache } from '../registry'
import {
  getProviderIdFromModel, openaiEntryOfModel, modelBackendKey, isOpenAISlotModel, prefixModelName, displayModelName,
} from '../model-name'
import { cloudModelRow } from '../../../lib/cloud-model-row'
import { placeBackend } from '../../../lib/openai-entries'
import { laneOf } from '../../../lib/run-lane-of-model'
import { groupChatCandidates, groupHistory } from '../../../lib/group-chat'
import { builtinReloadNeeded } from '../../builtin-ensure'
import type { AIModel } from '../../../types/models'
import type { ProviderConfig } from '../types'

const LMS = 'http://lmstudio.example:1234/v1'
const KOBOLD = 'http://kobold.example:5001/v1'

const lmStudioSlot: ProviderConfig = {
  id: 'openai', name: 'LM Studio', enabled: true, baseUrl: LMS, apiKey: '', isLocal: false, managed: false,
}
const engineSlot: ProviderConfig = {
  id: 'openai', name: 'LU Engine', enabled: true, baseUrl: 'http://127.0.0.1:8127/v1', apiKey: '', isLocal: true, managed: true,
}

const sse = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n` +
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n` +
    'data: [DONE]\n\n',
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )

/** Two servers on the network: each lists its own model and answers chat. */
function twoServers() {
  const calls: { url: string; model?: string; auth?: string }[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const body = init?.body ? JSON.parse(String(init.body)) as { model?: string } : undefined
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, model: body?.model, auth: headers['Authorization'] })
    if (url === `${LMS}/models`) return new Response(JSON.stringify({ data: [{ id: 'qwen3-8b' }] }))
    if (url === `${KOBOLD}/models`) return new Response(JSON.stringify({ data: [{ id: 'mistral-nemo' }] }))
    if (url === `${LMS}/chat/completions`) return sse('from lm studio')
    if (url === `${KOBOLD}/chat/completions`) return sse('from koboldcpp')
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return calls
}

async function pickerRows(): Promise<AIModel[]> {
  // As useModels does: the LU Engine's rows come from its own file list, not
  // from /v1/models, so a managed slot is not asked here.
  const managedSlot = useProviderStore.getState().providers.openai.managed === true
  const clients = getEnabledProviders().filter((p) => !(managedSlot && p.id === 'openai' && !p.entryId))
  const lists = await Promise.all(clients.map((p) => p.listModels()))
  return lists.flat().map((pm) => cloudModelRow(pm))
}

async function say(model: string): Promise<string> {
  const { provider, modelId } = getProviderForModel(model)
  let text = ''
  for await (const chunk of provider.chatStream(modelId, [{ role: 'user', content: 'hi' }])) {
    text += chunk.content
  }
  return text
}

function resetStore(slot: ProviderConfig) {
  useProviderStore.setState({
    providers: {
      ...useProviderStore.getState().providers,
      openai: slot,
      ollama: { ...useProviderStore.getState().providers.ollama, enabled: false },
      anthropic: { ...useProviderStore.getState().providers.anthropic, enabled: false },
      'lu-cloud': { ...useProviderStore.getState().providers['lu-cloud'], enabled: false },
    },
    openaiEntries: [],
  })
  clearProviderCache()
}

beforeEach(() => resetStore(lmStudioSlot))
afterEach(() => { vi.unstubAllGlobals(); clearProviderCache() })

describe('two OpenAI-compatible backends at the same time', () => {
  it('lists the models of both, each under its own backend and its own id', async () => {
    twoServers()
    const kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
    const rows = await pickerRows()
    const names = rows.map((r) => r.name)
    expect(names).toContain('openai::qwen3-8b')
    expect(names).toContain(`openai:${kobold}::mistral-nemo`)
    const koboldRow = rows.find((r) => r.name === `openai:${kobold}::mistral-nemo`)!
    expect(koboldRow).toMatchObject({ provider: 'openai', providerName: 'KoboldCpp', providerEntry: kobold })
    // The slot is still the slot: LM Studio was not pushed out.
    expect(useProviderStore.getState().providers.openai).toMatchObject({ name: 'LM Studio', baseUrl: LMS, enabled: true })
  })

  it('the picker groups the second backend under its own name', async () => {
    twoServers()
    const kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
    const { computeModelGroups } = await import('../../../components/models/ModelSelector')
    const { groups, showHeadings } = computeModelGroups(await pickerRows(), false, null, null)
    const koboldGroup = groups.find((g) => g.family === 'KoboldCpp')
    expect(koboldGroup?.models.map((m) => m.name)).toEqual([`openai:${kobold}::mistral-nemo`])
    // The slot's row is not in that group, and the group carries a heading.
    expect(groups.filter((g) => g !== koboldGroup).flatMap((g) => g.models.map((m) => m.name))).toContain('openai::qwen3-8b')
    expect(showHeadings).toBe(true)
  }, 60_000) // the picker module is a large import

  it('sends a request to the address of the backend that owns the model', async () => {
    const calls = twoServers()
    const kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
    useProviderStore.getState().setOpenAIEntryApiKey(kobold, 'kobold-secret')

    expect(await say(`openai:${kobold}::mistral-nemo`)).toBe('from koboldcpp')
    const toKobold = calls.filter((c) => c.url.endsWith('/chat/completions'))
    expect(toKobold).toHaveLength(1)
    expect(toKobold[0]).toMatchObject({ url: `${KOBOLD}/chat/completions`, model: 'mistral-nemo', auth: 'Bearer kobold-secret' })

    // The old id still means the slot, with the slot's own (empty) key.
    expect(await say('openai::qwen3-8b')).toBe('from lm studio')
    const last = calls.filter((c) => c.url.endsWith('/chat/completions')).at(-1)!
    expect(last).toMatchObject({ url: `${LMS}/chat/completions`, model: 'qwen3-8b' })
    expect(last.auth).toBeUndefined()
  })

  it('a removed or switched-off entry does not fall back to the slot', async () => {
    twoServers()
    const kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
    useProviderStore.getState().updateOpenAIEntry(kobold, { enabled: false, disabledByUser: true })
    expect((await pickerRows()).map((r) => r.name)).toEqual(['openai::qwen3-8b'])
    useProviderStore.getState().removeOpenAIEntry(kobold)
    expect(() => getProviderForModel(`openai:${kobold}::mistral-nemo`)).toThrow(/not configured/)
  })

  it('adding a backend while the slot serves another one makes an entry, not a takeover', () => {
    const kobold = { providerId: 'openai' as const, baseUrl: KOBOLD }
    expect(placeBackend(lmStudioSlot, [], kobold)).toEqual({ kind: 'entry-new' })
    expect(placeBackend(engineSlot, [], kobold)).toEqual({ kind: 'entry-new' })
    // The same server twice is the same entry.
    const entry = { ...lmStudioSlot, entryId: 'koboldcpp-0001', name: 'KoboldCpp', baseUrl: `${KOBOLD}/` }
    expect(placeBackend(lmStudioSlot, [entry], kobold)).toEqual({ kind: 'entry-existing', entryId: 'koboldcpp-0001' })
    // Negative controls: a free slot is still taken as before, the LU Engine
    // only ever lives in the slot, and Ollama keeps its own slot.
    expect(placeBackend({ ...lmStudioSlot, enabled: false }, [], kobold)).toEqual({ kind: 'slot' })
    expect(placeBackend(lmStudioSlot, [], { providerId: 'openai', baseUrl: engineSlot.baseUrl, managed: true })).toEqual({ kind: 'slot' })
    expect(placeBackend(lmStudioSlot, [], { providerId: 'ollama', baseUrl: 'http://localhost:11434' })).toEqual({ kind: 'slot' })
  })
})

describe('model ids', () => {
  it('an entry id routes to the entry, the old id to the slot', () => {
    expect(prefixModelName('openai', 'mistral-nemo', 'koboldcpp-1a2b')).toBe('openai:koboldcpp-1a2b::mistral-nemo')
    expect(openaiEntryOfModel('openai:koboldcpp-1a2b::mistral-nemo')).toBe('koboldcpp-1a2b')
    expect(getProviderIdFromModel('openai:koboldcpp-1a2b::mistral-nemo')).toBe('openai')
    expect(displayModelName('openai:koboldcpp-1a2b::mistral-nemo')).toBe('mistral-nemo')
    expect(modelBackendKey('openai:koboldcpp-1a2b::mistral-nemo')).toBe('openai:koboldcpp-1a2b')
    expect(isOpenAISlotModel('openai:koboldcpp-1a2b::mistral-nemo')).toBe(false)
    // Unchanged for everything that existed before.
    expect(openaiEntryOfModel('openai::qwen3-8b')).toBeNull()
    expect(isOpenAISlotModel('openai::qwen3-8b')).toBe(true)
    expect(modelBackendKey('openai::qwen3-8b')).toBe('openai')
    expect(prefixModelName('openai', 'qwen3-8b')).toBe('openai::qwen3-8b')
    expect(getProviderIdFromModel('llama3.1:8b')).toBe('ollama')
    expect(getProviderIdFromModel('anthropic::claude-x')).toBe('anthropic')
  })

  it('switching the slot off clears a slot pick but not a pick on an entry', async () => {
    const { useModelStore } = await import('../../../stores/modelStore')
    const kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
    useModelStore.setState({ activeModel: `openai:${kobold}::mistral-nemo` })
    useProviderStore.getState().setProviderConfig('openai', { enabled: false, disabledByUser: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(useModelStore.getState().activeModel).toBe(`openai:${kobold}::mistral-nemo`)
    // And the entry going dark does clear it.
    useProviderStore.getState().updateOpenAIEntry(kobold, { enabled: false, disabledByUser: true })
    await new Promise((r) => setTimeout(r, 0))
    expect(useModelStore.getState().activeModel).toBeNull()
  })
})

describe('stored settings of an older version', () => {
  it('a version 1 blob gets an empty entry list and keeps its slot', () => {
    const v1 = { providers: { openai: { ...lmStudioSlot } }, hideBackendSelector: true, engineOptedOut: true }
    const migrated = migrateProviderState(v1, 1) as Record<string, unknown>
    expect(migrated.openaiEntries).toEqual([])
    expect(migrated.providers).toEqual(v1.providers)
    expect(migrated.hideBackendSelector).toBe(true)
  })

  it('rehydrating a version 1 store keeps every old openai:: id on the old backend', async () => {
    const calls = twoServers()
    // State in memory first (a write persists it), the old blob on disk after.
    useProviderStore.setState({ openaiEntries: [{ ...lmStudioSlot, entryId: 'stale-0001' }] })
    localStorage.setItem('lu-providers', JSON.stringify({
      state: { providers: { openai: { ...lmStudioSlot } }, hideBackendSelector: false, engineOptedOut: true },
      version: 1,
    }))
    await useProviderStore.persist.rehydrate()
    clearProviderCache()
    const st = useProviderStore.getState()
    expect(st.openaiEntries).toEqual([])
    expect(st.providers.openai).toMatchObject({ name: 'LM Studio', baseUrl: LMS })
    expect(await say('openai::qwen3-8b')).toBe('from lm studio')
    expect(calls.at(-1)?.url).toBe(`${LMS}/chat/completions`)
    // And the store now writes version 2.
    useProviderStore.getState().setHideBackendSelector(true)
    expect(JSON.parse(localStorage.getItem('lu-providers')!).version).toBe(2)
    expect(JSON.parse(localStorage.getItem('lu-providers')!).state.openaiEntries).toEqual([])
  })

  it('a damaged entry list is cleaned instead of breaking the store', () => {
    const v2 = {
      providers: {},
      openaiEntries: [
        null, 'x', { entryId: 'Bad Id' }, { entryId: 'kobold-1', name: 'KoboldCpp', baseUrl: KOBOLD, enabled: true, managed: true },
        { entryId: 'kobold-1', name: 'Twin' },
      ],
    }
    const merged = useProviderStore.persist.getOptions().merge!(v2, useProviderStore.getState()) as { openaiEntries: ProviderConfig[] }
    expect(merged.openaiEntries).toEqual([
      { id: 'openai', entryId: 'kobold-1', name: 'KoboldCpp', baseUrl: KOBOLD, enabled: true, apiKey: '', isLocal: false },
    ])
  })
})

describe('a group chat with members from two backends', () => {
  it('each member answers from its own server, and the LU Engine is left alone', async () => {
    resetStore(engineSlot)
    const calls = twoServers()
    const lms = useProviderStore.getState().addOpenAIEntry({ name: 'LM Studio', baseUrl: LMS, isLocal: false })
    const kobold = useProviderStore.getState().addOpenAIEntry({ name: 'KoboldCpp', baseUrl: KOBOLD, isLocal: false })
    const rows = await pickerRows()
    const members = [`openai:${lms}::qwen3-8b`, `openai:${kobold}::mistral-nemo`]
    // Both are offered as participants.
    expect(groupChatCandidates(rows).map((m) => m.name)).toEqual(expect.arrayContaining(members))

    // What runGroupTurn does per speaker: ask whether our engine must load
    // the model (never for an entry), then stream through the model's provider.
    const answers: string[] = []
    for (const m of members) {
      expect(await builtinReloadNeeded(m)).toBeNull()
      answers.push(await say(m))
    }
    expect(answers).toEqual(['from lm studio', 'from koboldcpp'])
    expect(calls.filter((c) => c.url.endsWith('/chat/completions')).map((c) => [c.url, c.model])).toEqual([
      [`${LMS}/chat/completions`, 'qwen3-8b'],
      [`${KOBOLD}/chat/completions`, 'mistral-nemo'],
    ])

    // The history each one sees tags the other by its full id, so two
    // backends serving a model of the same name stay two speakers.
    const history = groupHistory([
      { id: '1', role: 'user', content: 'hi', timestamp: 1 },
      { id: '2', role: 'assistant', content: 'from lm studio', modelId: members[0], timestamp: 2 },
    ], members[1])
    expect(history[1]).toEqual({ role: 'user', content: `[${members[0]}] from lm studio` })
  })

  it('a member on a server elsewhere runs in the cloud lane, one on this machine in the local lane', () => {
    const facts = { openaiSlotIsLocal: true, ollamaBaseIsLocal: true, openaiEntryIsLocal: { 'lms-1': true, 'remote-1': false } }
    expect(laneOf('openai:lms-1::qwen3-8b', facts)).toBe('local')
    expect(laneOf('openai:remote-1::x', facts)).toBe('cloud')
    expect(laneOf('openai:unknown-1::x', facts)).toBe('cloud')
    expect(laneOf('openai::qwen3-8b', facts)).toBe('local')
  })
})
