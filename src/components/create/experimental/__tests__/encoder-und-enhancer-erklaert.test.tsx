// @vitest-environment jsdom
/**
 * Discord report (3.0.7): "Why do I pick a text encoder when Improve my prompt
 * with the Qwen enhancer is on?" Both rows read like the same job. They are
 * not: the text encoder is part of the image model and reads the prompt for
 * it on every run, the enhancer rewrites the prompt before that. Each place
 * says so now: the help of the Text encoder row (Windows and Linux, ComfyUI)
 * and, with the enhancer writing, the Improve my prompt switch on every
 * platform, as a line under it and in its tooltip.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const host = vi.hoisted(() => ({ mac: false }))
vi.mock('../../../../api/mlx-image', () => ({
  isMlxImageHost: () => host.mac,
  isMlxImageModel: (name: string | null | undefined) => !!name && name.startsWith('MLX '),
}))
vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
  }),
}))

import { ParamGroups } from '../ParamGroups'
import { ImproveToggle } from '../ImproveToggle'
import { useCreateStore } from '../../../../stores/createStore'
import { useModelStore } from '../../../../stores/modelStore'
import { QWEN_ENCODER_HELP } from '../../../../lib/render/qwen-text-encoder'
import { QWEN_ENHANCER_HINT, QWEN_ENHANCER_LINE } from '../../../../lib/render/qwen-enhancer'

const MODEL = 'qwen_image_2.1_int8_convrot.safetensors'
const OFFICIAL = 'qwen3vl_8b_int8_convrot.safetensors'
const FREE = 'qwen3vl_8b_int8_convrot_heretic.safetensors'
const T2I_PE = 'qwen3.5_9b_qwen_image_2.1_pe_t2i.int8_convrot.safetensors'
const MAC_QWEN = { name: 'MLX Qwen-Image 2.1 4-bit', type: 'qwenimage', source: 'checkpoint', editImages: 10 }

function windows(textEncoders: string[]) {
  host.mac = false
  useCreateStore.setState({
    backend: 'local', isGenerating: false, qwenTextEncoder: 'auto', transparentBackground: false,
    improvePrompt: true, improveWith: 'auto', cloudStudioOptions: {},
    imageModel: MODEL, imageModelList: [{ name: MODEL, type: 'qwenimage' }], mlxEnhancerList: [],
    cloudOp: null, utilityOp: null, removebg: false, textEncoderList: textEncoders,
  } as never)
  useCreateStore.getState().setIntent('image')
}

function mac() {
  host.mac = true
  useCreateStore.setState({
    backend: 'local', isGenerating: false, improvePrompt: true, improveWith: 'auto', cloudStudioOptions: {},
    imageModel: MAC_QWEN.name, imageModelList: [MAC_QWEN], mlxEnhancerList: ['qwen-image-2.1-pe-t2i-4bit'],
    textEncoderList: [],
  } as never)
  useCreateStore.getState().setIntent('image')
}

const tooltipOf = async (el: Element) => {
  fireEvent.mouseEnter(el)
  let text = ''
  await waitFor(() => { text = screen.getByRole('tooltip').textContent ?? '' })
  return text
}

afterEach(() => { cleanup(); host.mac = false })

describe('what the text encoder is and what the enhancer is', () => {
  it('the two texts name each other and say who does what', () => {
    expect(QWEN_ENCODER_HELP).toMatch(/part of the image model/i)
    expect(QWEN_ENCODER_HELP).toMatch(/Improve my prompt/)
    expect(QWEN_ENHANCER_HINT).toMatch(/text encoder/i)
    expect(QWEN_ENHANCER_LINE).toMatch(/text encoder/i)
    for (const t of [QWEN_ENCODER_HELP, QWEN_ENHANCER_HINT, QWEN_ENHANCER_LINE]) expect(t).not.toMatch(/[\u2013\u2014]/)
  })

  it('Windows: the help of the Text encoder row says it is part of the model and not the rewrite', async () => {
    windows([OFFICIAL, FREE])
    render(<ParamGroups />)
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }))
    const label = screen.getByText('Text encoder', { selector: 'span' })
    const dot = label.nextElementSibling as Element
    expect(await tooltipOf(dot)).toBe(QWEN_ENCODER_HELP)
  })

  it('Windows: with the enhancer writing, the switch says under it that the text encoder still reads the prompt', async () => {
    windows([OFFICIAL, T2I_PE])
    useModelStore.setState({ activeModel: 'qwen3:8b' })
    render(<ImproveToggle />)
    expect(screen.getByText(QWEN_ENHANCER_LINE)).toBeTruthy()
    const sw = screen.getByRole('switch', { name: /improve my prompt/i })
    expect(await tooltipOf(sw.parentElement as Element)).toBe(QWEN_ENHANCER_HINT)
  })

  it('Mac: the same line under the switch with the MLX enhancer', async () => {
    mac()
    useModelStore.setState({ activeModel: 'qwen3:8b' })
    render(<ImproveToggle />)
    expect(screen.getByText(QWEN_ENHANCER_LINE)).toBeTruthy()
    const sw = screen.getByRole('switch', { name: /improve my prompt/i })
    expect(await tooltipOf(sw.parentElement as Element)).toBe(QWEN_ENHANCER_HINT)
  })

  it('COUNTER-CHECK: with the chat model writing there is no line about the text encoder', () => {
    windows([OFFICIAL])
    useModelStore.setState({ activeModel: 'qwen3:8b' })
    render(<ImproveToggle />)
    expect(screen.queryByText(/text encoder/i)).toBeNull()
  })

  it('COUNTER-CHECK: with the switch off the line is not there either', () => {
    windows([OFFICIAL, T2I_PE])
    useCreateStore.setState({ improvePrompt: false })
    render(<ImproveToggle />)
    expect(screen.queryByText(/text encoder/i)).toBeNull()
  })
})
