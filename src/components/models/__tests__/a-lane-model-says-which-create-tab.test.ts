/**
 * @vitest-environment jsdom
 *
 * Discord, thread "I can't launch Wan2.2" (15.10.2026): once the Wan 2.2
 * Animate file was listed at all, its row still said only "Video", and the
 * reporter looked for it in Create's Video tab, where it is not offered and
 * cannot run. The row now names the tab it runs in.
 *
 * Run: npx vitest run src/components/models/__tests__/a-lane-model-says-which-create-tab.test.ts
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import type { AIModel } from '../../../types/models'

vi.mock('../ModelBenchmark', () => ({ BenchmarkButton: () => null }))

const { ModelCard } = await import('../ModelCard')

const row = (name: string, architecture: string): AIModel => ({
  name, model: name, size: 0, format: 'gguf', architecture,
  type: 'video', providerName: 'ComfyUI', source: 'diffusion_model',
} as AIModel)

const draw = (model: AIModel) => render(createElement(ModelCard, {
  model, isActive: false, onSelect: () => {}, onDelete: () => {}, onInfo: () => {},
}))

afterEach(cleanup)

describe('a specialised video row names its Create tab', () => {
  it('Wan 2.2 Animate points at Motion Control', () => {
    draw(row('Wan2.2-Animate-14B-Q4_K_M.gguf', 'wananimate'))
    expect(screen.getByTestId('model-card-create-tab').textContent).toBe('in Create: Motion Control')
  })

  it('Wan VACE points at Motion Control, S2V at Talking Character', () => {
    draw(row('wan2.1_vace_1.3B_fp16.safetensors', 'wanvace'))
    expect(screen.getByTestId('model-card-create-tab').textContent).toBe('in Create: Motion Control')
    cleanup()
    draw(row('Wan2.2-S2V-14B-Q4_K_M.gguf', 'wans2v'))
    expect(screen.getByTestId('model-card-create-tab').textContent).toBe('in Create: Talking Character')
  })

  it('a plain video model says nothing extra', () => {
    draw(row('wan2.2_ti2v_5B_fp16.safetensors', 'wan22'))
    expect(screen.queryByTestId('model-card-create-tab')).toBeNull()
  })
})
