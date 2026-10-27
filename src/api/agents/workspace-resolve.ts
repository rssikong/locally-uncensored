/**
 * Workspace resolver — shared lookup for Codex + Agent (Underlying
 * unification, Sprint C 2026-05).
 *
 * Lookup order:
 *   1. Per-chat workspace from `agentModeStore`
 *   2. `settings.defaultWorkspace`
 *   3. `null` — caller falls back to sandbox / per-thread cwd
 */

import type { AgentWorkspace } from '../../types/agent-workspace'
import { isMobile } from '../../lib/device-kind'

export interface ResolveInput {
  perChat: AgentWorkspace | undefined
  defaultWorkspace: AgentWorkspace | null
}

export function resolveWorkspace({ perChat, defaultWorkspace }: ResolveInput): AgentWorkspace | null {
  // A phone has no folder to pick: the agent always works in the sandbox of
  // this app, whatever an old store or a synced setting says.
  if (isMobile()) return null
  if (perChat) return perChat
  if (defaultWorkspace) return defaultWorkspace
  return null
}

/**
 * Folder-path extraction with the same precedence as resolveWorkspace.
 * Returns `null` when neither layer pinned a real path (sandbox or unset).
 */
export function resolveWorkspacePath({ perChat, defaultWorkspace }: ResolveInput): string | null {
  const ws = resolveWorkspace({ perChat, defaultWorkspace })
  if (!ws || ws.kind !== 'folder' || !ws.path) return null
  return ws.path
}
