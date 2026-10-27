import { describe, expect, it } from 'vitest'
import { createMemoryTokenVault, createMigratingTokenVault, type TokenVault } from '../tokenVault'

const A = 'http://192.168.1.10:11435'
const B = 'http://192.168.1.99:11435'

function failingVault(): TokenVault {
  return {
    load: async () => null,
    save: async () => {
      throw new Error('keychain locked')
    },
    clear: async () => {
      throw new Error('keychain locked')
    },
  }
}

describe('the Remote token moves into the secure storage', () => {
  it('reads from the secure storage first', async () => {
    const secure = createMemoryTokenVault()
    const legacy = createMemoryTokenVault()
    await secure.save(A, 'new-token')
    await legacy.save(A, 'old-token')
    const vault = createMigratingTokenVault(secure, legacy)
    expect(await vault.load(A)).toBe('new-token')
  })

  it('a token of an older build moves over once and leaves the unencrypted place', async () => {
    const secure = createMemoryTokenVault()
    const legacy = createMemoryTokenVault()
    await legacy.save(A, 'old-token')
    const vault = createMigratingTokenVault(secure, legacy)
    expect(await vault.load(A)).toBe('old-token')
    expect(await secure.load(A)).toBe('old-token')
    expect(await legacy.load(A)).toBeNull()
  })

  it('never hands a token out for another address, old or new', async () => {
    const secure = createMemoryTokenVault()
    const legacy = createMemoryTokenVault()
    await legacy.save(A, 'old-token')
    const vault = createMigratingTokenVault(secure, legacy)
    expect(await vault.load(B)).toBeNull()
    await vault.save(A, 'new-token')
    expect(await vault.load(B)).toBeNull()
  })

  it('writes only to the secure storage and empties the old place', async () => {
    const secure = createMemoryTokenVault()
    const legacy = createMemoryTokenVault()
    await legacy.save(A, 'old-token')
    const vault = createMigratingTokenVault(secure, legacy)
    await vault.save(A, 'new-token')
    expect(await secure.load(A)).toBe('new-token')
    expect(await legacy.load(A)).toBeNull()
  })

  it('a secure storage that refuses is an error, not a silent fall back to the unencrypted place', async () => {
    const legacy = createMemoryTokenVault()
    const vault = createMigratingTokenVault(failingVault(), legacy)
    await expect(vault.save(A, 'new-token')).rejects.toThrow('keychain locked')
    expect(await legacy.load(A)).toBeNull()
  })

  it('an old token still works for this session when it cannot move, and does not stay behind', async () => {
    const legacy = createMemoryTokenVault()
    await legacy.save(A, 'old-token')
    const vault = createMigratingTokenVault(failingVault(), legacy)
    expect(await vault.load(A)).toBe('old-token')
    expect(await legacy.load(A)).toBeNull()
  })

  it('clear empties both and does not throw when one of them fails', async () => {
    const legacy = createMemoryTokenVault()
    await legacy.save(A, 'old-token')
    const vault = createMigratingTokenVault(failingVault(), legacy)
    await expect(vault.clear()).resolves.toBeUndefined()
    expect(await legacy.load(A)).toBeNull()
  })
})
