/**
 * The keychain side of the web search keys, without the settings store.
 *
 * Split from lib/search-keys.ts so the settings store itself can start the
 * one-time move right after it was read (onRehydrateStorage) without
 * importing a module that imports the store back.
 *
 * Nothing here logs a key, and no error text carries one.
 */
import { secretParkDelete, secretParkGet, secretParkSet } from '../api/backend'
import type { Settings } from '../types/settings'
import { isMobile } from './device-kind'
import { isKeychainMissing } from './parked-key'

export type SearchKeyName = 'brave' | 'tavily'

/** Keychain accounts in the parked namespace. Slugs, never secrets. */
export const SEARCH_KEY_ACCOUNT: Record<SearchKeyName, string> = {
  brave: 'search-brave',
  tavily: 'search-tavily',
}

export const PLAIN_FIELD = { brave: 'braveApiKey', tavily: 'tavilyApiKey' } as const
export const STORED_FLAG = { brave: 'braveKeyStored', tavily: 'tavilyKeyStored' } as const

/** The two calls of the settings store this needs, handed in by the caller. */
export interface SettingsDoor {
  read: () => Settings
  write: (partial: Partial<Settings>) => void
}

export type SaveSearchKeyResult = 'stored' | 'empty' | 'no-keychain' | 'failed'

/**
 * Put a key into the keychain. The settings get the bit, the plain field is
 * emptied. Without a keychain nothing is stored at all: the caller says so.
 */
export async function storeSearchKey(door: SettingsDoor, which: SearchKeyName, value: string): Promise<SaveSearchKeyResult> {
  const key = value.trim()
  if (!key) return 'empty'
  try {
    await secretParkSet(SEARCH_KEY_ACCOUNT[which], key)
  } catch (err) {
    return isKeychainMissing(err) ? 'no-keychain' : 'failed'
  }
  door.write({ [PLAIN_FIELD[which]]: '', [STORED_FLAG[which]]: true })
  return 'stored'
}

/** 'gone' also when there never was a keychain: then nothing is stored to delete. */
export async function dropStoredSearchKey(which: SearchKeyName): Promise<'gone' | 'refused'> {
  try {
    await secretParkDelete(SEARCH_KEY_ACCOUNT[which])
    return 'gone'
  } catch (err) {
    return isKeychainMissing(err) ? 'gone' : 'refused'
  }
}

/** The stored key, '' when the keychain has none, null when it could not be asked right now. */
export async function readStoredSearchKey(which: SearchKeyName): Promise<string | null> {
  try {
    return (await secretParkGet(SEARCH_KEY_ACCOUNT[which])) ?? ''
  } catch (err) {
    return isKeychainMissing(err) ? '' : null
  }
}

/** One move per plain value and session, so a keychain that refuses is not asked on every search. */
const moveTried = new Map<SearchKeyName, string>()

/**
 * The one-time move of keys an older build (or a backup from a desktop)
 * left in the plain settings field: into the keychain, then the field is
 * emptied. Phones only. The desktop keeps its field, its settings page
 * reads and writes it.
 *
 * Returns the providers whose key moved. Without a keychain the plain value
 * stays where it is and keeps working.
 */
export async function movePlainSearchKeys(door: SettingsDoor): Promise<SearchKeyName[]> {
  if (!isMobile()) return []
  const moved: SearchKeyName[] = []
  for (const which of ['brave', 'tavily'] as const) {
    const plain = (door.read()[PLAIN_FIELD[which]] ?? '').trim()
    if (!plain || moveTried.get(which) === plain) continue
    moveTried.set(which, plain)
    if ((await storeSearchKey(door, which, plain)) === 'stored') moved.push(which)
  }
  return moved
}

/** Test seam. */
export function __resetSearchKeyMovesForTests(): void {
  moveTried.clear()
}
