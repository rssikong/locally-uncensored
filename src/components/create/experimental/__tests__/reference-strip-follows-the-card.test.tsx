// @vitest-environment jsdom
/**
 * Through ComfyUI the line under the reference strip follows what the graphics
 * card carries (lib/comfy-edit-memory), so the edit that would end in "aimdo
 * memory compile error" (Discord #bug-reports, 12.10. and 17.10.2026) is named
 * before Create is pressed.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/reference-strip-follows-the-card.test.tsx
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const card = vi.hoisted(() => ({ gb: null as number | null }))
vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => card.gb }))

import { ReferenceStrip } from '../ReferenceStrip'
import { useCreateStore } from '../../../../stores/createStore'

const SOURCE = { filename: 'scene.png', url: 'data:image/png;base64,scene', width: 8, height: 8 }
const QWEN21 = 'qwen_image_2.1_int8_convrot.safetensors'
const EDIT_PLUS = 'qwen_image_edit_2509_fp8_e4m3fn.safetensors'
const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ ...SOURCE, filename: `r${i}.png`, url: `data:image/png;base64,r${i}` }))

function editWith(model: string, type: string, references: number) {
  useCreateStore.setState({ backend: 'local', imageModel: model, imageModelList: [{ name: model, type }] as never, references: [] })
  useCreateStore.getState().setIntent('edit')
  useCreateStore.getState().setSource(SOURCE)
  useCreateStore.setState({ references: refs(references) })
}

const line = () => screen.getByTestId('reference-strip').parentElement!.textContent ?? ''

beforeEach(() => {
  cleanup()
  card.gb = null
})

describe('Qwen-Image 2.1', () => {
  it('on a 12 GB card three images already come out smaller', () => {
    card.gb = 12
    editWith(QWEN21, 'qwenimage', 2)
    render(<ReferenceStrip />)
    expect(line()).toContain('With this many images the edit comes out smaller, so it fits in memory.')
  })

  it('on a 12 GB card two images keep their size', () => {
    card.gb = 12
    editWith(QWEN21, 'qwenimage', 1)
    render(<ReferenceStrip />)
    expect(line()).not.toContain('comes out smaller')
  })

  it('an unknown card keeps the old line from five images on', () => {
    editWith(QWEN21, 'qwenimage', 3)
    render(<ReferenceStrip />)
    expect(line()).not.toContain('comes out smaller')
  })
})

describe('Qwen-Image-Edit', () => {
  it('on a 12 GB card the source and two references are named as too many', () => {
    card.gb = 12
    editWith(EDIT_PLUS, 'qwenimage1', 2)
    render(<ReferenceStrip />)
    expect(line()).toContain('With 12 GB of graphics memory, Qwen-Image-Edit takes the source and one more image.')
    expect(line()).toContain('Remove one image from the strip')
    expect(line()).not.toContain('comes out smaller')
  })

  it('on a 16 GB card it says nothing about the card', () => {
    card.gb = 16
    editWith(EDIT_PLUS, 'qwenimage1', 2)
    render(<ReferenceStrip />)
    expect(line()).not.toContain('graphics memory')
  })
})
