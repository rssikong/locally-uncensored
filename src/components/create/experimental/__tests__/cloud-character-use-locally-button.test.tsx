// @vitest-environment jsdom
/**
 * The "Use locally" button on the cloud character shelf (3.0.7). A Z-Image
 * character goes into this computer's LoRA folder and the local shelves are
 * read again. Any other family has no button at all, only a fixed "Cloud
 * only" label (3.0.8): a customer read the button as a promise and trained a
 * Qwen character for local use. A failure lands in the red bar, a file LU
 * cannot vouch for too.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const importCloudCharacter = vi.fn()
vi.mock('../../../../api/character-import', async (orig) => ({
  ...(await orig<typeof import('../../../../api/character-import')>()),
  importCloudCharacter: (...a: unknown[]) => importCloudCharacter(...a),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
const refreshComfyModels = vi.fn(async () => true)
vi.mock('../../../../api/comfyui', () => ({ refreshComfyModels: () => refreshComfyModels() }))
const clearNodeCache = vi.fn()
vi.mock('../../../../api/comfyui-nodes', () => ({ clearNodeCache: () => clearNodeCache() }))

import { CharacterUseLocally } from '../CharacterUseLocally'
import { CLOUD_TRAINING_FAMILY_NOTE } from '../../../../api/character-import'
import { useCreateStore } from '../../../../stores/createStore'

const ZIMAGE = { id: 'c1', name: 'Anna', trigger_word: 'annachar', base_family: 'z-image', created_at: '' }

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useCreateStore.setState({ charactersVersion: 0, error: null } as never)
})

describe('Use locally', () => {
  it.each(['flux', 'qwen-image', 'ltx-2'])('%s: a fixed Cloud only label, no button', (family) => {
    render(<CharacterUseLocally lora={{ ...ZIMAGE, base_family: family }} />)
    const label = screen.getByTestId('character-cloud-only')
    expect(label.textContent).toBe('Cloud only')
    expect(label.getAttribute('title')).toMatch(/^Only Z-Image characters run locally/)
    expect(screen.queryByTestId('character-use-locally')).toBeNull()
    expect(importCloudCharacter).not.toHaveBeenCalled()
  })

  it('cloud training says before the run which characters stay in the cloud', () => {
    expect(CLOUD_TRAINING_FAMILY_NOTE).toBe('Characters trained on Flux or Qwen run in LU Cloud only. Pick Z-Image to use the character on your machine too.')
  })

  it('a Z-Image character gets the button and no label', () => {
    render(<CharacterUseLocally lora={ZIMAGE} />)
    expect(screen.getByTestId('character-use-locally')).toBeTruthy()
    expect(screen.queryByTestId('character-cloud-only')).toBeNull()
  })

  it('a Z-Image character is saved, ComfyUI rescans and the shelves read again', async () => {
    importCloudCharacter.mockResolvedValue({ status: 'saved', file: 'char_annachar_zimage.safetensors', keyFormat: 'same' })
    render(<CharacterUseLocally lora={ZIMAGE} />)
    fireEvent.click(screen.getByTestId('character-use-locally'))
    expect(await screen.findByText('Saved for local use')).toBeTruthy()
    expect(refreshComfyModels).toHaveBeenCalledOnce()
    expect(clearNodeCache).toHaveBeenCalledOnce()
    expect(useCreateStore.getState().charactersVersion).toBe(1)
    expect(useCreateStore.getState().error).toBeNull()
  })

  it('an unknown key layout is saved and said in the red bar', async () => {
    importCloudCharacter.mockResolvedValue({ status: 'saved', file: 'char_annachar_zimage.safetensors', keyFormat: 'unknown' })
    render(<CharacterUseLocally lora={ZIMAGE} />)
    fireEvent.click(screen.getByTestId('character-use-locally'))
    await waitFor(() => expect(useCreateStore.getState().error).toMatch(/laid out differently/))
  })

  it('a name already taken is an error, and the shelves stay as they are', async () => {
    importCloudCharacter.mockRejectedValue(new Error('A local character named char_annachar_zimage.safetensors is already on this computer.'))
    render(<CharacterUseLocally lora={ZIMAGE} />)
    fireEvent.click(screen.getByTestId('character-use-locally'))
    await waitFor(() => expect(useCreateStore.getState().error).toMatch(/^Use locally failed: A local character named/))
    expect(useCreateStore.getState().charactersVersion).toBe(0)
  })
})
