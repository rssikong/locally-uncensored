// @vitest-environment jsdom
/**
 * How-it-works session, 3.0.7: a local training with too few photos said
 * "Add at least 4 photos of your character first (up to 30).", while the
 * drop zone of the same board says "Drop 4 to 100 photos" and the local
 * trainer takes 100. 30 is the cloud's cap. The line now takes its cap from
 * the same constant as the drop zone, per way.
 *
 * Run: npx vitest run src/hooks/__tests__/training-too-few-photos-names-the-local-cap.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

vi.mock('../../api/mlx-image', () => ({
  isMlxImageHost: () => false,
  isMlxImageModel: () => false,
  mlxStatus: vi.fn(async () => ({ installed: false })),
  listMlxImageModels: vi.fn(async () => []),
  buildMlxImageModels: vi.fn(() => []),
  mergeImageModels: vi.fn((a: unknown[]) => a),
  mlxModelIdFor: vi.fn(() => ''),
  generateMlxImageDataUrl: vi.fn(),
}))
vi.mock('../../api/comfyui', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  checkComfyConnection: vi.fn(async () => true),
}))
vi.mock('../../api/trainer', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  clearTrainingSet: vi.fn(async () => { throw new Error('must not stage') }),
}))

import { useCreate } from '../useCreate'
import { useCreateStore } from '../../stores/createStore'
import { maxTrainImages, tooFewTrainPhotosLine } from '../../lib/train-image-cap'

const photo = (name: string) => ({ name, url: `blob:${name}`, blob: new Blob(['x'], { type: 'image/png' }) })

beforeEach(() => {
  useCreateStore.setState({ backend: 'local', isGenerating: false, error: null } as never)
  useCreateStore.getState().setIntent('character')
  useCreateStore.setState({
    cloudOp: 'character', characterTab: 'train', triggerWord: 'davechar',
    trainImages: [photo('a.png'), photo('b.png')],
  } as never)
})

describe('training with too few photos', () => {
  it('locally names the local cap, the one the drop zone says', async () => {
    const { result } = renderHook(() => useCreate())
    await result.current.generate()
    const error = useCreateStore.getState().error ?? ''
    expect(error).toContain(`up to ${maxTrainImages('local')}`)
    expect(error).not.toContain('up to 30')
  })

  it('the line follows the way: 100 local, 30 in the cloud', () => {
    expect(tooFewTrainPhotosLine('local')).toBe('Add at least 4 photos of your character first (up to 100).')
    expect(tooFewTrainPhotosLine('cloud')).toBe('Add at least 4 photos of your character first (up to 30).')
  })
})
