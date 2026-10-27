import type { ToolRegistry } from './tool-registry'
import { COMPUTER_USE_TOOL, executeComputerUse } from '../computer-use'
import { COMPUTER_TASK_TOOL, executeComputerTask } from '../computer-task'
import { hasComputerControl } from '../../lib/capabilities'

/** Put the computer control tools into the catalog, or take them out.
 *
 *  On a phone they stay out whatever the switch says. The phone has no
 *  setting for it, but the switch travels in a backup: restored from a
 *  desktop that had it on, the two tools stood in the catalog of a device
 *  that has none of the commands behind them. */
export function syncComputerUseTool(registry: ToolRegistry, enabled: boolean): void {
  if (enabled && hasComputerControl()) {
    registry.registerBuiltin(COMPUTER_USE_TOOL, executeComputerUse)
    registry.registerBuiltin(COMPUTER_TASK_TOOL, executeComputerTask)
  } else {
    registry.withdrawBuiltin(COMPUTER_USE_TOOL.name)
    registry.withdrawBuiltin(COMPUTER_TASK_TOOL.name)
  }
}
