/**
 * The training photos of a local character, for Edit (3.0.7). The backend
 * reads them from the training set; this side asks only for characters
 * trained on this machine and never for more than a model reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({ backendCall: vi.fn(), tauri: true }))
vi.mock('../../api/backend', () => ({ backendCall: h.backendCall, isTauri: () => h.tauri }))

import { photoBlobs, trainingPhotoCount, trainingPhotos } from '../character-photos'
import { photosOf, type CharacterRef } from '../characters'
import { MAX_CHARACTER_PHOTOS } from '../edit-references'

const LOCAL: CharacterRef = { id: 'local:char_mira_zimage.safetensors', name: 'mira', triggerWord: 'mira', family: 'zimage' }
const CLOUD: CharacterRef = { id: '0b9d7c1e-aaaa', name: 'Mira', triggerWord: 'mira', family: 'z-image' }
const MAC: CharacterRef = { id: 'mlx:char_mira_zimage.safetensors', name: 'mira', triggerWord: 'mira', family: 'zimage' }

beforeEach(() => {
  vi.clearAllMocks()
  h.tauri = true
  h.backendCall.mockResolvedValue({ count: 2, photos: [
    { name: 'a.jpg', mime: 'image/jpeg', base64: 'AAAA' },
    { name: 'b.webp', mime: 'image/webp', base64: 'BBBB' },
  ] })
})

describe('training photos of a character', () => {
  it('a local character asks the backend for its file, capped at the most any model reads', async () => {
    const urls = await trainingPhotos(LOCAL, 99)
    expect(h.backendCall).toHaveBeenCalledExactlyOnceWith('character_photos', {
      file: 'char_mira_zimage.safetensors', max: MAX_CHARACTER_PHOTOS, countOnly: false,
    })
    expect(urls).toEqual(['data:image/jpeg;base64,AAAA', 'data:image/webp;base64,BBBB'])
  })

  it('photosOf of the shared module answers the same photos', async () => {
    expect(await photosOf(LOCAL)).toHaveLength(2)
  })

  it('a cloud or Mac character, or no desktop app, asks nobody and has none', async () => {
    expect(await trainingPhotos(CLOUD)).toEqual([])
    expect(await trainingPhotos(MAC)).toEqual([])
    h.tauri = false
    expect(await trainingPhotos(LOCAL)).toEqual([])
    expect(await trainingPhotoCount(LOCAL)).toBe(0)
    expect(h.backendCall).not.toHaveBeenCalled()
  })

  it('counting asks for no bytes', async () => {
    h.backendCall.mockResolvedValue({ count: 3, photos: [] })
    expect(await trainingPhotoCount(LOCAL, 2)).toBe(3)
    expect(h.backendCall).toHaveBeenCalledWith('character_photos', { file: 'char_mira_zimage.safetensors', max: 2, countOnly: true })
  })

  it('the data URLs become Blobs of their own type', () => {
    const [a, b] = photoBlobs(['data:image/jpeg;base64,AAAA', 'data:image/webp;base64,BBBB'])
    expect(a.type).toBe('image/jpeg')
    expect(b.type).toBe('image/webp')
  })
})
