/**
 * A cloud character used locally (3.0.7, trained characters everywhere). The
 * backend saves the weights as char_<trigger>_zimage.safetensors in this
 * host's LoRA folder, the name the local shelf reads. Only Z-Image characters
 * go; every other family is refused before anything is asked of the backend.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  getAccessToken: vi.fn(),
  invoke: vi.fn(),
  listeners: [] as Array<(e: { payload: unknown }) => void>,
  unlisten: vi.fn(),
}))
vi.mock('../cloud/supabase', () => ({ getAccessToken: h.getAccessToken }))
vi.mock('../backend', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: h.invoke }))
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: (e: { payload: unknown }) => void) => {
    h.listeners.push(handler)
    return h.unlisten
  }),
}))

import { canUseLocally, importCloudCharacter, keyFormatNote, ONLY_ZIMAGE_LOCALLY } from '../character-import'
import { CLOUD_BASE } from '../cloud/config'
import { parseLocalCharacterLora } from '../trainer'

const ZIMAGE = { id: 'abc-1', name: 'Anna', trigger_word: 'annachar', base_family: 'z-image' }

beforeEach(() => {
  vi.clearAllMocks()
  h.listeners.length = 0
  h.getAccessToken.mockResolvedValue('tok-1')
})

describe('use a cloud character locally', () => {
  it('only Z-Image characters can, in any spelling of the family', () => {
    expect(canUseLocally({ base_family: 'z-image' })).toBe(true)
    expect(canUseLocally({ base_family: 'zimage' })).toBe(true)
    expect(canUseLocally({ base_family: 'flux' })).toBe(false)
    expect(canUseLocally({ base_family: 'qwen-image' })).toBe(false)
  })

  it('another family is refused with the reason, and the backend is not asked', async () => {
    await expect(importCloudCharacter({ ...ZIMAGE, base_family: 'flux' })).rejects.toThrow(ONLY_ZIMAGE_LOCALLY)
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('hands the backend the route, the token and the trigger word, and answers the shelf file', async () => {
    h.invoke.mockResolvedValue({ status: 'saved', file: 'char_annachar_zimage.safetensors', path: '/x', bytes: 9, keyFormat: 'same' })
    const result = await importCloudCharacter(ZIMAGE)
    expect(h.invoke).toHaveBeenCalledExactlyOnceWith('import_cloud_character', {
      id: expect.stringMatching(/^lora-import-abc-1-\d+$/),
      url: `${CLOUD_BASE}/api/loras/abc-1/file`,
      authToken: 'tok-1',
      triggerWord: 'annachar',
      name: 'Anna',
    })
    expect(result).toEqual({ status: 'saved', file: 'char_annachar_zimage.safetensors', keyFormat: 'same' })
    // The local shelf reads it as the same character.
    expect(parseLocalCharacterLora(result.status === 'saved' ? result.file : '')?.trigger).toBe('annachar')
  })

  it('a character of that name on this computer is not replaced, and the message says what to do', async () => {
    h.invoke.mockResolvedValue({ status: 'exists', file: 'char_annachar_zimage.safetensors' })
    await expect(importCloudCharacter(ZIMAGE)).rejects.toThrow(/already on this computer\. Delete it/)
  })

  it('no LoRA folder, a refusal and a cancel each say so', async () => {
    h.invoke.mockResolvedValueOnce({ status: 'no_comfy' })
    await expect(importCloudCharacter(ZIMAGE)).rejects.toThrow(/No LoRA folder/)
    h.invoke.mockResolvedValueOnce({ status: 'refused', code: 404 })
    await expect(importCloudCharacter(ZIMAGE)).rejects.toThrow('This character is no longer on your account.')
    h.invoke.mockResolvedValueOnce({ status: 'stopped' })
    await expect(importCloudCharacter(ZIMAGE)).resolves.toEqual({ status: 'stopped' })
  })

  it('a cancel reaches the backend under the id of this run', async () => {
    const controller = new AbortController()
    h.invoke.mockImplementation(async (command: string, args: { id: string }) => {
      if (command === 'import_cloud_character') {
        controller.abort()
        expect(h.invoke).toHaveBeenCalledWith('cancel_cloud_file', { id: args.id })
        return { status: 'stopped' }
      }
      return undefined
    })
    await expect(importCloudCharacter(ZIMAGE, () => {}, controller.signal)).resolves.toEqual({ status: 'stopped' })
    expect(h.unlisten).toHaveBeenCalledOnce()
  })

  it('a key layout LU does not know is said, a known one is not', () => {
    expect(keyFormatNote('unknown')).toMatch(/laid out differently/)
    expect(keyFormatNote('same')).toBeNull()
    expect(keyFormatNote('known')).toBeNull()
  })
})
