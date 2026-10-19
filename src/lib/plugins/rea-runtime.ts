// REA running: the switch under Plugins (settings.reaPluginEnabled) starts
// and stops one MCP server, and its tools join the registry while it runs.
// The order of a start: the pinned package (fetched once and checked every
// time), Node.js, then the server. Each step that fails says why in the row.

import { create } from 'zustand'
import { toolRegistry } from '../../api/mcp/tool-registry'
import type { MCPExternalClient } from '../../api/mcp/external-client'
import { isTauri } from '../../api/backend'
import { REA_PLUGIN, reaFetch, reaServerConfig } from './rea'
import { reaArgsFromModel, reaResultForModel, reaToolForModel } from './rea-model'

export type ReaPhase = 'off' | 'fetching' | 'starting' | 'on' | 'error'

interface ReaRuntimeState {
  phase: ReaPhase
  /** How many tools REA gave the agents. */
  tools: number
  error: string | null
}

export const useReaRuntime = create<ReaRuntimeState>(() => ({ phase: 'off', tools: 0, error: null }))

let client: MCPExternalClient | null = null
/** Bumped by every start and stop, so a start that a stop overtook gives up. */
let turn = 0

export async function startRea(): Promise<void> {
  const mine = ++turn
  const set = useReaRuntime.setState
  if (!isTauri()) {
    set({ phase: 'error', tools: 0, error: 'REA runs in the desktop app.' })
    return
  }
  try {
    set({ phase: 'fetching', tools: 0, error: null })
    const status = await reaFetch()
    if (mine !== turn) return
    const config = reaServerConfig(status)
    set({ phase: 'starting' })
    const { MCPExternalClient } = await import('../../api/mcp/external-client')
    const next = new MCPExternalClient(config, {
      // The process died on its own: its tools go, and the row says so.
      onExit: (id) => {
        toolRegistry.unregisterServer(id)
        if (client === next) client = null
        set({ phase: 'error', tools: 0, error: 'REA stopped on its own. Switch it off and on to start it again.' })
      },
    })
    const tools = await next.connect()
    if (mine !== turn) {
      await next.disconnect()
      return
    }
    client = next
    // The model sees earlier records by reference and results as their facts
    // (lib/plugins/rea-model.ts).
    const offered = tools.map(reaToolForModel)
    const schemas = new Map(offered.map((t) => [t.name, t.inputSchema]))
    toolRegistry.registerExternal(
      REA_PLUGIN.serverId,
      offered,
      async (name, args) => reaResultForModel(await next.callTool(name, reaArgsFromModel(schemas.get(name), args) as typeof args)),
    )
    set({ phase: 'on', tools: tools.length, error: null })
  } catch (err) {
    if (mine !== turn) return
    set({ phase: 'error', tools: 0, error: err instanceof Error ? err.message : String(err) })
  }
}

export async function stopRea(): Promise<void> {
  turn++
  const was = client
  client = null
  toolRegistry.unregisterServer(REA_PLUGIN.serverId)
  useReaRuntime.setState({ phase: 'off', tools: 0, error: null })
  await was?.disconnect()
}

/** Follow the switch: on starts REA, off stops it. */
export function syncReaPlugin(enabled: boolean): Promise<void> {
  return enabled ? startRea() : stopRea()
}
