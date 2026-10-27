/**
 * Store policy: before content goes to LU Cloud for the first time the user
 * is asked. One function for every way a message leaves the chat: the
 * composer, "Regenerate", "Edit and send", and a send from another screen.
 */
import { useModelStore } from '../../../../stores/modelStore'
import { modelPlace } from '../../../lib/model-place'
import { CHAT_STRINGS } from '../../../strings/chat'
import { toast } from '../../../ui'
import { ensureAiConsent } from './policy'

/** True for a model of LU Cloud. */
export function isCloudModel(name: string | null | undefined): boolean {
  return modelPlace(name) === 'cloud'
}

/** False means nothing is sent, and the caller leaves the text where it is. */
export async function cloudAllowed(): Promise<boolean> {
  if (!isCloudModel(useModelStore.getState().activeModel)) return true
  if (await ensureAiConsent()) return true
  toast(CHAT_STRINGS.policy.notSent, { testid: 'consent-declined' })
  return false
}
