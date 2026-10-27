/**
 * Provider slots on a phone.
 *
 * The local engine is the app managed LU Engine in the `openai` slot, and
 * nothing else: there is no second local backend on a handheld, so the slot
 * of the desktop's other local backend stays off and the desktop's backend
 * detection is never called. `lu-cloud` follows the account; useCloudAuth
 * keeps it in step. Create runs on LU Cloud only (DESIGN.md 4.4).
 */
import { LU_ENGINE_NAME } from '../../lib/engine-name'
import { useCreateStore } from '../../stores/createStore'
import { useProviderStore } from '../../stores/providerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { externalProvidersOffered, webSearchKeysOffered } from '../policy/gates'

export const MOBILE_ENGINE_BASE_URL = 'http://127.0.0.1:8127/v1'

export function pinMobileProviders(): void {
  const store = useProviderStore.getState()
  const legacyLocal = store.providers.ollama
  if (legacyLocal?.enabled) store.setProviderConfig('ollama', { enabled: false })
  const engine = store.providers.openai
  if (!engine || !engine.enabled || !engine.managed || engine.baseUrl !== MOBILE_ENGINE_BASE_URL) {
    store.setProviderConfig('openai', {
      enabled: true,
      managed: true,
      isLocal: true,
      name: LU_ENGINE_NAME,
      baseUrl: MOBILE_ENGINE_BASE_URL,
    })
  }
}

/** The two slots a phone always has: the engine on the device and LU Cloud. */
const OWN_SLOTS = new Set<string>(['openai', 'lu-cloud'])

/** Pure: the slots of providers with the user's own key that are switched on. */
export function foreignProvidersOn(providers: Record<string, { enabled?: boolean } | undefined>): string[] {
  return Object.keys(providers).filter((id) => !OWN_SLOTS.has(id) && providers[id]?.enabled === true)
}

let enforcing = false

/**
 * A build without providers of one's own (store switch externalProviders)
 * keeps every such slot off: one that an earlier build saved, and one that a
 * backup brings in later. The key stays where it is, nothing is deleted; the
 * slot simply answers nothing and its models are in no list.
 */
export function enforceProviderPolicy(): void {
  if (externalProvidersOffered()) return
  const switchOff = () => {
    if (enforcing) return
    enforcing = true
    try {
      const store = useProviderStore.getState()
      for (const id of foreignProvidersOn(store.providers)) store.setProviderConfig(id as Parameters<typeof store.setProviderConfig>[0], { enabled: false })
    } finally {
      enforcing = false
    }
  }
  switchOff()
  useProviderStore.subscribe(switchOff)
}

/** Pure: the search provider a build without search keys uses, whatever was chosen before. */
export function searchProviderWithoutKeys(): 'duckduckgo' {
  // "duckduckgo" is the one choice that sends no key at all, whatever is stored (lib/search-keys.ts, resolveSearchCall).
  return 'duckduckgo'
}

let pinningSearch = false

/**
 * A build without search keys of one's own (store switch webSearchKeys)
 * searches with the free search, always: a key an earlier build saved, or
 * a choice a backup brings in later, is never used. The key stays where it
 * is, nothing is deleted.
 */
export function enforceSearchKeyPolicy(): void {
  if (webSearchKeysOffered()) return
  const pin = () => {
    if (pinningSearch || webSearchKeysOffered()) return
    if (useSettingsStore.getState().settings.searchProvider === searchProviderWithoutKeys()) return
    pinningSearch = true
    try {
      useSettingsStore.getState().updateSettings({ searchProvider: searchProviderWithoutKeys() })
    } finally {
      pinningSearch = false
    }
  }
  pin()
  useSettingsStore.subscribe(pin)
}

export function pinCreateToCloud(): void {
  if (useCreateStore.getState().backend !== 'cloud') useCreateStore.setState({ backend: 'cloud' })
}
