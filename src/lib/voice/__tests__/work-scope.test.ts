import { describe, expect, it } from 'vitest'
import {
  AGENT_OFF_REFUSAL,
  DEFAULT_THINKING_BUDGET,
  SCREEN_REFUSAL,
  THINKING_BUDGET_STEPS,
  VOICE_WORK_DEFAULTS,
  levelInScope,
  placeOutsideWorkspace,
  scopePromptLine,
  scopeRefusal,
  thinkingBudgetStep,
  toolInScope,
} from '../work-scope'
import type { VoiceWork } from '../work-scope'

const WORKSPACE: VoiceWork = { agent: true, scope: 'workspace' }
const COMPUTER: VoiceWork = { agent: true, scope: 'computer' }
const OFF: VoiceWork = { agent: false, scope: 'computer' }
const ROOT = '/Users/dana/projects/site'

describe('what a fresh installation starts with', () => {
  it('is the narrowest level, and nobody has confirmed the whole computer', () => {
    expect(VOICE_WORK_DEFAULTS.loopScope).toBe('workspace')
    expect(VOICE_WORK_DEFAULTS.loopComputerConfirmed).toBe(false)
    expect(VOICE_WORK_DEFAULTS.loopThinking).toBe(false)
    expect(VOICE_WORK_DEFAULTS.loopThinkingBudget).toBe(DEFAULT_THINKING_BUDGET)
    expect(THINKING_BUDGET_STEPS).toContain(DEFAULT_THINKING_BUDGET)
  })

  it('reads a stored thinking length as the nearest step', () => {
    expect(thinkingBudgetStep(500)).toBe(512)
    expect(thinkingBudgetStep(1)).toBe(128)
    expect(thinkingBudgetStep(99999)).toBe(4096)
    expect(thinkingBudgetStep(Number.NaN)).toBe(DEFAULT_THINKING_BUDGET)
  })
})

describe('which tools the model is shown', () => {
  it('shows only the web pair with the agent off, as the plain chat has it (GitHub #187)', () => {
    for (const name of ['file_read', 'file_write', 'shell_execute', 'computer_task', 'computer_use', 'screenshot']) expect(toolInScope(name, OFF)).toBe(false)
    for (const name of ['web_search', 'web_fetch']) expect(toolInScope(name, OFF)).toBe(true)
    expect(toolInScope('web_search', { agent: false, scope: 'workspace' })).toBe(true)
  })

  it('leaves the permission of a web tool as the user set it with the agent off', () => {
    expect(levelInScope('web_search', 'auto', OFF)).toBe('auto')
    expect(levelInScope('web_fetch', 'confirm', OFF)).toBe('confirm')
    expect(levelInScope('web_search', 'blocked', OFF)).toBe('blocked')
    expect(levelInScope('shell_execute', 'auto', OFF)).toBe('blocked')
  })

  it('keeps the screen out of the workspace level and offers it on the whole computer', () => {
    expect(toolInScope('computer_task', WORKSPACE)).toBe(false)
    expect(toolInScope('computer_use', WORKSPACE)).toBe(false)
    expect(toolInScope('file_write', WORKSPACE)).toBe(true)
    expect(toolInScope('computer_task', COMPUTER)).toBe(true)
  })
})

describe('the level of a tool only ever narrows', () => {
  it('asks before every command in the workspace level, also when commands are set to run by themselves', () => {
    expect(levelInScope('shell_execute', 'auto', WORKSPACE)).toBe('confirm')
    expect(levelInScope('shell_execute', 'confirm', WORKSPACE)).toBe('confirm')
    expect(levelInScope('shell_execute', 'blocked', WORKSPACE)).toBe('blocked')
  })

  it('changes no permission on the whole computer', () => {
    expect(levelInScope('shell_execute', 'auto', COMPUTER)).toBe('auto')
    expect(levelInScope('shell_execute', 'confirm', COMPUTER)).toBe('confirm')
    expect(levelInScope('file_write', 'blocked', COMPUTER)).toBe('blocked')
  })

  it('blocks what is out of reach', () => {
    expect(levelInScope('computer_task', 'auto', WORKSPACE)).toBe('blocked')
    expect(levelInScope('file_read', 'auto', OFF)).toBe('blocked')
  })
})

