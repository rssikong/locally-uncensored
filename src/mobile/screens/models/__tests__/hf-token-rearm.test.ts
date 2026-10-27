/**
 * vollstaendigkeit-2 M2: the Hugging Face token survives a restart.
 *
 * The keychain keeps the token, the native downloader holds it in memory
 * only. After a start the stored token has to be handed over again, or a
 * download from a gated repo ends with 401 while the page says "stored".
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/hf-token-rearm.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const io = vi.hoisted(() => ({
  stored: null as string | null,
  failRead: false,
  failApply: false,
  applied: [] as string[],
}))

vi.mock('../../../../api/backend', () => ({
  secretGet: async () => {
    if (io.failRead) throw new Error('keystore locked')
    return io.stored
  },
  secretSet: async (_account: string, value: string) => {
    io.stored = value
  },
  secretDelete: async () => {
    io.stored = null
  },
}))
vi.mock('../../../../api/mlx-image', () => ({
  HF_TOKEN_ACCOUNT: 'hf-token',
  applyHfToken: async (token: string) => {
    if (io.failApply) throw new Error('no bridge')
    io.applied.push(token)
    return { present: !!token }
  },
}))

import { rearmHfToken, removeHfToken, saveHfToken } from '../parts/adapters/hf-token'

beforeEach(() => {
  io.stored = null
  io.failRead = false
  io.failApply = false
  io.applied = []
})

describe('the stored token after a restart', () => {
  it('is handed to the native downloader', async () => {
    io.stored = 'hf_made_up_test_value'
    expect(await rearmHfToken()).toBe(true)
    expect(io.applied).toEqual(['hf_made_up_test_value'])
  })

  it('nothing stored: nothing is handed over, and no empty token clears a later one', async () => {
    expect(await rearmHfToken()).toBe(false)
    expect(io.applied).toEqual([])
  })

  it('a keychain that cannot be read or a missing bridge does not throw', async () => {
    io.failRead = true
    expect(await rearmHfToken()).toBe(false)
    io.failRead = false
    io.stored = 'hf_made_up_test_value'
    io.failApply = true
    expect(await rearmHfToken()).toBe(false)
  })

  it('save, restart, remove: the downloader follows every step', async () => {
    expect(await saveHfToken('hf_made_up_test_value')).toBe(true)
    io.applied = []
    expect(await rearmHfToken()).toBe(true)
    expect(await removeHfToken()).toBe(true)
    expect(io.applied).toEqual(['hf_made_up_test_value', ''])
    expect(await rearmHfToken()).toBe(false)
  })
})

describe('the hand over runs at every start', () => {
  it('the watch of this strand calls it before partial downloads are adopted', () => {
    const watch = readFileSync(resolve(__dirname, '../parts/watch.ts'), 'utf8')
    const start = watch.slice(watch.indexOf('async function afterStart'))
    const rearm = start.indexOf('await rearmHfToken()')
    expect(rearm).toBeGreaterThan(-1)
    expect(rearm).toBeLessThan(start.indexOf('await adoptPartials()'))
  })
})

describe('a build without the token field (store switch gatedModelToken)', () => {
  it('hands no stored token over, clears what the downloader holds and leaves the stored one alone', async () => {
    const { setStorePresetForTests } = await import('../../../policy/storePolicy')
    // Both store builds since r56 (18.10.2026): the token follows customModelUrl.
    for (const store of ['appstore', 'play'] as const) {
      setStorePresetForTests(store)
      io.applied = []
      try {
        io.stored = 'hf_made_up_test_value'
        expect(await rearmHfToken()).toBe(false)
        expect(io.applied).toEqual([''])
        expect(io.stored).toBe('hf_made_up_test_value')
        // A save that still reaches the adapter keeps the value and sends it nowhere.
        io.applied = []
        expect(await saveHfToken('hf_another_made_up_value')).toBe(true)
        expect(io.applied).toEqual([])
      } finally {
        setStorePresetForTests(null)
      }
    }
  })

  it('the open build still hands it over', async () => {
    const { setStorePresetForTests } = await import('../../../policy/storePolicy')
    setStorePresetForTests('open')
    io.applied = []
    try {
      io.stored = 'hf_made_up_test_value'
      expect(await rearmHfToken()).toBe(true)
      expect(io.applied).toEqual(['hf_made_up_test_value'])
    } finally {
      setStorePresetForTests(null)
    }
  })
})
