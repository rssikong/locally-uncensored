// @vitest-environment jsdom
/**
 * GH #144 and Discord (a user 2026-09-23 and 09-27, a user 2026-09-25): Edit
 * took one image. The strip under the source (layout the owner picked on
 * 2026-10-01) adds references for a model that takes them, and only there.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/edit-takes-more-than-one-image.test.tsx
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../loadImage', () => ({
  loadImageRef: vi.fn(async (f: File) => ({ filename: `up_${f.name}`, url: `data:image/png;base64,${f.name}`, width: 8, height: 8 })),
}))

import { ReferenceStrip } from '../ReferenceStrip'
import { useCreateStore } from '../../../../stores/createStore'
import { extraReferenceSlots, referenceNames } from '../../../../lib/edit-references'

const SOURCE = { filename: 'scene.png', url: 'data:image/png;base64,scene', width: 8, height: 8 }
const QWEN21 = 'qwen_image_2.1_int8_convrot.safetensors'

function editWith(model: string, type: string, backend: 'local' | 'cloud' = 'local') {
  useCreateStore.setState({
    backend,
    imageModel: model,
    imageModelList: [{ name: model, type }] as never,
    references: [],
  })
  useCreateStore.getState().setIntent('edit')
  useCreateStore.getState().setSource(SOURCE)
}

beforeEach(() => cleanup())

describe('which models take references', () => {
  it('Qwen-Image 2.1 takes nine besides the source (ten in all), Qwen-Image-Edit two, SDXL none', () => {
    expect(extraReferenceSlots('qwenimage', QWEN21)).toBe(9)
    expect(extraReferenceSlots('qwenimage1', 'qwen_image_edit_2509_fp8.safetensors')).toBe(2)
    expect(extraReferenceSlots('qwenimage1', 'qwen_image_fp8.safetensors')).toBe(0)
    expect(extraReferenceSlots('sdxl', 'juggernautXL.safetensors')).toBe(0)
  })
})

describe('the reference strip', () => {
  it('shows under a Qwen-Image 2.1 edit and adds an image as image 2', async () => {
    editWith(QWEN21, 'qwenimage')
    render(<ReferenceStrip />)
    expect(screen.getByText(/Add up to 9 more images/)).toBeTruthy()
    const input = screen.getByTestId('reference-strip').querySelector('input[type=file]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'person.png', { type: 'image/png' })] } })
    await screen.findByAltText('image 2')
    expect(useCreateStore.getState().references.map((r) => r.filename)).toEqual(['up_person.png'])
    expect(screen.getByText('Name them in the prompt as image 2.')).toBeTruthy()
  })

  it('removing the source drops its references too', () => {
    editWith(QWEN21, 'qwenimage')
    useCreateStore.getState().addReference(SOURCE)
    useCreateStore.getState().setSource(null)
    expect(useCreateStore.getState().references).toEqual([])
  })

  // Negative controls: a model with one slot, and the cloud backend.
  it('is not there for an SDXL checkpoint', () => {
    editWith('juggernautXL.safetensors', 'sdxl')
    render(<ReferenceStrip />)
    expect(screen.queryByTestId('reference-strip')).toBeNull()
  })

  it('is not there on the cloud backend', () => {
    editWith(QWEN21, 'qwenimage', 'cloud')
    render(<ReferenceStrip />)
    expect(screen.queryByTestId('reference-strip')).toBeNull()
  })
})

describe('many references (Discord D7: up to ten images)', () => {
  const refs = (n: number) => Array.from({ length: n }, (_, i) => ({ ...SOURCE, filename: `r${i}.png`, url: `data:image/png;base64,r${i}` }))

  it('names one or two by name and more as a range', () => {
    expect(referenceNames(0)).toBe('')
    expect(referenceNames(1)).toBe('image 2')
    expect(referenceNames(2)).toBe('image 2, image 3')
    expect(referenceNames(3)).toBe('image 2 to image 4')
    expect(referenceNames(9)).toBe('image 2 to image 10')
  })

  it('nine references on ComfyUI: all nine tiles, no tenth, the range and the size note', () => {
    editWith(QWEN21, 'qwenimage')
    useCreateStore.setState({ references: refs(9) })
    render(<ReferenceStrip />)
    expect(screen.getByTestId('reference-strip').querySelectorAll('img')).toHaveLength(9)
    expect(screen.queryByTitle('Add another image the edit can use')).toBeNull()
    expect(screen.getByText('Name them in the prompt as image 2 to image 10. With this many images, say what each one brings, for example "the scarf from image 3". With this many images the edit comes out smaller, so it fits in memory.')).toBeTruthy()
  })

  it('up to four images in all there is no size note', () => {
    editWith(QWEN21, 'qwenimage')
    useCreateStore.setState({ references: refs(3) })
    render(<ReferenceStrip />)
    expect(screen.getByText('Name them in the prompt as image 2 to image 4.')).toBeTruthy()
  })
})
