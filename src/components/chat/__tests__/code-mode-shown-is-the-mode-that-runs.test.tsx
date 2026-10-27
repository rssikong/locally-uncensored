/**
 * @vitest-environment jsdom
 *
 * A37, Discord "Ghidra and REA", xxcoder, 26.10.2026:
 *
 *   "I have to specifically select 'ask' each time I start a new code
 *    session, or it will run everything without asking even though it still
 *    shows 'ask'."
 *
 * The Code start screen has no conversation yet. The trigger showed the global
 * default (Ask), the menu refused a pick ("Open a coding chat first"), and the
 * first send created the conversation stamped with the last Ask/Bypass picked
 * anywhere. Someone who once picked Bypass saw Ask and got an unattended run.
 *
 * What this file pins:
 *   - on the start screen the trigger shows the mode the send will run under,
 *   - a pick there is kept and stamped on the conversation the send creates,
 *   - a parked pick is shown once the run that parked it is over,
 *   - where screen and store still disagree, the stricter mode runs.
 *
 * Run: npx vitest run src/components/chat/__tests__/code-mode-shown-is-the-mode-that-runs.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const { CodexModeDropdown } = await import('../CodexModeDropdown')
const { useCodexStore } = await import('../../../stores/codexStore')
const { useChatStore } = await import('../../../stores/chatStore')
const { useSettingsStore } = await import('../../../stores/settingsStore')
const { stricterCodexMode } = await import('../../../lib/codex-mode')

/** What useCodex does on a send from the start screen, in the same order. */
function sendFromStartScreen(newId: string): string {
  useCodexStore.getState().startConversationMode(newId)
  useCodexStore.getState().applyParkedMode(newId)
  return useCodexStore.getState().codexModeFor(newId, useSettingsStore.getState().settings.codexDefaultMode)
}

function triggerText(): string {
  return screen.getAllByRole('button')[0].textContent ?? ''
}

beforeEach(() => {
  useChatStore.setState({ activeConversationId: null })
  useSettingsStore.getState().updateSettings({ codexDefaultMode: 'ask' })
  useCodexStore.setState({
    modeByConversation: {},
    lastPickedMode: null,
    parkedModeByConversation: {},
    prePlanModeByConversation: {},
    planApprovalByConversation: {},
    draftMode: null,
  })
})

afterEach(() => cleanup())

describe('the start screen shows what the first send runs', () => {
  it('a Bypass picked in an earlier session is what the trigger shows, because it is what runs', () => {
    useCodexStore.setState({ lastPickedMode: 'bypass' })
    render(createElement(CodexModeDropdown))
    const shown = triggerText()
    const runs = sendFromStartScreen('new-1')
    expect(runs).toBe('bypass')
    expect(shown).toContain('Bypass')
    expect(shown).not.toContain('Ask')
  })

  it('picking Ask on the start screen is kept: the new conversation runs Ask', () => {
    useCodexStore.setState({ lastPickedMode: 'bypass' })
    render(createElement(CodexModeDropdown))
    fireEvent.click(screen.getAllByRole('button')[0])
    fireEvent.click(screen.getByText('Ask permissions'))
    expect(triggerText()).toContain('Ask')
    expect(sendFromStartScreen('new-2')).toBe('ask')
    // and the one after that too: the pick is the new last pick
    expect(sendFromStartScreen('new-3')).toBe('ask')
  })

  it('with nothing ever picked the default shows and runs', () => {
    render(createElement(CodexModeDropdown))
    expect(triggerText()).toContain('Ask')
    expect(sendFromStartScreen('new-4')).toBe('ask')
  })
})

describe('an open conversation', () => {
  it('a pick parked during a run is shown once the run is over, since the next send applies it', () => {
    useChatStore.setState({ activeConversationId: 'c1' })
    useCodexStore.getState().chooseCodexMode('c1', 'ask', false)
    useCodexStore.getState().chooseCodexMode('c1', 'bypass', true)
    render(createElement(CodexModeDropdown))
    expect(triggerText()).toContain('Bypass')
    useCodexStore.getState().applyParkedMode('c1')
    expect(useCodexStore.getState().codexModeFor('c1', 'ask')).toBe('bypass')
  })
})

describe('in doubt the stricter mode runs', () => {
  it('orders plan over ask over bypass, both ways round', () => {
    expect(stricterCodexMode('ask', 'bypass')).toBe('ask')
    expect(stricterCodexMode('bypass', 'ask')).toBe('ask')
    expect(stricterCodexMode('plan', 'ask')).toBe('plan')
    expect(stricterCodexMode('bypass', 'bypass')).toBe('bypass')
  })

  it('the send takes the mode on screen and never runs looser than it', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const codex = readFileSync(resolve(here, '../../../hooks/useCodex.ts'), 'utf8')
    const view = readFileSync(resolve(here, '../CodexView.tsx'), 'utf8')
    expect(codex).toMatch(/stricterCodexMode\(opts\.shownMode, storedMode\)/)
    expect(codex).toMatch(/alignConversationMode\(convId, codexMode\)/)
    expect(view).toMatch(/sendInstruction\(content, files \? \{ files, shownMode \} : \{ shownMode \}\)/)
  })
})
