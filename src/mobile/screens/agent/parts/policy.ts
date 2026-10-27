/**
 * The one place this strand reads the store rules from: the scaffold module
 * src/mobile/policy/ (report sheet, consent sheet, switches).
 */
import { getProviderIdFromModel } from '../../../../api/providers/model-name'
import { toast } from '../../../ui'
import { leavesPhone } from '../../../lib/model-place'
import { AGENT_STRINGS as T } from '../../../strings/agent'
import { ensureAiConsent, openReport, storePolicy } from '../../../policy'

export { ensureAiConsent, openReport, storePolicy }
export type { ReportTarget, StorePolicy } from '../../../policy'

/** Does this model run on LU Cloud? */
export function isCloudModel(model: string | null | undefined): boolean {
  if (!model) return false
  try {
    return getProviderIdFromModel(model) === 'lu-cloud'
  } catch {
    return false
  }
}

/**
 * Before anything of this strand sends to a cloud model: ask once. Resolves
 * false when the user said no; then nothing was sent and a toast says so.
 * On device models never ask.
 */
export async function consentFor(models: ReadonlyArray<string | null | undefined>): Promise<boolean> {
  if (!models.some(isCloudModel)) return true
  const yes = await ensureAiConsent()
  if (!yes) toast(T.policy.consentDeclined, { testid: 'agent-consent-declined' })
  return yes
}

/** Report an answer written by a model (an agent answer is an AI answer like any other). */
export function reportAnswer(input: { id: string; model: string | null | undefined; text: string }): void {
  openReport({
    kind: 'message',
    id: input.id,
    model: input.model ?? 'unknown',
    source: leavesPhone(input.model) ? 'cloud' : 'local',
    excerpt: input.text.slice(0, 500),
  })
}
