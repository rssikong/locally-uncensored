// @vitest-environment jsdom
/**
 * A19 (3.0.8): Wan 2.1 clips are mp4 now, but the galleries already hold the
 * animated .webp files it wrote before, as entries of type 'video'. A <video>
 * can't decode webp and showed them as a dead player; an <img> animates them.
 * New mp4 clips keep their player.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/an-old-webp-clip-still-moves.test.tsx
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { ResultView } from '../OutputView'
import { playsAsVideo } from '../galleryUrl'
import type { GalleryItem } from '../../../../stores/createStore'

beforeEach(() => {
  cleanup()
})

function clip(filename: string): GalleryItem {
  return {
    id: 'v1', type: 'video', filename, subfolder: '',
    prompt: 'a fox running through snow', negativePrompt: '',
    model: 'wan2.1_t2v_1.3B_fp16.safetensors', modelType: 'wan',
    seed: 7, steps: 20, cfgScale: 6, sampler: 'uni_pc', scheduler: 'simple',
    width: 832, height: 480, batchSize: 1, createdAt: Date.now(),
  }
}

describe('playsAsVideo', () => {
  it('an mp4 or webm clip plays in a player', () => {
    expect(playsAsVideo(clip('fox_00001_.mp4'))).toBe(true)
    expect(playsAsVideo(clip('fox_00001_.webm'))).toBe(true)
  })

  it('an animated picture stays a picture', () => {
    expect(playsAsVideo(clip('fox_00001_.webp'))).toBe(false)
    expect(playsAsVideo(clip('fox_00001_.GIF'))).toBe(false)
  })

  it('a picture is never a clip', () => {
    expect(playsAsVideo({ ...clip('fox_00001_.png'), type: 'image' })).toBe(false)
  })
})

describe('the result view', () => {
  it('shows an old webp clip as a moving picture', () => {
    const { container } = render(<ResultView item={clip('fox_00001_.webp')} onFullscreen={() => {}} />)
    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toContain('fox_00001_.webp')
  })

  it('plays a new mp4 clip with controls', () => {
    const { container } = render(<ResultView item={clip('fox_00001_.mp4')} onFullscreen={() => {}} />)
    const video = container.querySelector('video')
    expect(video?.getAttribute('src')).toContain('fox_00001_.mp4')
    expect(video?.hasAttribute('controls')).toBe(true)
  })
})
