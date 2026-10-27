/**
 * Discord feature request, 03.10.2026: "The ability to load binary
 * files (such as ROMs) directly". In Agent and Code a binary was already put in
 * the chat's working folder, but REA picks its tools by the words of a turn and
 * runs in its own folder. A ROM dropped in with "what is this?" got none of
 * REA's tools, and the model had only a path relative to a folder REA does not
 * work in. The turn is now routed with a line per attached binary, and the
 * block the model reads carries the full path.
 *
 * Run: npx vitest run src/lib/plugins/__tests__/an-attached-binary-brings-rea-its-opening-tools.test.ts
 */
import { describe, it, expect } from 'vitest'
import { reaToolsFor, REA_SERVER_ID } from '../rea-tools'
import { selectRelevantTools } from '../../tool-selection'
import { fileBlock, toolRoutingText } from '../../chat-files'
import { binaryReachLabel } from '../../../components/chat/ChatFileChip'
import { DEFAULT_PERMISSIONS, type MCPToolDefinition } from '../../../api/mcp/types'
import type { FileAttachment } from '../../../types/chat'

const REA = ['open_binary', 'binary_session', 'close_binary', 'inspect_artifact', 'binary_overview', 'extract_artifact', 'list_procedures',
  'procedure_pseudo_code', 'search_strings', 'inspect_managed_artifact', 'inspect_pe_resources', 'gdb_console', 'load_frida_script']

function tool(name: string): MCPToolDefinition {
  return { name, description: name, inputSchema: { type: 'object', properties: {}, required: [] }, category: 'workflow', source: 'external', serverId: REA_SERVER_ID }
}

const rom: FileAttachment = {
  name: 'pokemon.gba', size: 16 * 1024 * 1024, kind: 'Game Boy Advance ROM', sha256: 'ab'.repeat(32),
  summary: 'hex dump', binary: true, workspacePath: 'pokemon.gba',
  absolutePath: 'C:\\Users\\Dev\\agent-workspace\\chat-1\\pokemon.gba',
}

describe('an attached binary in Agent or Code', () => {
  it('COUNTER-CHECK: the typed words alone offered none of REA\'s tools', () => {
    expect(reaToolsFor('what is this?', REA)).toEqual([])
  })

  it('with the file in the routing text the turn gets REA\'s opening tools, nothing that runs commands', () => {
    const got = reaToolsFor(toolRoutingText('what is this?', [rom]), REA)
    expect(got).toEqual(expect.arrayContaining(['open_binary', 'inspect_artifact', 'binary_overview']))
    expect(got).not.toContain('gdb_console')
    expect(got).not.toContain('load_frida_script')
  })

  it('a Windows program also brings the .exe group', () => {
    const exe = { ...rom, name: 'game.exe', kind: 'Windows executable (PE)', workspacePath: 'game.exe' }
    expect(reaToolsFor(toolRoutingText('', [exe]), REA)).toEqual(expect.arrayContaining(['inspect_managed_artifact', 'inspect_pe_resources']))
  })

  it('and the whole selection carries open_binary next to the file tools', () => {
    const builtin: MCPToolDefinition[] = ['file_read', 'shell_execute', 'web_search'].map((name) => ({ ...tool(name), source: 'builtin' as const, serverId: undefined, category: 'filesystem' as const }))
    const picked = selectRelevantTools(toolRoutingText('what is this?', [rom]), [...builtin, ...REA.map(tool)], DEFAULT_PERMISSIONS).map((t) => t.name)
    expect(picked).toContain('open_binary')
  })

  it('a text file or a file that is not in the folder changes nothing', () => {
    const text = { ...rom, name: 'notes.txt', kind: 'Text', binary: false }
    expect(toolRoutingText('hi', [text])).toBe('hi')
    expect(toolRoutingText('hi', [{ ...rom, workspacePath: undefined }])).toBe('hi')
    expect(toolRoutingText('hi', undefined)).toBe('hi')
  })

  it('the block names the full path for tools outside the working folder', () => {
    const block = fileBlock(rom, 'workspace')
    expect(block).toContain('Path in your working folder: pokemon.gba')
    expect(block).toContain('Full path on this computer: C:\\Users\\Dev\\agent-workspace\\chat-1\\pokemon.gba')
    expect(block).toContain('reverse engineering tool that opens a file by its path')
    expect(block).toContain('Do not run the file')
    // Stored before 3.0.8: no full path, the block as before.
    const old = fileBlock({ ...rom, absolutePath: undefined }, 'workspace')
    expect(old).not.toContain('Full path')
    expect(old).not.toContain('reverse engineering tool')
  })

  it('the chip says where the binary goes', () => {
    expect(binaryReachLabel(rom)).toBe('file in the working folder')
    const draft = { ...rom, workspacePath: undefined, absolutePath: undefined }
    expect(binaryReachLabel(draft, true)).toBe('goes to the working folder')
    expect(binaryReachLabel(draft, false)).toBe('summary only')
    expect(binaryReachLabel({ ...draft, name: 'a.txt', binary: false }, false)).toBeNull()
  })
})
