/**
 * REA 6.5.0 serves 207 tools. LU offers every external tool on every turn,
 * and with REA's that filled a local model's context: on the real run
 * (17.10.2026) Qwen 3.5 9B answered nothing. A turn now gets the REA tools its
 * words point at (lib/plugins/rea-tools.ts); the tools that run commands or
 * attach a debugger only when named; other MCP servers as before.
 *
 * Run: npx vitest run src/lib/plugins/__tests__/rea-offers-the-tools-a-turn-points-at.test.ts
 */
import { describe, it, expect } from 'vitest'
import { reaToolsFor, REA_SERVER_ID } from '../rea-tools'
import { selectRelevantTools } from '../../tool-selection'
import { DEFAULT_PERMISSIONS, type MCPToolDefinition } from '../../../api/mcp/types'

const NAMES = ['inspect_artifact', 'binary_overview', 'extract_artifact', 'list_unknowns', 'record_unknown', 'get_evidence_bundle',
  'analyze_javascript_application', 'inspect_electron_fuses', 'recover_javascript_sources', 'analyze_web_bundle',
  'trace_javascript_semantics', 'trace_application_feature', 'compare_source_to_bundle', 'trace_web_module_imports',
  'inspect_macho', 'inspect_signature', 'inspect_managed_artifact', 'inspect_go_binary', 'inspect_sqlite_database',
  'gdb_console', 'start_gdb_session', 'load_frida_script', 'start_frida_session', 'execute_rizin_command', 'cutter_command',
  'push_adb_file', 'install_adb_package', 'list_adb_devices', 'procedure_pseudo_code', 'open_binary']
// Padding up to the real count, so the test counts what a turn would carry.
const ALL = [...NAMES, ...Array.from({ length: 207 - NAMES.length }, (_, i) => `other_tool_${i}`)]

function tool(name: string, serverId: string): MCPToolDefinition {
  return { name, description: name, inputSchema: { type: 'object', properties: {}, required: [] }, category: 'workflow', source: 'external', serverId }
}

describe('REA tools a turn is offered', () => {
  it('an Electron question gets the core and the JavaScript group, nothing that runs commands', () => {
    const got = reaToolsFor('Examine the Electron app at /tmp/TinyNotes.app: which endpoints does it contact?', ALL)
    // open_binary first: every other REA tool answers "No app is open" without it (real run).
    expect(got).toEqual(expect.arrayContaining(['open_binary', 'inspect_artifact', 'analyze_javascript_application', 'inspect_electron_fuses', 'inspect_macho']))
    expect(got.length).toBeLessThanOrEqual(30)
    for (const risky of ['gdb_console', 'load_frida_script', 'execute_rizin_command', 'cutter_command', 'push_adb_file', 'install_adb_package']) {
      expect(got).not.toContain(risky)
    }
  })

  it('a turn about something else gets none', () => {
    expect(reaToolsFor('write me a poem about autumn', ALL)).toEqual([])
    expect(reaToolsFor('what is the capital of France', ALL)).toEqual([])
  })

  it('the debugger and device tools come when named', () => {
    expect(reaToolsFor('attach gdb to the process', ALL)).toEqual(expect.arrayContaining(['start_gdb_session', 'gdb_console']))
    expect(reaToolsFor('use frida on it', ALL)).toContain('start_frida_session')
    expect(reaToolsFor('list adb devices', ALL)).toContain('list_adb_devices')
  })

  it('offers only tools the server has', () => {
    expect(reaToolsFor('inspect the .NET dll', ['inspect_artifact'])).toEqual(['inspect_artifact'])
  })

  it('the agent selection carries the few, while another server keeps all of its tools', () => {
    const tools = [...ALL.map((n) => tool(n, REA_SERVER_ID)), tool('other_server_tool', 'srv-1')]
    const picked = selectRelevantTools('reverse engineer the Electron app in ~/Downloads/x.asar', tools, DEFAULT_PERMISSIONS)
    const rea = picked.filter((t) => t.serverId === REA_SERVER_ID)
    expect(rea.length).toBeGreaterThan(5)
    expect(rea.length).toBeLessThanOrEqual(30)
    expect(picked.map((t) => t.name)).toContain('other_server_tool')
    const plain = selectRelevantTools('hello there', tools, DEFAULT_PERMISSIONS)
    expect(plain.filter((t) => t.serverId === REA_SERVER_ID)).toEqual([])
    // A REA tool named verbatim is offered anyway.
    expect(selectRelevantTools('run gdb_console with bt', tools, DEFAULT_PERMISSIONS).map((t) => t.name)).toContain('gdb_console')
  })
})
