// @vitest-environment jsdom
/**
 * Edit with a trained character (3.0.7): a click on a local character at the
 * reference strip loads the photos it was trained on, the same way a saved
 * character loads its photos. With a source loaded they join the strip.
 * Only characters with kept photos are offered.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../loadImage', () => ({
  loadImageRef: vi.fn(async (file: File) => ({ filename: file.name, url: `blob:${file.name}`, width: 8, height: 8 })),
}))
const trainingPhotos = vi.fn()
vi.mock('../../../../lib/character-photos', async (orig) => ({
  ...(await orig<typeof import('../../../../lib/character-photos')>()),
  trainingPhotos: (...a: unknown[]) => trainingPhotos(...a),
}))

import { charactersWithPhotos, loadTrainingPhotos } from '../TrainedCharacterChips'
import { useCreateStore, type ImageRef } from '../../../../stores/createStore'
import type { CharacterRef } from '../../../../lib/characters'

const ref = (filename: string): ImageRef => ({ filename, url: `blob:${filename}`, width: 8, height: 8 })
const MIRA: CharacterRef = { id: 'local:char_mira_zimage.safetensors', name: 'mira', triggerWord: 'mira', family: 'zimage' }
const JPEG = 'data:image/jpeg;base64,AAAA'

beforeEach(() => {
  vi.clearAllMocks()
  useCreateStore.setState({
    backend: 'local', cloudOp: null, utilityOp: null, removebg: false,
    source: null, mask: null, references: [], batchSources: [],
  } as never)
  useCreateStore.getState().setIntent('edit')
})

describe('a trained character in Edit', () => {
  it('a source is loaded: it stays, and the training photos join the strip', async () => {
    useCreateStore.setState({ source: ref('street.png') } as never)
    trainingPhotos.mockResolvedValue([JPEG, JPEG, JPEG])
    expect(await loadTrainingPhotos(MIRA, 3)).toBe(3)
    const s = useCreateStore.getState()
    expect(s.source?.filename).toBe('street.png')
    expect(s.references.map((r) => r.filename)).toEqual(['mira-01.jpg', 'mira-02.jpg', 'mira-03.jpg'])
    // Never more fetched than the model has reference slots.
    expect(trainingPhotos).toHaveBeenCalledWith(MIRA, 3)
  })

  it('no kept photos: a clear error, nothing loaded', async () => {
    trainingPhotos.mockResolvedValue([])
    await expect(loadTrainingPhotos(MIRA, 2)).rejects.toThrow('No training photos of mira are kept on this computer.')
    expect(useCreateStore.getState().references).toEqual([])
  })

  it('only local characters with photos are offered', async () => {
    const list = async (): Promise<CharacterRef[]> => [
      MIRA,
      { id: 'local:char_ben_zimage.safetensors', name: 'ben', triggerWord: 'ben', family: 'zimage' },
      { id: 'mlx:char_mac_zimage.safetensors', name: 'mac', triggerWord: 'mac', family: 'zimage' },
    ]
    const count = vi.fn(async (r: CharacterRef) => (r.name === 'mira' ? 3 : 0))
    const offered = await charactersWithPhotos(list, count)
    expect(offered).toEqual([{ ref: MIRA, count: 3 }])
    expect(count).toHaveBeenCalledTimes(2)
  })
})
