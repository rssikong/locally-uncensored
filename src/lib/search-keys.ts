/**
 * Web search: which provider a search uses and where its API keys live.
 *
 * Two homes for a key, read through ONE door (resolveSearchCall):
 *
 *   plain field   settings.braveApiKey / settings.tavilyApiKey. The desktop
 *                 settings page writes these, as it always has.
 *   keychain      the parked namespace of the platform vault (secretParkSet),
 *                 under SEARCH_KEY_ACCOUNT. The settings then carry only the
 *                 bit "is stored" (braveKeyStored / tavilyKeyStored). The
 *                 phone stores keys only this way, so a key never reaches the
 *                 settings blob and therefore never a backup.
 *
 * A plain value wins over a stored one: it is the newer statement wherever
 * both exist (the desktop page just typed it, or a backup just brought it).
 * On a phone a plain value is moved into the keychain the first time it is
 * seen (moveLegacySearchKeys), once per value.
 *
 * Nothing here logs a key, and no error text carries one.
 */
import { backendCall } from '../api/backend'
import { useSettingsStore } from '../stores/settingsStore'
import type { SearchProvider, Settings } from '../types/settings'
import { SEARCH_PROVIDERS as SEARCH_PROVIDER_OPTIONS } from './search-providers'
import {
  PLAIN_FIELD,
  STORED_FLAG,
  dropStoredSearchKey,
  movePlainSearchKeys,
  readStoredSearchKey,
  storeSearchKey,
  type SaveSearchKeyResult,
  type SearchKeyName,
  type SettingsDoor,
} from './search-key-vault'

export { SEARCH_KEY_ACCOUNT, __resetSearchKeyMovesForTests } from './search-key-vault'
export type { SaveSearchKeyResult, SearchKeyName } from './search-key-vault'

const door: SettingsDoor = {
  read: () => useSettingsStore.getState().settings,
  write: (partial) => useSettingsStore.getState().updateSettings(partial),
}

// Every service Settings offers (lib/search-providers.ts, 3.0.8), so a choice
// of Exa, You.com, SearXNG or Wikipedia is not reset to Auto here.
export const SEARCH_PROVIDERS: readonly SearchProvider[] = SEARCH_PROVIDER_OPTIONS.map((p) => p.id)

export function isSearchProvider(value: unknown): value is SearchProvider {
  return typeof value === 'string' && (SEARCH_PROVIDERS as readonly string[]).includes(value)
}

type KeyView = Pick<Settings, 'braveApiKey' | 'tavilyApiKey' | 'braveKeyStored' | 'tavilyKeyStored'>

/** Is there a key for this provider, in either home? Says nothing about the key. */
export function searchKeyIsSet(settings: Partial<KeyView>, which: SearchKeyName): boolean {
  const plain = settings[PLAIN_FIELD[which]]
  return (typeof plain === 'string' && plain.trim().length > 0) || settings[STORED_FLAG[which]] === true
}

/** A provider can only be chosen when its key is there. The two free choices never need one. */
export function searchProviderUsable(provider: SearchProvider, settings: Partial<KeyView>): boolean {
  if (provider === 'brave' || provider === 'tavily') return searchKeyIsSet(settings, provider)
  return true
}

/** The provider that stays chosen after a key went away. */
export function searchProviderAfterKeyChange(current: SearchProvider, settings: Partial<KeyView>): SearchProvider {
  return searchProviderUsable(current, settings) ? current : 'auto'
}

/**
 * Put a key into the keychain. The settings get the bit, the plain field is
 * emptied. Without a keychain nothing is stored at all: the caller says so.
 */
export function saveSearchKey(which: SearchKeyName, value: string): Promise<SaveSearchKeyResult> {
  return storeSearchKey(door, which, value)
}

/**
 * Remove a key from both homes. A provider that needed it falls back to
 * 'auto'. False when the keychain refused the delete: the key is then still
 * there and the settings keep saying so.
 */
export async function removeSearchKey(which: SearchKeyName): Promise<boolean> {
  if ((await dropStoredSearchKey(which)) === 'refused') return false
  const now = door.read()
  const next = { ...now, [PLAIN_FIELD[which]]: '', [STORED_FLAG[which]]: false }
  door.write({
    [PLAIN_FIELD[which]]: '',
    [STORED_FLAG[which]]: false,
    searchProvider: searchProviderAfterKeyChange(now.searchProvider || 'auto', next),
  })
  return true
}

/** The one-time move of plain keys into the keychain, phones only (see search-key-vault.ts). */
export function moveLegacySearchKeys(): Promise<SearchKeyName[]> {
  return movePlainSearchKeys(door)
}

async function readSearchKey(which: SearchKeyName): Promise<string> {
  const settings = door.read()
  const plain = (settings[PLAIN_FIELD[which]] ?? '').trim()
  if (plain) return plain
  if (!settings[STORED_FLAG[which]]) return ''
  const stored = await readStoredSearchKey(which)
  if (stored) return stored
  // A keychain that is locked or busy right now: this one search runs
  // without the key, the bit stays so the next one can try again.
  if (stored === null) return ''
  // The bit says stored, the keychain has nothing (a backup from another
  // device brought the bit along, or the entry was wiped). Say the truth.
  const now = door.read()
  const next = { ...now, [STORED_FLAG[which]]: false }
  door.write({
    [STORED_FLAG[which]]: false,
    searchProvider: searchProviderAfterKeyChange(now.searchProvider || 'auto', next),
  })
  return ''
}

export interface SearchCall {
  provider: SearchProvider
  braveApiKey: string
  tavilyApiKey: string
}

/**
 * What one search sends to the `web_search` command: the chosen provider and
 * only the keys that provider may use.
 *
 *   duckduckgo  no key at all, whatever is stored
 *   brave       the Brave key only
 *   tavily      the Tavily key only
 *   auto        both, the command prefers a provider with a key
 */
export async function resolveSearchCall(): Promise<SearchCall> {
  await moveLegacySearchKeys()
  const chosen = useSettingsStore.getState().settings.searchProvider
  const provider: SearchProvider = isSearchProvider(chosen) ? chosen : 'auto'
  if (provider === 'duckduckgo') return { provider, braveApiKey: '', tavilyApiKey: '' }
  const braveApiKey = provider === 'tavily' ? '' : await readSearchKey('brave')
  const tavilyApiKey = provider === 'brave' ? '' : await readSearchKey('tavily')
  // readSearchKey may have corrected the choice when a stored key was gone.
  const after = useSettingsStore.getState().settings.searchProvider
  return { provider: isSearchProvider(after) ? after : 'auto', braveApiKey, tavilyApiKey }
}

export interface WebSearchAnswer {
  results?: Array<{ title?: string; url?: string; snippet?: string }>
  provider?: string
  providerError?: string
  error?: string
  /** The free searches that were asked and did not deliver, each with its reason. */
  tiers?: Array<{ tier?: string; error?: string }>
}

/** Run one search the way the agent's web_search tool runs it. */
export async function runWebSearch(query: string, count: number): Promise<WebSearchAnswer> {
  const call = await resolveSearchCall()
  return backendCall<WebSearchAnswer>('web_search', { query, count, ...call })
}
