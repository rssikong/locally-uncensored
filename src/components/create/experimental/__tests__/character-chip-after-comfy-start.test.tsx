// @vitest-environment jsdom
/**
 * Box run d307-d: the first time Create opens after the app starts, ComfyUI
 * is still starting, the LoRA list comes back empty and the character chip
 * stayed hidden until Create was opened again. The chip and the "Trained
 * characters" row now list again whenever Create's LoRA list changes.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/character-chip-after-comfy-start.test.tsx
 */
import { describe, expect, it, vi } from 'vitest'
import { act, render, screen } from '@testing-library/react'

const state = vi.hoisted(() => ({ loras: [] as string[] }))

vi.mock('../../../../api/mlx-image', async () => ({
  ...(await vi.importActual<Record<string, unknown>>('../../../../api/mlx-image')),
  isMlxImageHost: () => false,
}))
vi.mock('../../../../api/comfyui', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/comfyui')>('../../../../api/comfyui')
  return { ...actual, getLoraModels: vi.fn(async () => state.loras) }
})

import { CharacterChip } from '../CharacterChip'
import { useCreateStore } from '../../../../stores/createStore'

describe('the character chip after ComfyUI comes up', () => {
  it('appears once the LoRA list arrives, without opening Create again', async () => {
    useCreateStore.setState({ backend: 'local', cloudOp: null, utilityOp: null, removebg: false, selectedCharacter: null } as never)
    useCreateStore.getState().setIntent('image')
    const view = render(<CharacterChip />)
    await act(async () => { await Promise.resolve() })
    expect(screen.queryByRole('button', { name: /character/i })).toBeNull()

    // ComfyUI answers: Create reads the LoRAs and its list key changes.
    state.loras = ['char_mira_zimage.safetensors']
    act(() => useCreateStore.getState().setLoraListKey(state.loras))
    view.rerender(<CharacterChip />)
    expect(await screen.findByRole('button', { name: /character/i })).toBeTruthy()
  })
})
