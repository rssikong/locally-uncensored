// @vitest-environment jsdom
/**
 * What the Create surface offers for a local Qwen-Image 2.1 has to be there
 * for every image model file of the family: the official weights and the Noct
 * Q finetune, whose file name says neither "qwen" nor "2.1".
 *
 * The sibling tests of each row mock the classifier and hand the type in.
 * Here the classifier is the real one, so a file the classifier does not know
 * would lose its rows: Transparent background, the Text encoder row, the
 * prompt enhancer on Edit, and the nine further reference slots.
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
import { ImproveToggle } from '../ImproveToggle'
import { useCreateStore } from '../../../../stores/createStore'
import { classifyModel } from '../../../../api/comfyui'
import { extraReferenceSlots } from '../../../../lib/edit-references'
import { QWEN21_WEIGHTS } from '../../../../api/__tests__/qwen21-weights'

const OFFICIAL = 'qwen3vl_8b_int8_convrot.safetensors'
const FREE = 'qwen3vl_8b_int8_convrot_heretic.safetensors'
const I2I_FREE = 'qwen3.5_9b_qwen_image_2.1_pe_i2i_heretic.int8_convrot.safetensors'

function setup(model: string, textEncoders: string[]) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, qwenTextEncoder: 'auto', transparentBackground: false,
    improvePrompt: false, improveWith: 'auto', cloudStudioOptions: {},
    imageModel: model, imageModelList: [{ name: model, type: classifyModel(model) }],
    cloudOp: null, utilityOp: null, removebg: false, textEncoderList: textEncoders,
  } as never)
  useCreateStore.getState().setIntent('image')
}

afterEach(() => { cleanup() })

describe.each(QWEN21_WEIGHTS)('the Create surface for local Qwen-Image 2.1, %s', (_weights, model) => {
  it('Transparent background is offered', () => {
    setup(model, [OFFICIAL])
    render(<ParamGroups />)
    expect(screen.getByRole('switch', { name: /transparent background/i })).toBeTruthy()
  })

  it('with both text encoders installed, Expert has the Text encoder row', () => {
    setup(model, [OFFICIAL, FREE])
    render(<ParamGroups />)
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }))
    expect(screen.getByRole('button', { name: 'Text encoder' }).textContent).toBe('Qwen3-VL 8B')
  })

  it('Edit has Improve my prompt when the edit enhancer is installed', () => {
    setup(model, [OFFICIAL, I2I_FREE])
    useCreateStore.getState().setIntent('edit')
    render(<ImproveToggle />)
    expect(screen.getByRole('switch', { name: /improve my prompt/i })).toBeTruthy()
  })

  it('an edit takes nine further reference images', () => {
    expect(extraReferenceSlots(classifyModel(model), model)).toBe(9)
  })
})

describe('COUNTER-CHECK: a file of another family gets none of it', () => {
  it('an SDXL checkpoint has no Transparent background and no Text encoder row', () => {
    setup('sdxl_base_1.0.safetensors', [OFFICIAL, FREE])
    render(<ParamGroups />)
    expect(screen.queryByRole('switch', { name: /transparent background/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }))
    expect(screen.queryByRole('button', { name: 'Text encoder' })).toBeNull()
  })
})
