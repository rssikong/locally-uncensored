// @vitest-environment jsdom
/**
 * The reference strip of Edit on a Mac offers only as many slots as the Mac's
 * memory takes at the canvas set in Create (lib/mac-edit-memory, LU 3.0.8),
 * instead of the engine refusing the run at Create. Where not one further
 * image fits, a quiet line says why. Images already in the strip past that
 * stay and are marked not sent. Windows, Linux and the cloud are unchanged.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/mac-edit-reference-slots-follow-memory.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const memory = vi.hoisted(() => ({ gb: 0 }))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => true, MLX_MODEL_PREFIX: 'MLX ' }))
vi.mock('../../../../lib/hardware', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  getSharedMemoryGb: vi.fn(async () => memory.gb),
}))

import { ReferenceStrip } from '../ReferenceStrip'
import { forgetMacMemoryForTests } from '../referenceSlots'
import { useCreateStore } from '../../../../stores/createStore'
import type { ClassifiedModel } from '../../../../api/comfyui'

const MAC_QWEN: ClassifiedModel = { name: 'MLX Qwen-Image 2.1 4-bit', type: 'qwenimage', source: 'checkpoint', editImages: 10, packGb: 10.6 }
const COMFY_QWEN: ClassifiedModel = { name: 'qwen_image_2.1_int8_convrot.safetensors', type: 'qwenimage', source: 'checkpoint' }
const BILD = { filename: '/data/videos/start-images/a.png', url: 'data:image/png;base64,AA', width: 1600, height: 900 }
const ref = (n: number) => ({ ...BILD, filename: `/r/${n}.png`, url: `data:image/png;base64,R${n}` })

function arrange(pick: ClassifiedModel, opts: { gb: number; refs?: number; side?: number; backend?: 'local' | 'cloud' }) {
  memory.gb = opts.gb
  useCreateStore.setState({
    backend: opts.backend ?? 'local', isGenerating: false, error: null, gallery: [], cloudOp: null, utilityOp: null, removebg: false,
    mode: 'image', imageSubMode: 'text2img', source: BILD, mask: null,
    references: Array.from({ length: opts.refs ?? 0 }, (_, i) => ref(i + 2)), batchSources: [],
    imageModelList: [pick], videoModelList: [], width: opts.side ?? 1024, height: opts.side ?? 1024,
  } as never)
  const s = useCreateStore.getState()
  s.setImageModel(pick.name, pick.type)
  s.setIntent('edit')
}

beforeEach(() => forgetMacMemoryForTests())
afterEach(() => cleanup())

describe('Edit on a Mac: the slots follow the memory', () => {
  it('48 GB at 1024: nine further images, as before', async () => {
    arrange(MAC_QWEN, { gb: 48 })
    render(<ReferenceStrip />)
    expect(await screen.findByText(/Add up to 9 more images, for example/)).toBeTruthy()
    expect(screen.queryByText(/memory of this Mac/)).toBeNull()
    expect(screen.getByTitle('Add another image the edit can use')).toBeTruthy()
  })

  it('24 GB at 1024: one slot, and the line says the memory sets it', async () => {
    arrange(MAC_QWEN, { gb: 24 })
    render(<ReferenceStrip />)
    expect(await screen.findByText('Add up to one more image, for example a person or an outfit to bring into this one. That is what the memory of this Mac takes at this size.')).toBeTruthy()
  })

  it('24 GB at 768: the smaller canvas takes all nine again', async () => {
    arrange(MAC_QWEN, { gb: 24, side: 768 })
    render(<ReferenceStrip />)
    expect(await screen.findByText(/Add up to 9 more images, for example/)).toBeTruthy()
  })

  it('16 GB at 1024: no slots, a quiet line with the reason', async () => {
    arrange(MAC_QWEN, { gb: 16 })
    render(<ReferenceStrip />)
    expect(await screen.findByText('With 16 GB of memory this Mac edits the picture on its own at this size, without further images.')).toBeTruthy()
    expect(screen.queryByTitle('Add another image the edit can use')).toBeNull()
    expect(screen.queryByTestId('reference-strip')).toBeNull()
  })

  it('images past the limit stay, marked not sent, and the prompt names only the sent ones', async () => {
    arrange(MAC_QWEN, { gb: 24, refs: 3 })
    render(<ReferenceStrip />)
    expect(await screen.findAllByText('not sent')).toHaveLength(2)
    expect(document.querySelectorAll('[data-not-sent="true"]')).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(3)
    expect(screen.getByText(/^Name them in the prompt as image 2\. With 24 GB of memory this Mac takes one more image at this size\. The ones marked not sent stay here and are left out of the edit\.$/)).toBeTruthy()
    expect(screen.queryByTitle('Add another image the edit can use')).toBeNull()
    expect(useCreateStore.getState().references).toHaveLength(3)
  })

  it('16 GB with images in the strip: they stay, all marked not sent', async () => {
    arrange(MAC_QWEN, { gb: 16, refs: 2 })
    render(<ReferenceStrip />)
    expect(await screen.findAllByText('not sent')).toHaveLength(2)
    expect(screen.getByText(/without further images\. The images here stay and are not sent\.$/)).toBeTruthy()
  })

  it('a memory that could not be read changes nothing', async () => {
    arrange(MAC_QWEN, { gb: 0 })
    render(<ReferenceStrip />)
    expect(await screen.findByText(/Add up to 9 more images, for example/)).toBeTruthy()
  })
})

describe('Windows, Linux and the cloud stay as they were', () => {
  it('a ComfyUI model on a small machine keeps nine slots', async () => {
    arrange(COMFY_QWEN, { gb: 16 })
    render(<ReferenceStrip />)
    expect(await screen.findByText(/Add up to 9 more images, for example/)).toBeTruthy()
    expect(screen.queryByText(/not sent/)).toBeNull()
  })

  it('the cloud keeps its own count', async () => {
    arrange(MAC_QWEN, { gb: 16, backend: 'cloud' })
    useCreateStore.setState({ cloudOpModel: 'qwen-image-2.1-edit' } as never)
    render(<ReferenceStrip />)
    expect(screen.queryByText(/memory/)).toBeNull()
  })
})
