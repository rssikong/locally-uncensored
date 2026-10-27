/**
 * A37, Davids Entscheidung 26.10.2026: "ja, Ask und Bypass soll da auch klappen".
 *
 * Under Ask the Code tab asked only before shell, code and git tools. REA's
 * tools, and every other external MCP tool, ran without a card, and REA starts
 * programs (Ghidra headless). Now Ask asks before every external tool, Bypass
 * asks before none, and a no runs nothing (the executor's gate, unchanged).
 *
 * Run: npx vitest run src/lib/__tests__/ask-asks-before-external-tools.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { resolveApprovalLevel, codexAsksBefore, type FrontDecision } from '../agent-approval-policy'

const base: FrontDecision = { categoryLevel: 'auto', codexMode: 'ask', execConfirm: true, readOnlyRun: false }

describe('Ask on the Code surface and external tools', () => {
  it('Ask asks before a REA tool, also when its category is set to auto', () => {
    expect(resolveApprovalLevel('procedure_pseudo_code', { ...base, external: true })).toBe('confirm')
    expect(codexAsksBefore('procedure_pseudo_code', { codexMode: 'ask', execConfirm: true, external: true })).toBe(true)
  })

  it('Bypass runs it without asking, the cloud opt-in included (that one is for exec tools)', () => {
    expect(resolveApprovalLevel('procedure_pseudo_code', { ...base, codexMode: 'bypass', execConfirm: false, external: true })).toBe('auto')
    expect(codexAsksBefore('procedure_pseudo_code', { codexMode: 'bypass', execConfirm: true, external: true })).toBe(false)
  })

  it('a built-in read under Ask still runs, shell still asks, a blocked external tool stays blocked', () => {
    expect(resolveApprovalLevel('file_read', base)).toBe('auto')
    expect(resolveApprovalLevel('shell_execute', base)).toBe('confirm')
    expect(resolveApprovalLevel('procedure_pseudo_code', { ...base, categoryLevel: 'blocked', external: true })).toBe('blocked')
    // A read-only run blocks the known writers only; an external tool there now asks instead of running.
    expect(resolveApprovalLevel('procedure_pseudo_code', { ...base, readOnlyRun: true, external: true })).toBe('confirm')
  })

  it('the Agent chat keeps its permission store', () => {
    expect(resolveApprovalLevel('procedure_pseudo_code', { ...base, codexMode: null, external: true })).toBe('auto')
  })

  it('the main Code loop and the delegated paths pass whether the tool is external', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const read = (p: string) => readFileSync(resolve(here, p), 'utf8')
    expect(read('../../hooks/useCodex.ts')).toMatch(/if \(!codexAsksBefore\(req\.toolName, \{\s+codexMode,\s+execConfirm: true,\s+external: toolRegistry\.getToolByName\(req\.toolName\)\?\.source === 'external',/)
    for (const f of ['../../api/agents/sub-agent.ts', '../workflow-engine.ts']) {
      expect(read(f), f).toMatch(/external: toolRegistry\.getAll\(\)\.some\(\(t\) => t\.name === req\.toolName && t\.source === 'external'\)/)
    }
    expect(read('../../api/voice-tool-bridge.ts')).toMatch(/external: tool\.source === 'external'/)
  })
})
