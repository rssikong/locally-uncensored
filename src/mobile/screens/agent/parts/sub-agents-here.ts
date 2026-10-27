/**
 * Does the chat model of this phone get sub agents, as a hook for the pages.
 * The rule itself is lib/phone-sub-agents.ts, the same one the tool registry asks.
 */
import { subAgentsOffered } from '../../../../lib/phone-sub-agents'
import { useModelStore } from '../../../../stores/modelStore'

export function useSubAgentsOffered(): boolean {
  return useModelStore((s) => subAgentsOffered(s.activeModel))
}
