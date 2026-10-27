/**
 * The client of an extra OpenAI-compatible slot (`openai-<slug>`).
 *
 * Thin composition over OpenAIProvider, the same shape LuCloudProvider has.
 * The only difference to the shared `openai` slot is the name on the rows:
 * the delegate reports `provider: 'openai'`, and a row carrying that would be
 * prefixed `openai::` and sent to whoever holds the shared slot (on a phone
 * that is the on device engine). So the model list is rebranded to this slot.
 *
 * An extra slot is never app-managed: `managed` and `displaced` are dropped
 * before the delegate sees the config, so nothing here can start, stop or
 * wait for the built-in engine.
 */
import type {
  ChatMessage, ChatOptions, ChatStreamChunk, CompatProviderId, ProviderClient,
  ProviderConfig, ProviderModel, ToolCall, ToolDefinition,
} from './types'
import type { ResolvedContextWindow } from '../../lib/context-source'
import { OpenAIProvider } from './openai-provider'

export class CompatSlotProvider implements ProviderClient {
  readonly id: CompatProviderId
  private readonly name: string
  private readonly inner: OpenAIProvider

  constructor(config: ProviderConfig) {
    this.id = config.id as CompatProviderId
    this.name = config.name
    this.inner = new OpenAIProvider({
      id: 'openai',
      name: config.name,
      enabled: config.enabled,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      isLocal: config.isLocal,
    })
  }

  chatStream(model: string, messages: ChatMessage[], options?: ChatOptions): AsyncGenerator<ChatStreamChunk> {
    return this.inner.chatStream(model, messages, options)
  }

  chatWithTools(
    model: string,
    messages: ChatMessage[],
    tools: ToolDefinition[],
    options?: ChatOptions,
  ): Promise<{ content: string; toolCalls: ToolCall[]; promptEvalCount?: number; evalCount?: number; thinking?: string }> {
    return this.inner.chatWithTools(model, messages, tools, options)
  }

  async listModels(): Promise<ProviderModel[]> {
    const models = await this.inner.listModels()
    return models.map((m) => ({ ...m, provider: this.id, providerName: this.name }))
  }

  checkConnection(): Promise<boolean> {
    return this.inner.checkConnection()
  }

  getContextLength(model: string): Promise<number> {
    return this.inner.getContextLength(model)
  }

  getContextWindow(model: string, signal?: AbortSignal): Promise<ResolvedContextWindow> {
    return this.inner.getContextWindow(model, signal)
  }

  contextWindowKey(model: string): string {
    return this.inner.contextWindowKey(model)
  }

  serverToolSupport(model: string): Promise<boolean | undefined> {
    return this.inner.serverToolSupport(model)
  }

  loadedContextLength(model: string): Promise<number | null> {
    return this.inner.loadedContextLength(model)
  }
}
