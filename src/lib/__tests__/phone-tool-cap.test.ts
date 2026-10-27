/**
 * Round 9, N15 (acceptance on Android with 8 GB): Agent on, one message "Say
 * hello in three words.", and the gauge said "Context 42%". The tool text
 * took almost half of the 4K window before a word was said.
 *
 * A phone with a small window gets the short tool list of Small Model Mode.
 * Measured here on the request such a phone builds, with the estimate of the
 * phone (lib/phone-context-fit.ts, held against a real tokenizer in
 * phone-token-estimate.test.ts).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DESKTOPS, HANDHELDS, standOn } from '../../test-support/devices'
import { ToolRegistry } from '../../api/mcp/tool-registry'
import { registerBuiltinTools } from '../../api/mcp/builtin-tools'
import { DEFAULT_PERMISSIONS } from '../../api/mcp/types'
import { mobilePermissionDefaults } from '../mobile-permission-defaults'
import { buildHermesToolPrompt } from '../../api/hermes-tool-calling'
import { SMALL_MODEL_MAX_TOOLS, selectRelevantToolsAsync, toolSelectionOpts } from '../tool-selection'
import { PHONE_TOOL_CAP_MAX_CTX, phoneTokens, phoneToolCapApplies, withPhoneToolCap } from '../phone-context-fit'

afterEach(() => {
  vi.unstubAllGlobals()
})

const HELLO = 'Say hello in three words.'

/** The tools a run is offered for this question, as the agent hook asks for them (the plan tool is opt-in and not asked for here). */
async function offered(question: string, ctx: number) {
  const registry = new ToolRegistry()
  registerBuiltinTools(registry)
  const tools = await selectRelevantToolsAsync(
    question,
    registry.getAll(),
    mobilePermissionDefaults(DEFAULT_PERMISSIONS),
    withPhoneToolCap(toolSelectionOpts(false), ctx, SMALL_MODEL_MAX_TOOLS),
  )
  return tools.filter((tool) => tool.name !== 'todo_write')
}

const names = (tools: { name: string }[]) => tools.map((tool) => tool.name)
const promptTokens = (tools: Parameters<typeof buildHermesToolPrompt>[0]) => phoneTokens(buildHermesToolPrompt(tools))

describe('which window gets the short tool list', () => {
  it('a phone with a window up to 8K, and no other', () => {
    standOn(HANDHELDS[0])
    expect(phoneToolCapApplies(4096)).toBe(true)
    expect(phoneToolCapApplies(PHONE_TOOL_CAP_MAX_CTX)).toBe(true)
    expect(phoneToolCapApplies(PHONE_TOOL_CAP_MAX_CTX + 1)).toBe(false)
    expect(phoneToolCapApplies(131072)).toBe(false)
    expect(phoneToolCapApplies(0)).toBe(false)
  })

  it('never a desktop, whatever its window', () => {
    for (const device of DESKTOPS) {
      standOn(device)
      expect(phoneToolCapApplies(4096), device).toBe(false)
      const opts = toolSelectionOpts(false)
      expect(withPhoneToolCap(opts, 4096, SMALL_MODEL_MAX_TOOLS), device).toBe(opts)
    }
  })

  it('a cap that is already set stays what it is', () => {
    standOn(HANDHELDS[0])
    const small = toolSelectionOpts(true)
    expect(withPhoneToolCap(small, 4096, 99)).toBe(small)
    expect(withPhoneToolCap({}, 4096, 6)).toEqual({ maxTools: 6 })
    const large = {}
    expect(withPhoneToolCap(large, 32768, 6)).toBe(large)
  })
})

describe('the request of the report: Agent on, "Say hello in three words."', () => {
  for (const device of HANDHELDS) {
    it(`${device}: the tool text is at least 400 tokens shorter`, async () => {
      standOn(device)
      const before = await offered(HELLO, 32768)
      const after = await offered(HELLO, 4096)
      // What it was: the two folder tools rode along on a question about neither a file nor the web.
      expect(names(before)).toEqual(expect.arrayContaining(['file_list', 'file_search']))
      expect(names(after)).not.toContain('file_list')
      expect(names(after)).not.toContain('file_search')
      expect(names(after)).toEqual(expect.arrayContaining(['file_read', 'file_write', 'file_edit', 'web_search', 'web_fetch']))
      expect(promptTokens(before) - promptTokens(after)).toBeGreaterThanOrEqual(400)
      // Shorter, not short: five schemas as text are still about 1500 tokens by this estimate.
      expect(after).toHaveLength(5)
      expect(promptTokens(after)).toBeLessThan(1600)
    })

    it(`${device}: a question about the folder still gets the folder tools, a named tool passes the cap`, async () => {
      standOn(device)
      expect(names(await offered('List the files in my folder and find the one about taxes', 4096))).toEqual(
        expect.arrayContaining(['file_list', 'file_search']),
      )
      expect(names(await offered('Say hello, then call file_search for "hello"', 4096))).toContain('file_search')
    })
  }
})

describe('the agent hook', () => {
  const hook = readFileSync(resolve(__dirname, '../../hooks/useAgentChat.ts'), 'utf8')

  it('asks for the window on a phone only, and caps both tool selections with it', () => {
    expect(hook).toMatch(/const phoneToolCtx: number = singleModelSlot\(\)\s*\? await resolveAgentNumCtx\(/)
    expect(hook.match(/withPhoneToolCap\(/g)).toHaveLength(2)
    expect(hook.match(/phoneToolCtx, SMALL_MODEL_MAX_TOOLS/g)).toHaveLength(2)
  })
})
