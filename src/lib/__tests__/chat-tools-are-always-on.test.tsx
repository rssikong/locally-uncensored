/**
 * @vitest-environment jsdom
 *
 * David, 3.0.7: Chat Tools are always on. The switch under Plugins is gone,
 * there is none anywhere else, and a profile that had them off reads as on.
 * A model that cannot call tools goes on in plain chat without them, as it
 * did with the switch off (lib/chat-tools-reach.ts).
 *
 * Run: npx vitest run src/lib/__tests__/chat-tools-are-always-on.test.tsx
 */
import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { chatToolsReach } from '../chat-tools-reach'
import { useSettingsStore } from '../../stores/settingsStore'
import { PluginsDropdown } from '../../components/chat/PluginsDropdown'

afterEach(() => cleanup())

const SRC = resolve(__dirname, '../..')
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : sources(path)
    return /\.(ts|tsx)$/.test(name) ? [path] : []
  })
}

describe('Chat Tools', () => {
  it('reach every model that can call tools, natively or through the prompt', () => {
    expect(chatToolsReach('ollama::qwen3:8b', [])).toBe(true)
    expect(chatToolsReach('openai::gpt-5', [])).toBe(true)
    // A local model that says it has no tool channel still gets the prompt path.
    expect(chatToolsReach('ollama::tiny', [{ name: 'ollama::tiny', type: 'text', supportsTools: false }])).toBe(true)
  })

  it('leave a model that cannot call tools in plain chat, as the old "off" did', () => {
    expect(chatToolsReach('lu-cloud::no-tools', [{ name: 'lu-cloud::no-tools', type: 'text', supportsTools: false }])).toBe(false)
    expect(chatToolsReach(null, [])).toBe(false)
  })

  it('are read from the model, never from a setting: no code reads the old switch', () => {
    const readers = sources(SRC).filter((f) => readFileSync(f, 'utf-8').includes('chatToolsEnabled'))
    // Only the migration that deletes it from a stored profile names it.
    expect(readers.map((f) => f.slice(SRC.length + 1))).toEqual(['stores/settingsStore.ts'])
    const chat = readFileSync(join(SRC, 'hooks/useChat.ts'), 'utf-8')
    expect(chat).toContain('chatToolsReach(activeModel, useModelStore.getState().models)')
  })

  it('a stored profile with them off loses the switch on start', async () => {
    const key = useSettingsStore.persist.getOptions().name!
    const version = useSettingsStore.persist.getOptions().version
    const stored = JSON.parse(JSON.stringify({ state: useSettingsStore.getState(), version }))
    stored.state.settings.chatToolsEnabled = false
    localStorage.setItem(key, JSON.stringify(stored))
    await useSettingsStore.persist.rehydrate()
    expect('chatToolsEnabled' in useSettingsStore.getState().settings).toBe(false)
  })

  it('have no switch under Plugins', () => {
    render(<PluginsDropdown />)
    fireEvent.click(screen.getByRole('button', { name: /Plugins/ }))
    expect(screen.queryByText('Chat Tools')).toBeNull()
    expect(screen.queryByTitle(/tools in plain chat/)).toBeNull()
  })
})
