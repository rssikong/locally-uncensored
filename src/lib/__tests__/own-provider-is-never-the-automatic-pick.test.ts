/**
 * A model of an extra slot with the user's own key (`openai-<slug>`) bills
 * per message. It is picked by the user, never put in by the app: not when
 * the model list lands without a pick, and not when a mode change needs a
 * stand-in. On a phone it would otherwise win over the model on the device,
 * because its rows come first in the list.
 */
import { describe, expect, it } from 'vitest'
import { pickForMode } from '../active-model-mode'
import { useModelStore } from '../../stores/modelStore'
import type { AIModel } from '../../types/models'

const hosted = { name: 'openai-groq::llama-3.3-70b', model: 'llama-3.3-70b', type: 'text', provider: 'openai-groq', providerName: 'Groq' }
const local = { name: 'openai::hermes-3-8b', model: 'hermes-3-8b', type: 'text', provider: 'openai', providerName: 'LU Engine' }

describe('own provider models and the automatic pick', () => {
  it('a mode change falls back to the local model behind it, not to the hosted head of the list', () => {
    const pick = pickForMode(null, [hosted, local] as never, 'local')
    expect(pick.next).toBe(local.name)
  })

  it('with only hosted rows there is no stand-in at all', () => {
    const pick = pickForMode(null, [hosted] as never, 'local')
    expect(pick.next).toBeNull()
  })

  it('a pick the user made on such a model stays', () => {
    const pick = pickForMode(hosted.name, [hosted, local] as never, 'local')
    expect(pick.change).toBe(false)
  })

  it('the model store does the same when the list lands', () => {
    useModelStore.setState({ activeModel: null, models: [] })
    useModelStore.getState().setModels([hosted, local] as unknown as AIModel[])
    expect(useModelStore.getState().activeModel).toBe(local.name)
    useModelStore.setState({ activeModel: null, models: [] })
    useModelStore.getState().setModels([hosted] as unknown as AIModel[])
    expect(useModelStore.getState().activeModel).toBeNull()
    useModelStore.setState({ activeModel: hosted.name })
    useModelStore.getState().setModels([hosted, local] as unknown as AIModel[])
    expect(useModelStore.getState().activeModel).toBe(hosted.name)
  })
})
