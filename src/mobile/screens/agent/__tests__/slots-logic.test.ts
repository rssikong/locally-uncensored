/** Pure logic behind the three chat slots and the approval sheet. */
import { describe, expect, it } from 'vitest'
import type { AgentToolCall } from '../../../../types/agent-mode'
import { nextWatchStep } from '../parts/approval-watch'
import { previewOf, summarizeCalls, viewBlocks } from '../parts/blocks'
import { hasCarry } from '../parts/chat-ref'
import { switchLevel } from '../parts/options/chat-settings'
import { isOptionsSub, subPageOf } from '../parts/options/sections'
import { groupById, hasChatLevel, levelOf, PERMISSION_GROUPS } from '../parts/permission-groups'
import { argLines, callState, groupOfTool, hostOf, toolTarget, toolTitle } from '../parts/tool-words'

const call = (over: Partial<AgentToolCall>): AgentToolCall => ({ id: 'c', toolName: 'web_search', args: {}, status: 'completed', timestamp: 1, ...over })

describe('message blocks', () => {
  it('lists tool calls and notes in order and leaves the answer text out', () => {
    const view = viewBlocks({
      thinking: '  I look it up.  ',
      agentBlocks: [
        { id: 'n1', phase: 'planning', content: 'First search.', timestamp: 1 },
        { id: 'b1', phase: 'tool_call', content: '', timestamp: 2, toolCalls: [call({ id: 'a' }), call({ id: 'b', toolName: 'web_fetch' })] },
        { id: 'b2', phase: 'tool_call', content: '', timestamp: 3, toolCall: call({ id: 'legacy' }) },
        { id: 'x', phase: 'answer', content: 'The answer', timestamp: 4 },
      ],
    })
    expect(view.thinking).toBe('I look it up.')
    expect(view.calls.map((c) => c.id)).toEqual(['a', 'b', 'legacy'])
    expect(view.items.map((i) => i.kind)).toEqual(['note', 'call', 'call', 'call'])
  })

  it('an answer without blocks has nothing to show', () => {
    expect(viewBlocks({})).toEqual({ thinking: '', items: [], calls: [] })
  })

  it('the band of several steps says running, failed or done', () => {
    expect(summarizeCalls([call({}), call({ status: 'running' })]).state).toBe('running')
    expect(summarizeCalls([call({}), call({ status: 'failed', id: 'f' })])).toMatchObject({ count: 2, failed: 1, state: 'failed' })
    expect(summarizeCalls([call({}), call({ id: 'd' })]).state).toBe('done')
  })

  it('a long result is cut for the first view and says how much is left', () => {
    expect(previewOf('abc', 10)).toEqual({ shown: 'abc', more: 0 })
    expect(previewOf('abcdefghij-rest', 10)).toEqual({ shown: 'abcdefghij', more: 5 })
  })
})

describe('tool words', () => {
  it('names a tool in words and falls back to its name without underscores', () => {
    expect(toolTitle('web_search')).not.toContain('_')
    expect(toolTitle('some_new_tool')).toBe('some new tool')
  })

  it('shows what a step touches, never a whole path', () => {
    expect(toolTarget('web_search', { query: 'cats' })).toBe('cats')
    expect(toolTarget('web_fetch', { url: 'https://example.com/a/b?c=1' })).toBe('example.com')
    expect(toolTarget('file_write', { path: '/data/chats/abc/notes.txt' })).toContain('notes.txt')
    expect(toolTarget('file_write', { path: '/data/chats/abc/notes.txt' })).not.toContain('/data')
    expect(toolTarget('unknown_tool', { a: 1 })).toBe('')
    expect(toolTarget('web_search', null)).toBe('')
  })

  it('reads a host from an address with or without a scheme', () => {
    expect(hostOf('example.com/path')).toBe('example.com')
    expect(hostOf('http://a.b:8080/x')).toBe('a.b:8080')
  })

  it('maps the status of a call to the six states a row shows', () => {
    expect(callState('pending_approval')).toBe('waiting')
    expect(callState('running')).toBe('running')
    expect(callState('failed')).toBe('failed')
    expect(callState('rejected')).toBe('denied')
    expect(callState('stopped')).toBe('stopped')
    expect(callState('completed')).toBe('done')
    expect(callState('cached')).toBe('done')
  })

  it('lists the input of a call and cuts long values', () => {
    const lines = argLines({ path: 'a.txt', n: 3, text: 'x'.repeat(50) }, 10)
    expect(lines[0]).toEqual({ key: 'path', value: 'a.txt' })
    expect(lines[1]).toEqual({ key: 'n', value: '3' })
    expect(lines[2].value.startsWith('xxxxxxxxxx ')).toBe(true)
    expect(argLines('nope')).toEqual([])
  })

  it('knows which permission group a tool belongs to', () => {
    expect(groupOfTool('web_fetch')).toBe('web')
    expect(groupOfTool('file_write')).toBe('files')
    expect(groupOfTool('run_workflow')).toBe('workflows')
    expect(groupOfTool('delegate_task')).toBe('subagents')
    expect(groupOfTool('shell_execute')).toBeNull()
  })
})

