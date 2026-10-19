// @vitest-environment jsdom
/**
 * The "Use locally" button on the cloud character shelf (3.0.7). A Z-Image
 * character goes into this computer's LoRA folder and the local shelves are
 * read again; any other family says that only Z-Image runs locally and saves
 * nothing. A failure lands in the red bar, a file LU cannot vouch for too.
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
import { useCreateStore } from '../../../../stores/createStore'

const ZIMAGE = { id: 'c1', name: 'Anna', trigger_word: 'annachar', base_family: 'z-image', created_at: '' }

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  useCreateStore.setState({ charactersVersion: 0, error: null } as never)
})

describe('Use locally', () => {
  it('another family: says only Z-Image runs locally, saves nothing', async () => {
    render(<CharacterUseLocally lora={{ ...ZIMAGE, base_family: 'flux' }} />)
    fireEvent.click(screen.getByTestId('character-use-locally'))
    expect(await screen.findByText('Only Z-Image characters run locally')).toBeTruthy()
    expect(importCloudCharacter).not.toHaveBeenCalled()
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
