// @vitest-environment jsdom
/**
 * Round 6, G4: the switch `webSearchKeys`. Decided 10.10.2026: off in the
 * App Store preset, on in the other two.
 *
 * The App Store build has no model providers with a key of one's own, and
 * the page Web search offered key fields for Brave and Tavily all the same.
 * Now it has neither the fields nor the choice of a provider, and every
 * search is the free one. This pins both sides of the ONE line: what the
 * build does today, and what it does again when the line is turned back.
 *
 * Run: npx vitest run src/mobile/policy/__tests__/web-search-keys.dom.test.tsx
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../../lib/search-keys', async (original) => ({
  ...(await original<typeof import('../../../lib/search-keys')>()),
  moveLegacySearchKeys: async () => [],
}))

import { resolveSearchCall } from '../../../lib/search-keys'
import { useSettingsStore } from '../../../stores/settingsStore'
import { enforceSearchKeyPolicy, searchProviderWithoutKeys } from '../../boot/providers'
import WebSearchPage from '../../screens/agent/WebSearchPage'
import { webSearchKeysOffered } from '../gates'
import { STORE_PRESETS, setStorePresetForTests, type StorePolicy } from '../storePolicy'

/** What the one line does: the switch of the App Store preset, for the length of a test. */
function flip(value: boolean): void {
  ;(STORE_PRESETS.appstore as { webSearchKeys: boolean }).webSearchKeys = value
}

beforeEach(() => {
  setStorePresetForTests('appstore')
  useSettingsStore.getState().updateSettings({ searchProvider: 'auto', braveKeyStored: false, tavilyKeyStored: false })
})
afterEach(() => {
  cleanup()
  flip(false)
  setStorePresetForTests(null)
})

describe('G4: the App Store build as decided', () => {
  it('the switch is off there and on in the other two presets', () => {
    expect((Object.values(STORE_PRESETS) as StorePolicy[]).map((preset) => [preset.preset, preset.webSearchKeys])).toEqual([['open', true], ['play', true], ['appstore', false]])
    expect(webSearchKeysOffered()).toBe(false)
  })

  it('it is one line in the preset, and its own switch', () => {
    const source = readFileSync(join(__dirname, '..', 'storePolicy.ts'), 'utf8')
    const appstore = source.slice(source.indexOf('  appstore: {'), source.indexOf('}', source.indexOf('  appstore: {')))
    expect(appstore.match(/^\s+webSearchKeys: false,$/gm)).toHaveLength(1)
    expect(appstore).toMatch(/externalProviders: false,/)
  })

  it('the page has no key field, no word about a key and no choice, and says what it uses', () => {
    const { container } = render(<WebSearchPage />)
    expect(screen.queryByTestId('m-search-provider')).toBeNull()
    expect(screen.queryByTestId('m-search-brave-key')).toBeNull()
    expect(screen.queryByTestId('m-search-tavily-key')).toBeNull()
    expect(screen.queryByTestId('m-search-key-hint')).toBeNull()
    expect(screen.getByTestId('m-search-free-only').textContent).toContain('free search')
    expect(container.textContent).not.toMatch(/api key|brave|tavily/i)
    // The test search stays.
    expect(screen.getByTestId('m-search-test')).toBeTruthy()
  })

  it('a key that is on the phone already is not shown either: the page looks the same with it', () => {
    // What an earlier build, or a backup of one, leaves behind: the mark of a stored key and the choice that uses it.
    useSettingsStore.getState().updateSettings({ searchProvider: 'brave', braveKeyStored: true, tavilyKeyStored: true })
    const { container } = render(<WebSearchPage />)
    expect(screen.queryByTestId('m-search-brave-saved')).toBeNull()
    expect(screen.queryByTestId('m-search-brave-replace')).toBeNull()
    expect(container.textContent).not.toMatch(/api key|brave|tavily/i)
    expect(screen.getByTestId('m-search-free-only')).toBeTruthy()
  })

  it('every search is the free one: a provider chosen before, or brought in later, is put back', () => {
    useSettingsStore.getState().updateSettings({ searchProvider: 'tavily', tavilyKeyStored: true })
    enforceSearchKeyPolicy()
    expect(useSettingsStore.getState().settings.searchProvider).toBe('duckduckgo')
    // A backup that is restored later.
    useSettingsStore.getState().updateSettings({ searchProvider: 'auto', braveKeyStored: true })
    expect(useSettingsStore.getState().settings.searchProvider).toBe('duckduckgo')
    expect(searchProviderWithoutKeys()).toBe('duckduckgo')
  })

  it('the search that is then asked for carries no key, although one is stored', async () => {
    useSettingsStore.getState().updateSettings({ searchProvider: 'brave', braveKeyStored: true, tavilyKeyStored: true })
    enforceSearchKeyPolicy()
    const call = await resolveSearchCall()
    expect(call).toEqual({ provider: 'duckduckgo', braveApiKey: '', tavilyApiKey: '' })
  })

  it('"duckduckgo" is the choice that sends no key, whatever is stored', () => {
    const source = readFileSync(join(__dirname, '..', '..', '..', 'lib', 'search-keys.ts'), 'utf8')
    expect(source).toContain("if (provider === 'duckduckgo') return { provider, braveApiKey: '', tavilyApiKey: '' }")
  })
})

describe('G4: the other presets, and the App Store build with the line turned back', () => {
  it('the Play build shows the choice and both key fields, and pins nothing', () => {
    setStorePresetForTests('play')
    render(<WebSearchPage />)
    expect(screen.getByTestId('m-search-provider')).toBeTruthy()
    expect(screen.getByTestId('m-search-brave-key')).toBeTruthy()
    expect(screen.getByTestId('m-search-tavily-key')).toBeTruthy()
    expect(screen.queryByTestId('m-search-free-only')).toBeNull()
    useSettingsStore.getState().updateSettings({ searchProvider: 'brave' })
    expect(useSettingsStore.getState().settings.searchProvider).toBe('brave')
  })

  it('with `true` the App Store build is as it was', () => {
    flip(true)
    expect(webSearchKeysOffered()).toBe(true)
    render(<WebSearchPage />)
    expect(screen.getByTestId('m-search-provider')).toBeTruthy()
    expect(screen.getByTestId('m-search-brave-key')).toBeTruthy()
    expect(screen.getByTestId('m-search-tavily-key')).toBeTruthy()
    useSettingsStore.getState().updateSettings({ searchProvider: 'brave' })
    expect(useSettingsStore.getState().settings.searchProvider).toBe('brave')
  })
})
