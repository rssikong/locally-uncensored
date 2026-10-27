// @vitest-environment jsdom
/**
 * The age declaration is on the disk before the page moves on, and a lost
 * localStorage does not bring the question back.
 *
 * Acceptance android-knoepfe, finding M1: "No", then the app shut down
 * within 600 ms, and the next start asked again. The answer sat only in the
 * localStorage of the WebView, which writes late.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGE_KEY, __resetAgeForTests, ageSaving, ageState, declareAge, readAgeFromDevice } from '../age'
import { AGE_VAULT_ID, AGE_VAULT_TIMEOUT_MS, setAgeVaultForTests, type AgeVault } from '../age-vault'
import { setStorePresetForTests } from '../storePolicy'
import { readFileSync as fsRead } from 'node:fs'
import { resolve as pathResolve } from 'node:path'

/** A vault whose writes finish when the test says so. */
function fakeVault(start: string | null = null) {
  let stored = start
  const pending: Array<() => void> = []
  const vault: AgeVault = {
    available: () => true,
    load: vi.fn(async () => stored),
    save: vi.fn(
      (answer) =>
        new Promise<void>((resolve) => {
          pending.push(() => {
            stored = answer
            resolve()
          })
        }),
    ),
  }
  return {
    vault,
    stored: () => stored,
    confirm: async () => {
      for (const done of pending.splice(0)) done()
      await Promise.resolve()
      await Promise.resolve()
    },
  }
}

beforeEach(() => {
  localStorage.clear()
  setStorePresetForTests('play')
  __resetAgeForTests()
})

afterEach(() => {
  setAgeVaultForTests(null)
  setStorePresetForTests(null)
  __resetAgeForTests()
  vi.useRealTimers()
})

describe('age declaration with a native storage', () => {
  it('the name fits the parked part of the secure storage', () => {
    expect(AGE_VAULT_ID).toMatch(/^[a-z0-9-]{1,64}$/)
  })

  it('"No" keeps the question on screen until the native layer confirmed, then blocks', async () => {
    const fake = fakeVault()
    setAgeVaultForTests(fake.vault)
    await readAgeFromDevice()
    expect(ageState()).toBe('ask')

    const done = declareAge('minor')
    // In localStorage from the first line, and on its way to the disk.
    expect(localStorage.getItem(AGE_KEY)).toBe('minor')
    expect(fake.vault.save).toHaveBeenCalledWith('minor')
    expect(ageSaving()).toBe('minor')
    expect(ageState()).toBe('ask')

    await fake.confirm()
    await done
    expect(fake.stored()).toBe('minor')
    expect(ageSaving()).toBeNull()
    expect(ageState()).toBe('blocked')
  })

  it('a second tap while the first answer is being written changes nothing', async () => {
    const fake = fakeVault()
    setAgeVaultForTests(fake.vault)
    await readAgeFromDevice()
    const done = declareAge('minor')
    void declareAge('adult')
    expect(fake.vault.save).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(AGE_KEY)).toBe('minor')
    await fake.confirm()
    await done
    expect(ageState()).toBe('blocked')
  })

  it('the next start blocks although localStorage lost the answer', async () => {
    // What the phone did: the answer never reached the disk of the WebView.
    const fake = fakeVault('minor')
    setAgeVaultForTests(fake.vault)
    expect(localStorage.getItem(AGE_KEY)).toBeNull()
    // Until the native layer answered nothing is offered, not even the question.
    expect(ageState()).toBe('checking')
    await readAgeFromDevice()
    expect(ageState()).toBe('blocked')
    // And localStorage is back in step for the start after that.
    expect(localStorage.getItem(AGE_KEY)).toBe('minor')
  })

  it('"Yes" is for good as well: a lost localStorage does not ask again', async () => {
    const fake = fakeVault('adult')
    setAgeVaultForTests(fake.vault)
    expect(ageState()).toBe('checking')
    await readAgeFromDevice()
    expect(ageState()).toBe('open')
    expect(localStorage.getItem(AGE_KEY)).toBe('adult')
  })

  it('"minor" on the device wins over "adult" in localStorage', async () => {
    const fake = fakeVault('minor')
    setAgeVaultForTests(fake.vault)
    localStorage.setItem(AGE_KEY, 'adult')
    await readAgeFromDevice()
    expect(ageState()).toBe('blocked')
  })

  it('an empty native storage leads to the question', async () => {
    const fake = fakeVault(null)
    setAgeVaultForTests(fake.vault)
    expect(ageState()).toBe('checking')
    await readAgeFromDevice()
    expect(ageState()).toBe('ask')
  })

  it('a native storage that fails does not lock the app out and does not lose the answer', async () => {
    setAgeVaultForTests({
      available: () => true,
      load: async () => {
        throw new Error('keystore broken')
      },
      save: async () => {
        throw new Error('keystore broken')
      },
    })
    await readAgeFromDevice()
    expect(ageState()).toBe('ask')
    await declareAge('minor')
    expect(ageState()).toBe('blocked')
    expect(localStorage.getItem(AGE_KEY)).toBe('minor')
  })

  it('a native storage that never answers is given up on after a few seconds', async () => {
    vi.useFakeTimers()
    setAgeVaultForTests({ available: () => true, load: () => new Promise(() => {}), save: () => new Promise(() => {}) })
    const read = readAgeFromDevice()
    expect(ageState()).toBe('checking')
    await vi.advanceTimersByTimeAsync(AGE_VAULT_TIMEOUT_MS + 10)
    await read
    expect(ageState()).toBe('ask')
    const done = declareAge('minor')
    expect(ageState()).toBe('ask')
    await vi.advanceTimersByTimeAsync(AGE_VAULT_TIMEOUT_MS + 10)
    await done
    expect(ageState()).toBe('blocked')
  })

  it('a build without the gate never asks the native layer', async () => {
    setStorePresetForTests(null)
    const fake = fakeVault('minor')
    setAgeVaultForTests(fake.vault)
    expect(ageState()).toBe('open')
    expect(fake.vault.load).not.toHaveBeenCalled()
  })
})