describe('a command that names a place outside the folder', () => {
  const outside: Array<[string, string | undefined]> = [
    ['cat ~/.ssh/id_rsa', undefined],
    ['cat /etc/passwd', undefined],
    ['ls ..', undefined],
    ['cd ../.. && ls', undefined],
    ['cp notes.txt /tmp/notes.txt', undefined],
    ['echo hi > $HOME/x.txt', undefined],
    ['type %USERPROFILE%\\secret.txt', undefined],
    ['Get-Content $env:APPDATA\\x', undefined],
    ['tar -cf out.tar --directory=/Users/dana/Documents .', undefined],
    ['ls', '/Users/dana/Documents'],
    ['ls', '../other'],
    ['cat sub/../../other/file', undefined],
    ['dir C:\\Users\\dana\\Desktop', undefined],
    ['ls "/Users/dana/Desktop"', undefined],
  ]
  for (const [command, cwd] of outside) {
    it(`refuses: ${command}${cwd ? ` (in ${cwd})` : ''}`, () => {
      expect(placeOutsideWorkspace(command, cwd, ROOT)).not.toBeNull()
      expect(scopeRefusal({ name: 'shell_execute', args: { command, ...(cwd ? { cwd } : {}) } }, WORKSPACE, ROOT)).toContain('It was not run')
    })
  }

  const inside: Array<[string, string | undefined]> = [
    ['ls', undefined],
    ['npm test', undefined],
    ['cat src/index.ts', undefined],
    ['cat src/../README.md', undefined],
    [`cat ${ROOT}/README.md`, undefined],
    ['ls', 'src'],
    ['ls', `${ROOT}/src`],
    ['/usr/bin/git status', undefined],
    ['echo hi > /dev/null', undefined],
    ['git log --oneline | head -5', undefined],
  ]
  for (const [command, cwd] of inside) {
    it(`lets through: ${command}${cwd ? ` (in ${cwd})` : ''}`, () => {
      expect(placeOutsideWorkspace(command, cwd, ROOT)).toBeNull()
      expect(scopeRefusal({ name: 'shell_execute', args: { command, ...(cwd ? { cwd } : {}) } }, WORKSPACE, ROOT)).toBeNull()
    })
  }

  it('treats every absolute path as outside when the session works in its own folder', () => {
    expect(placeOutsideWorkspace('cat /Users/dana/projects/site/README.md', undefined, null)).not.toBeNull()
    expect(placeOutsideWorkspace('ls', '/Users/dana', null)).not.toBeNull()
    expect(placeOutsideWorkspace('cat notes/today.md', undefined, null)).toBeNull()
    expect(placeOutsideWorkspace('ls ..', undefined, null)).not.toBeNull()
  })

  it('refuses nothing of the kind on the whole computer', () => {
    expect(scopeRefusal({ name: 'shell_execute', args: { command: 'cat ~/.zshrc' } }, COMPUTER, ROOT)).toBeNull()
    expect(scopeRefusal({ name: 'computer_task', args: {} }, COMPUTER, ROOT)).toBeNull()
  })
})

describe('what a refused call is told', () => {
  it('names the switch for a screen tool in the workspace level', () => {
    expect(scopeRefusal({ name: 'computer_task', args: { task: 'open Safari' } }, WORKSPACE, ROOT)).toBe(SCREEN_REFUSAL)
    expect(SCREEN_REFUSAL).toContain('Whole computer')
  })

  it('has no screen at the workspace level, also not through the screenshot tool of the long catalog', () => {
    expect(toolInScope('screenshot', WORKSPACE)).toBe(false)
    expect(levelInScope('screenshot', 'auto', WORKSPACE)).toBe('blocked')
    expect(scopeRefusal({ name: 'screenshot', args: {} }, WORKSPACE, ROOT)).toBe(SCREEN_REFUSAL)
    expect(toolInScope('screenshot', COMPUTER)).toBe(true)
  })

  it('refuses every call but the web once the agent is off, also one the model was offered a minute ago', () => {
    expect(scopeRefusal({ name: 'web_search', args: { query: 'x' } }, OFF, ROOT)).toBeNull()
    expect(scopeRefusal({ name: 'web_fetch', args: { url: 'https://example.com' } }, OFF, ROOT)).toBeNull()
    expect(scopeRefusal({ name: 'file_read', args: { path: 'a.txt' } }, OFF, ROOT)).toBe(AGENT_OFF_REFUSAL)
    expect(scopeRefusal({ name: 'shell_execute', args: { command: 'ls' } }, OFF, ROOT)).toBe(AGENT_OFF_REFUSAL)
    expect(AGENT_OFF_REFUSAL).toContain('Agent switch')
  })

  it('tells the model where it stands', () => {
    expect(scopePromptLine(OFF)).toContain('look things up on the web')
    expect(scopePromptLine(OFF)).toContain('Agent switch')
    expect(scopePromptLine(WORKSPACE)).toContain('only work inside the workspace folder')
    expect(scopePromptLine(COMPUTER)).toContain('whole computer')
  })
})
