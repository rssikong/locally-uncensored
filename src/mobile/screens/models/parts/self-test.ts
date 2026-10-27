/**
 * The self test of the engine page: one short question to the loaded model,
 * through the same provider a chat turn uses. Says whether an answer came,
 * how long the first word took and how fast it ran.
 */
import { getProviderForModel } from '../../../../api/providers'
import type { ChatMessage } from '../../../../api/providers/types'
import { measureRun } from '../../../../lib/benchmark-run'
import { chatModelId } from './installed'

export interface SelfTestResult {
  ok: boolean
  /** Milliseconds until the first word. 0 when unknown. */
  firstMs: number
  tokensPerSec: number
}

const QUESTION = 'Reply with the single word: ready'
const LIMIT_MS = 60_000

export async function runSelfTest(modelName: string): Promise<SelfTestResult> {
  const controller = new AbortController()
  try {
    const { provider, modelId } = getProviderForModel(chatModelId(modelName))
    const messages: ChatMessage[] = [{ role: 'user', content: QUESTION }]
    const stream = provider.chatStream(modelId, messages, { temperature: 0, signal: controller.signal })
    const run = await measureRun(stream, () => true, { maxTokens: 64, maxMs: LIMIT_MS, onLimit: () => controller.abort() })
    return { ok: run.totalTokens > 0, firstMs: run.timeToFirstToken, tokensPerSec: run.tokensPerSec }
  } catch {
    controller.abort()
    return { ok: false, firstMs: 0, tokensPerSec: 0 }
  }
}