// Check on the iPhone, M1: on iOS the first start of a new installation clears the Keychain, and the answer
// "under 18" went with it. The native rule keeps exactly the entry this file writes.
describe('the answer under 18 outlives a new installation on iOS', () => {
  const read = (...parts: string[]) => fsRead(pathResolve(__dirname, '..', '..', '..', '..', ...parts), 'utf8')

  it('the native rule names the account this vault writes, and the value "minor"', () => {
    const rule = read('src-tauri', 'plugins', 'lu-native', 'ios', 'Sources', 'FreshInstallRule.swift')
    const prefix = /const PARKED_PREFIX: &str = "([^"]+)";/.exec(read('src-tauri', 'src', 'commands', 'secret.rs'))?.[1]
    expect(prefix).toBe('parked-key:')
    expect(rule).toContain(`static let ageAccount = "${prefix}${AGE_VAULT_ID}"`)
    expect(rule).toContain('static let lasting = "minor"')
    expect(rule).toContain('return account == ageAccount && value == lasting')
  })

  it('the clearing reads the answer first and puts it back, and the guard script holds that', () => {
    const secrets = read('src-tauri', 'plugins', 'lu-native', 'ios', 'Sources', 'Secrets.swift')
    const at = (text: string) => secrets.indexOf(text)
    expect(at('rawGet(FreshInstallRule.ageAccount)')).toBeGreaterThan(0)
    expect(at('rawGet(FreshInstallRule.ageAccount)')).toBeLessThan(at('SecItemDelete(query(nil) as CFDictionary)'))
    expect(at('SecItemDelete(query(nil) as CFDictionary)')).toBeLessThan(at('rawSet(FreshInstallRule.ageAccount, age)'))
    expect(read('scripts', 'mobile', 'native-guard-tests.sh')).toContain('FreshInstallRule.survives(account: "parked-key:lu-age-declaration", value: "minor")')
  })
})
