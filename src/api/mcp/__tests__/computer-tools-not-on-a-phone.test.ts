/**
 * Computer control is a desktop matter: the Rust commands behind the two
 * tools are registered on a desktop only. The switch that turns the tools on
 * is stored, and a stored value travels in a backup. A phone that restored
 * the backup of a desktop with the switch on had `computer_use` and
 * `computer_task` in its catalog, and a model that called one got the error
 * of a command that does not exist.
 *
 * Run: npx vitest run src/api/mcp/__tests__/computer-tools-not-on-a-phone.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const device = vi.hoisted(() => ({ mobile: false }))
vi.mock('../../../lib/device-kind', async (orig) => ({ ...((await orig()) as object), isMobile: () => device.mobile }))

import { syncComputerUseTool } from '../computer-use-registration'
import { ToolRegistry } from '../tool-registry'
import { COMPUTER_TASK_TOOL_NAME, COMPUTER_USE_TOOL_NAME } from '../../../lib/computer/prompt'
import { hasComputerControl } from '../../../lib/capabilities'

const ROOT = resolve(__dirname, '../../../..')
const names = (registry: ToolRegistry): string[] => registry.getAll().map((t) => t.name)

beforeEach(() => { device.mobile = false })
afterEach(() => { device.mobile = false })

describe('the two computer control tools', () => {
  it('on a desktop the switch puts them in and takes them out, as before', () => {
    const registry = new ToolRegistry()
    expect(hasComputerControl()).toBe(true)
    syncComputerUseTool(registry, true)
    expect(names(registry)).toEqual(expect.arrayContaining([COMPUTER_USE_TOOL_NAME, COMPUTER_TASK_TOOL_NAME]))
    syncComputerUseTool(registry, false)
    expect(names(registry)).not.toContain(COMPUTER_USE_TOOL_NAME)
    expect(names(registry)).not.toContain(COMPUTER_TASK_TOOL_NAME)
  })

  it('on a phone the switch from a restored backup puts nothing in', () => {
    device.mobile = true
    const registry = new ToolRegistry()
    expect(hasComputerControl()).toBe(false)
    syncComputerUseTool(registry, true)
    expect(names(registry)).not.toContain(COMPUTER_USE_TOOL_NAME)
    expect(names(registry)).not.toContain(COMPUTER_TASK_TOOL_NAME)
  })

  it('a phone that had them from before loses them at the next sync', () => {
    const registry = new ToolRegistry()
    syncComputerUseTool(registry, true)
    device.mobile = true
    syncComputerUseTool(registry, true)
    expect(names(registry)).not.toContain(COMPUTER_USE_TOOL_NAME)
    expect(names(registry)).not.toContain(COMPUTER_TASK_TOOL_NAME)
  })
})

describe('the premises this rests on', () => {
  it('the switch is stored and travels in a backup', () => {
    expect(readFileSync(resolve(ROOT, 'src/lib/store-backup.ts'), 'utf8')).toContain("'locally-uncensored-computer'")
  })

  it('every computer command of the Rust side is registered on a desktop only', () => {
    const lib = readFileSync(resolve(ROOT, 'src-tauri/src/lib.rs'), 'utf8').split('\n')
    const entries = lib.map((line, i) => ({ line: line.trim(), before: (lib[i - 1] ?? '').trim() })).filter((e) => /^commands::computer::\w+,$/.test(e.line))
    expect(entries.length).toBeGreaterThanOrEqual(23)
    for (const entry of entries) expect(entry.before, entry.line).toBe('#[cfg(desktop)]')
  })

  it('the registration is the only place that puts the two tools in', () => {
    const index = readFileSync(resolve(ROOT, 'src/api/mcp/index.ts'), 'utf8')
    expect(index).toContain('syncComputerUseTool(toolRegistry, useComputerStore.getState().enabled)')
    expect(index).not.toContain('COMPUTER_USE_TOOL')
    expect(index).not.toContain('COMPUTER_TASK_TOOL')
  })
})
