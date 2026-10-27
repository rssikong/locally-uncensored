/**
 * Agent Strategy Resolution — Shared utility for determining tool calling strategy.
 *
 * Extracted from useAgentChat.ts so both the agent chat and workflow engine
 * can reuse the same logic.
 *
 * G32b (follow-up to G32, 2026-08-07): this copy had drifted behind the Agent
 * surface. It still routed every non-Ollama provider straight to 'native' via
 * isNativeToolProvider, but providerId 'openai' also covers LM Studio, vLLM
 * and llama.cpp — a local model whose server declared it tool-less got a
 * native `tools` payload in every workflow step. Now the same layered
 * resolution as useAgentChat runs for every provider: proven capability
 * cache > the server's own supportsTools (LM Studio feeds it from its
 * capabilities list) > family name. Genuine cloud models declare true or
 * nothing and resolve to native exactly as before.
 */

import { isCompatProviderId } from '../api/providers/compat-id'
import { getProviderIdFromModel, getProviderForModel } from '../api/providers'
import { type ToolCallingStrategy } from './model-compatibility'
import { toolStrategyFor, applyLiveCapabilities } from './tool-support'
import { getModelCapabilities } from '../api/ollama'
import { useModelStore } from '../stores/modelStore'
import { agentVariantExists, createAgentVariant, getAgentModelName, canFixModel } from '../api/model-template-fix'

export interface ResolvedStrategy {
  strategy: ToolCallingStrategy
  modelToUse: string
  /** The raw id as the provider knows it, before any agent-variant swap.
   *  Context resolution (num_ctx) keys on this, not on modelToUse. */
  modelId: string
  providerId: string
  provider: ReturnType<typeof getProviderForModel>['provider']
}

/**
 * Resolve the tool calling strategy for a given model.
 * Layered resolution for every provider; Ollama additionally gets
 * template_fix (creates agent variant) and the /api/show capability overlay,
 * because both speak Ollama's own API and must never probe another server.
 */
export async function resolveToolCallingStrategy(modelName: string): Promise<ResolvedStrategy> {
  const providerId = getProviderIdFromModel(modelName)
  const { provider, modelId } = getProviderForModel(modelName)

  let modelToUse = modelId
  const pickerMeta = useModelStore.getState().models.find((m) => m.name === modelName)
  let strategy = toolStrategyFor({
    name: modelName,
    supportsTools: pickerMeta && pickerMeta.type === 'text' ? pickerMeta.supportsTools : undefined,
  })

  if (providerId === 'ollama') {
    if (strategy === 'template_fix') {
      const agentName = getAgentModelName(modelId)
      const exists = await agentVariantExists(modelId)

      if (exists) {
        modelToUse = agentName
        strategy = 'native'
      } else {
        const { fixable } = await canFixModel(modelId)
        if (fixable) {
          try {
            modelToUse = await createAgentVariant(modelId)
            strategy = 'native'
          } catch {
            strategy = 'hermes_xml'
          }
        } else {
          strategy = 'hermes_xml'
        }
      }
    }

    // G26 parity: Ollama itself knows whether this model's template can parse
    // tools; one cached /api/show answers it before the first request.
    if (strategy === 'native') {
      strategy = applyLiveCapabilities(strategy, await getModelCapabilities(modelToUse))
    }
  }

  // G37b (R21d wire proof, 2026-08-08): the same live overlay for the local
  // OpenAI-compat backends. The picker row can be silent here — useModels
  // skips listModels for the managed built-in engine and synthesizes rows
  // from the downloaded GGUFs, so the G37 listing probe never ran and the
  // run still sent a native `tools` payload the bundled llama-server
  // silently drops. Ask the server itself before the first request; only a
  // hard `false` downgrades, cloud endpoints answer without a network call.
  if (strategy === 'native' && (providerId === 'openai' || isCompatProviderId(providerId)) && provider.serverToolSupport) {
    if ((await provider.serverToolSupport(modelToUse)) === false) strategy = 'hermes_xml'
  }

  return { strategy, modelToUse, modelId, providerId, provider }
}
