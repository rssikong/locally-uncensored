// MCP Tool System — entry point

export { toolRegistry, ToolRegistry } from './tool-registry'
export { registerBuiltinTools } from './builtin-tools'
export type { MCPToolDefinition, ToolCategory, PermissionLevel, PermissionMap, MCPServerConfig } from './types'
export { DEFAULT_PERMISSIONS } from './types'

// Initialize: register all built-in tools on import
import { toolRegistry } from './tool-registry'
import { registerBuiltinTools } from './builtin-tools'

registerBuiltinTools(toolRegistry)

// Computer control is off unless the user turns it on, and a tool that is off
// is not in the catalog at all: not in a prompt, not in a request, not in a
// sub-agent's list. The store decides, now and on every change.
import { useComputerStore } from '../../stores/computerStore'
import { syncComputerUseTool } from './computer-use-registration'

syncComputerUseTool(toolRegistry, useComputerStore.getState().enabled)
useComputerStore.subscribe((state, before) => {
  if (state.enabled !== before.enabled) syncComputerUseTool(toolRegistry, state.enabled)
})

// REA (lib/plugins/rea.ts): its server runs while its switch under Plugins is
// on, from the start of the app and on every change of the switch.
// Loaded in the desktop app only, where there is a process to start.
import { useSettingsStore } from '../../stores/settingsStore'
import { isTauri } from '../backend'

const syncRea = (on: boolean) =>
  void import('../../lib/plugins/rea-runtime').then((m) => m.syncReaPlugin(on))
if (isTauri()) {
  if (useSettingsStore.getState().settings.reaPluginEnabled) syncRea(true)
  useSettingsStore.subscribe((state, before) => {
    const on = state.settings.reaPluginEnabled === true
    if (on !== (before.settings.reaPluginEnabled === true)) syncRea(on)
  })
}