describe('permission groups', () => {
  const global = { filesystem: 'confirm', web: 'auto', workflow: 'confirm', system: 'auto', terminal: 'blocked', desktop: 'blocked', image: 'blocked', video: 'blocked' } as never

  it('a phone shows four groups and none of the desktop only ones', () => {
    expect(PERMISSION_GROUPS.map((g) => g.id)).toEqual(['web', 'files', 'workflows', 'subagents'])
  })

  it('the level of a chat wins over the app level', () => {
    const web = groupById('web')
    expect(levelOf(web, global, {})).toBe('auto')
    expect(levelOf(web, global, {}, { web: 'blocked' })).toBe('blocked')
    expect(hasChatLevel(web, { web: 'blocked' }, global)).toBe(true)
    expect(hasChatLevel(web, {}, global)).toBe(false)
    // Round 16, F12: an entry equal to the level of the app is no change.
    expect(hasChatLevel(web, { web: 'auto' }, global)).toBe(false)
  })

  it('sub agents are one tool: its own override, else the level of its category', () => {
    const sub = groupById('subagents')
    expect(levelOf(sub, global, {})).toBe('auto')
    expect(levelOf(sub, global, { delegate_task: 'confirm' })).toBe('confirm')
    expect(sub.perChat).toBe(false)
    expect(hasChatLevel(sub, { system: 'blocked' } as never, global)).toBe(false)
  })

  it('a switch that says On never writes a level that does nothing', () => {
    expect(switchLevel(false, 'auto', 'confirm')).toBe('blocked')
    expect(switchLevel(true, 'auto', 'confirm')).toBe('auto')
    expect(switchLevel(true, 'blocked', 'confirm')).toBe('confirm')
  })
})

describe('approval watcher', () => {
  it('opens the sheet for a step that waits and has no sheet', () => {
    expect(nextWatchStep('s1', false, null)).toEqual({ do: 'open' })
  })
  it('does nothing while the sheet is open or nothing waits', () => {
    expect(nextWatchStep('s1', true, 's1')).toEqual({ do: 'nothing' })
    expect(nextWatchStep(null, false, 's1')).toEqual({ do: 'nothing' })
  })
  it('a sheet that went away while its step still waits means Deny', () => {
    expect(nextWatchStep('s1', false, 's1')).toEqual({ do: 'deny' })
  })
  it('the next step after an answered one gets its own sheet', () => {
    expect(nextWatchStep('s2', false, 's1')).toEqual({ do: 'open' })
  })
})

describe('options sheet', () => {
  it('a section is a sub page or a row of the first page', () => {
    expect(subPageOf('agent')).toBeNull()
    expect(subPageOf('thinking')).toBeNull()
    expect(subPageOf(undefined)).toBeNull()
    expect(subPageOf('permissions')).toBe('permissions')
    expect(isOptionsSub('agent-intro')).toBe(true)
    expect(isOptionsSub('nonsense')).toBe(false)
    expect(isOptionsSub(null)).toBe(false)
  })

  it('a new chat only carries over what was really set', () => {
    const none = { agentMode: false, goal: null, permissions: null, personaEnabled: null, sampling: {} }
    expect(hasCarry(none)).toBe(false)
    expect(hasCarry({ ...none, agentMode: true })).toBe(true)
    expect(hasCarry({ ...none, personaEnabled: false })).toBe(true)
    expect(hasCarry({ ...none, sampling: { temperature: 0.2 } })).toBe(true)
  })
})
