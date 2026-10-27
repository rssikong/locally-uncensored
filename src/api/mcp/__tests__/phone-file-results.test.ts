/**
 * Mobile, acceptance on Android with 8 GB, B11: the file tools named the
 * private folder of the app in their results, and the model repeated it.
 * Through the real registry, same pattern as web-tools-fail-honestly.test.ts.
 *
 * Run: npx vitest run src/api/mcp/__tests__/phone-file-results.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

let mobile = true
vi.mock('../../../lib/device-kind', async (orig) => ({
  ...(await orig() as object),
  isMobile: () => mobile,
  isAndroid: () => mobile,
  isIOS: () => false,
}))

const ROOT = '/data/user/0/com.example.app/files/agent-workspace/new-chat-15c857'
const backendCall = vi.fn(async (cmd: unknown, _args?: unknown): Promise<unknown> => {
  if (cmd === 'fs_write') return { status: 'saved', path: `${ROOT}/notes.md`, bytes: 5 }
  if (cmd === 'fs_read') return { content: 'alpha beta', path: `${ROOT}/notes.md` }
  if (cmd === 'fs_list') return { entries: [{ name: 'notes.md', path: `${ROOT}/notes.md`, size: 5, isDir: false }, { name: 'drafts', path: `${ROOT}/drafts`, size: 0, isDir: true }] }
  if (cmd === 'fs_search') return { results: [{ file: `${ROOT}/drafts/plan.md`, matches: [{ line: 2, text: 'alpha' }] }] }
  return {}
})

vi.mock('../../backend', () => ({ backendCall: (cmd: unknown, args?: unknown) => backendCall(cmd, args) }))
vi.mock('../../agents/sub-agent', () => ({
  DELEGATE_TASK_TOOL_DEF: { name: 'delegate_task', description: '', category: 'system', inputSchema: {} },
  buildDelegateExecutor: () => async () => 'stub',
}))
vi.mock('../../../lib/workflow-engine', () => ({ WorkflowEngine: class {} }))
vi.mock('../../../stores/settingsStore', () => ({ useSettingsStore: { getState: () => ({ settings: {} }) } }))

import { registerBuiltinTools } from '../builtin-tools'
import { ToolRegistry } from '../tool-registry'

const registry = new ToolRegistry()
registerBuiltinTools(registry)

beforeEach(() => { mobile = true })

describe('file tools on a phone name the file, not the folder of the app', () => {
  it('file_write', async () => {
    const out = await registry.execute('file_write', { path: 'notes.md', content: 'alpha' }) as string
    expect(out).toBe('File saved: notes.md. The user finds it under "Files in this chat".')
  })

  it('file_edit', async () => {
    const out = await registry.execute('file_edit', { path: 'notes.md', old_string: 'alpha', new_string: 'gamma' }) as string
    expect(out).toContain('Edited notes.md (1 replacement).')
    expect(out).not.toContain('/data/')
  })

  it('file_list and file_search', async () => {
    const list = await registry.execute('file_list', { path: '.' }) as string
    expect(list).toContain('notes.md')
    expect(list).toContain('[DIR] drafts')
    expect(list).not.toContain('/data/')
    expect(list).not.toContain('agent-workspace')
    const found = await registry.execute('file_search', { path: '.', pattern: 'alpha' }) as string
    expect(found.startsWith('drafts/plan.md\n')).toBe(true)
    expect(found).not.toContain('/data/')
  })
})

describe('Gegenprobe: the desktop keeps the full path', () => {
  it('file_write and file_list', async () => {
    mobile = false
    expect(await registry.execute('file_write', { path: 'notes.md', content: 'alpha' })).toBe(`File saved: ${ROOT}/notes.md`)
    expect(await registry.execute('file_list', { path: '.' })).toContain(`${ROOT}/notes.md`)
  })
})
