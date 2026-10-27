// @vitest-environment jsdom
/**
 * Native HiRes is offered in Edit (Discord feature request 21.10.2026,
 * "Native HiRes Upscale in the EDIT"), local only, and names the size the
 * edited picture comes out at: the source's, not the sliders'.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
  }),
}))

import { ParamGroups } from '../ParamGroups'
import { useCreateStore } from '../../../../stores/createStore'

const SDXL = 'sdxl_base_1.0.safetensors'
const source = { filename: 'photo.png', url: 'blob:x', width: 1600, height: 900 }

function setup(intent: 'image' | 'edit', backend: 'local' | 'cloud' = 'local') {
  useCreateStore.setState({
    backend, isGenerating: false, transparentBackground: false, improvePrompt: false, cloudStudioOptions: {},
    imageModel: SDXL, imageModelList: [{ name: SDXL, type: 'sdxl' }],
    cloudOp: null, utilityOp: null, removebg: false, mask: null, source: null,
  } as never)
  useCreateStore.getState().setIntent(intent)
  useCreateStore.setState({ width: 1024, height: 1024 } as never)
}
const hiresButton = () => screen.queryByRole('button', { name: /native hires/i })

afterEach(() => { cleanup() })

describe('Native HiRes in Edit', () => {
  it('is offered in a local Edit and reads from the source to the larger size', () => {
    setup('edit')
    useCreateStore.setState({ source } as never)
    render(<ParamGroups />)
    fireEvent.click(hiresButton()!)
    expect(useCreateStore.getState().hiresFixEnabled).toBe(true)
    expect(screen.getByText('1600×900')).toBeTruthy()
    expect(screen.getByText('2400×1344')).toBeTruthy()
    expect(screen.getByText(/second pass over the edited picture/i)).toBeTruthy()
  })

  it('without a picture yet it says what is missing instead of a size', () => {
    setup('edit')
    useCreateStore.setState({ hiresFixEnabled: true } as never)
    render(<ParamGroups />)
    expect(screen.getByText(/add the picture to edit/i)).toBeTruthy()
  })

  it('with a painted mask it says that HiRes runs on the whole picture', () => {
    setup('edit')
    useCreateStore.setState({ source, mask: { ...source, filename: 'mask.png' }, hiresFixEnabled: true } as never)
    render(<ParamGroups />)
    expect(screen.getByText(/clear the mask/i)).toBeTruthy()
  })

  it('COUNTER-CHECK: Create still names the sliders, the cloud has no HiRes', () => {
    setup('image')
    useCreateStore.setState({ hiresFixEnabled: true } as never)
    render(<ParamGroups />)
    expect(screen.getByText('1024×1024')).toBeTruthy()
    expect(screen.getByText('1536×1536')).toBeTruthy()
    cleanup()
    setup('edit', 'cloud')
    render(<ParamGroups />)
    expect(hiresButton()).toBeNull()
  })

  it('Qwen-Image 2.1 in Create names the size on its 16-pixel grid (A26)', () => {
    setup('image')
    const qwen = 'qwen_image_2.1_int8_convrot.safetensors'
    useCreateStore.setState({
      imageModel: qwen, imageModelList: [{ name: qwen, type: 'qwenimage' }],
      width: 768, height: 1360, hiresFixEnabled: true, hiresScale: 2,
    } as never)
    render(<ParamGroups />)
    expect(screen.getByText('768×1360')).toBeTruthy()
    expect(screen.getByText('1536×2720')).toBeTruthy()
    cleanup()
    // 1360 at 1.5x: 85 cells to 127.5, ComfyUI rounds to 128, so 2048.
    useCreateStore.setState({ hiresScale: 1.5 } as never)
    render(<ParamGroups />)
    expect(screen.getByText('1152×2048')).toBeTruthy()
  })
})
