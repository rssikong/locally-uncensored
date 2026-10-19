/**
 * GH #168: one group chat, two backends on separate GPUs.
 *
 * An LM Studio model (gemma-4-31b-it-2, loaded at 262144) and a KoboldCpp
 * model behind the Ollama API speak in the same group chat. Picking the
 * KoboldCpp model as the main model unloaded the LM Studio one, and the next
 * group round had to load it again.
 *
 * LM Studio is an attrappe here: `unloadLmStudioModel` and Ollama's
 * `unloadModel` only record that they were called.
 *
 * Run: npx vitest run src/stores/__tests__/ein-gruppensprecher-bleibt-geladen.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const unloadLmStudioModel = vi.fn(async (..._a: unknown[]) => undefined)
const unloadModel = vi.fn(async (..._a: unknown[]) => undefined)
const backendCall = vi.fn(async (..._a: unknown[]) => undefined)

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
vi.mock('../../api/backend', () => ({
  isTauri: () => true,
  backendCall: (...a: unknown[]) => backendCall(...a),
}))
vi.mock('../../api/ollama', () => ({ unloadModel: (...a: unknown[]) => unloadModel(...a) }))
vi.mock('../../api/lmstudio', () => ({ unloadLmStudioModel: (...a: unknown[]) => unloadLmStudioModel(...a) }))
vi.mock('../../api/engine', () => ({ activateBuiltinModel: vi.fn(async () => undefined) }))
vi.mock('../../lib/hf-to-provider', () => ({
  isLmStudioProvider: (n?: string) => (n || '').includes('LM Studio'),
}))

import { useModelStore, __resetDeferredLocalUnloadsForTests } from '../modelStore'
import { useChatStore } from '../chatStore'
import type { AIModel } from '../../types/models'

const LMS = 'openai::gemma-4-31b-it-2'
const KOBOLD = 'koboldcpp/gemma4'
const OTHER = 'llama3.1:8b'

const lms = { name: LMS, model: 'gemma-4-31b-it-2', size: 1, type: 'text', provider: 'openai', providerName: 'LM Studio' } as unknown as AIModel
const kobold = { name: KOBOLD, model: KOBOLD, size: 1, type: 'text' } as unknown as AIModel
const other = { name: OTHER, model: OTHER, size: 1, type: 'text' } as unknown as AIModel

beforeEach(() => {
  unloadLmStudioModel.mockClear()
  unloadModel.mockClear()
  backendCall.mockClear()
  __resetDeferredLocalUnloadsForTests()
  useChatStore.setState({ conversations: [], activeConversationId: null })
  useModelStore.setState({ models: [lms, kobold, other], activeModel: null })
})

function openGroup(models: string[]): string {
  const id = useChatStore.getState().createConversation(models[0], '')
  useChatStore.getState().setGroupModels(id, models)
  useChatStore.setState({ activeConversationId: id })
  return id
}

describe('switching the main model inside a group chat', () => {
  it('leaves the LM Studio speaker loaded when the KoboldCpp speaker becomes main', () => {
    openGroup([LMS, KOBOLD])
    useModelStore.getState().setActiveModel(LMS)
    useModelStore.getState().setActiveModel(KOBOLD)
    expect(unloadLmStudioModel).not.toHaveBeenCalled()
  })

  it('and the KoboldCpp speaker on the way back', () => {
    openGroup([LMS, KOBOLD])
    useModelStore.getState().setActiveModel(KOBOLD)
    useModelStore.getState().setActiveModel(LMS)
    expect(unloadModel).not.toHaveBeenCalled()
  })

  it('still unloads a model that is not one of the group speakers', () => {
    openGroup([LMS, KOBOLD])
    useModelStore.getState().setActiveModel(OTHER)
    useModelStore.getState().setActiveModel(LMS)
    expect(unloadModel).toHaveBeenCalledWith(OTHER)
  })
})

describe('a plain switch keeps the one model rule', () => {
  it('unloads the LM Studio model when no group chat is on screen', () => {
    useChatStore.getState().createConversation(LMS, '')
    useModelStore.getState().setActiveModel(LMS)
    useModelStore.getState().setActiveModel(KOBOLD)
    expect(unloadLmStudioModel).toHaveBeenCalledWith('gemma-4-31b-it-2')
  })
})
