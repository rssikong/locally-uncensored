// @vitest-environment jsdom
/**
 * Discord (Forum "Improved Minimax H3 Support", 20.10.2026):
 * MiniMax H3 takes up to 362 frames in the advanced settings, but the Frames
 * slider in the row above the prompt still ran 9 to 121 for every model. With
 * 362 frames set it drew its bar three times its own width, across the screen.
 * The row now has the family's own range, the same as the advanced settings.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/h3-frames-in-der-normalansicht.test.tsx
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: null,
    samplerList: ['euler'], schedulerList: ['simple'], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
    connected: true, modelsLoaded: true, modelLoadError: null, mlxMissing: null,
    installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  openExternal: vi.fn(),
}))
vi.mock('../../../../api/workflow-import', () => ({ loadNodeDefs: async () => null }))

const { Composer } = await import('../Composer')
const { Slider } = await import('../../ui/Slider')
const { useCreateStore } = await import('../../../../stores/createStore')

const H3 = 'minimax_h3_i2v_fp8.safetensors'

function setup(intent: 'animate' | 'video', model: string, type: string, frames: number) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], source: null,
    videoModelList: [{ name: model, type }], videoModel: model,
  } as never)
  useCreateStore.getState().setIntent(intent)
  useCreateStore.setState({ videoModel: model } as never)
  useCreateStore.getState().setFrames(frames)
}

const framesInput = () => {
  const label = screen.getByText('Frames')
  return label.closest('.space-y-1\\.5')!.querySelector('input[type="range"]') as HTMLInputElement
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the Frames slider above the prompt', () => {
  it('runs to 362 for MiniMax H3 and shows 362 frames where the advanced settings put them', () => {
    setup('animate', H3, 'minimaxh3', 362)
    render(createElement(Composer, { onOpenAdvanced: () => {}, onOpenWorkflows: () => {} }))
    const input = framesInput()
    expect(input.max).toBe('362')
    expect(input.value).toBe('362')
    expect(screen.getByText(/^362f · /)).toBeTruthy()
  })

  it('keeps 1 to 121 for Wan', () => {
    setup('video', 'wan2.2_t2v_14B_fp8.safetensors', 'wan', 81)
    render(createElement(Composer, { onOpenAdvanced: () => {}, onOpenWorkflows: () => {} }))
    expect(framesInput().max).toBe('121')
    expect(framesInput().value).toBe('81')
  })
})

describe('the Slider', () => {
  it('keeps its bar and thumb inside the track for a value past either end', () => {
    const { container, rerender } = render(createElement(Slider, { label: 'Frames', min: 9, max: 121, step: 4, value: 362, onChange: () => {} }))
    const bar = () => container.querySelector('.bg-gray-400') as HTMLElement
    expect(bar().style.width).toBe('100%')
    rerender(createElement(Slider, { label: 'Frames', min: 9, max: 121, step: 4, value: 1, onChange: () => {} }))
    expect(bar().style.width).toBe('0%')
  })
})
