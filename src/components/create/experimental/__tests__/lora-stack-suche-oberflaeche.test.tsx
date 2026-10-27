// @vitest-environment jsdom
/**
 * The LoRA stack in Advanced settings, Expert (Discord 2026-10-23):
 *  - a search above the list, because with many LoRAs the list had to be
 *    scrolled through to find one,
 *  - closing the drawer, on purpose or by a click beside it, put the list back
 *    at the top; the search and the scroll position now stay for the session,
 *  - each row can copy its file name, where the trigger words are kept.
 *
 * The drawer unmounts ParamGroups when it closes, so a close is an unmount
 * here and an open a new render.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/lora-stack-suche-oberflaeche.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const lists = vi.hoisted(() => ({ loras: [] as string[] }))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    samplerList: [], schedulerList: [], loraList: lists.loras, vaeList: [], refreshModelLists: vi.fn(),
  }),
}))

import { ParamGroups } from '../ParamGroups'
import { resetLoraStackView } from '../loraStackView'
import { useCreateStore } from '../../../../stores/createStore'
import { classifyModel } from '../../../../api/comfyui'

const MODEL = 'juggernautXL_v9.safetensors'
const LORAS = [
  'Anime_Lineart_XL.safetensors',
  'styles/film_grain_xl.safetensors',
  'ohwx woman, red dress.safetensors',
  'detail_slider_xl.safetensors',
  'age_slider_xl.safetensors',
]

function open() {
  render(<ParamGroups />)
  if (!screen.queryByRole('searchbox', { name: 'Search LoRAs' })) {
    fireEvent.click(screen.getByRole('button', { name: 'Expert' }))
  }
}
const search = () => screen.getByRole('searchbox', { name: 'Search LoRAs' }) as HTMLInputElement
const list = () => screen.getByTestId('lora-stack-list')
const rowNames = () => screen.getAllByRole('button').filter((b) => /\.safetensors$/.test(b.getAttribute('title') ?? '')).map((b) => b.getAttribute('title'))
const writeText = vi.fn(async () => {})
/** The copy button beside the row whose tooltip is this file name. */
const copyFor = (file: string) => screen.getByTitle(file).parentElement!.querySelectorAll('button')[1] as HTMLButtonElement

beforeEach(() => {
  lists.loras = LORAS
  resetLoraStackView()
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  writeText.mockClear()
  useCreateStore.setState({
    backend: 'local', isGenerating: false, cloudOp: null, utilityOp: null, removebg: false,
    expertOpen: false, selectedLoras: [], loraStrengths: {},
    imageModel: MODEL, imageModelList: [{ name: MODEL, type: classifyModel(MODEL) }],
  } as never)
  useCreateStore.getState().setIntent('image')
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('the search above the LoRA stack', () => {
  it('narrows the rows as it is typed, case does not count', () => {
    open()
    expect(rowNames()).toHaveLength(5)
    fireEvent.change(search(), { target: { value: 'SLIDER' } })
    expect(rowNames()).toEqual(['detail_slider_xl.safetensors', 'age_slider_xl.safetensors'])
    fireEvent.change(search(), { target: { value: 'grain' } })
    expect(rowNames()).toEqual(['film_grain_xl.safetensors'])
  })

  it('an empty search shows every row again', () => {
    open()
    fireEvent.change(search(), { target: { value: 'anime' } })
    expect(rowNames()).toHaveLength(1)
    fireEvent.change(search(), { target: { value: '' } })
    expect(rowNames()).toHaveLength(5)
    fireEvent.change(search(), { target: { value: '   ' } })
    expect(rowNames()).toHaveLength(5)
  })

  it('no match says so, the stack itself stays', () => {
    open()
    fireEvent.change(search(), { target: { value: 'nothing here' } })
    expect(rowNames()).toEqual([])
    expect(screen.getByText('No LoRA matches "nothing here".')).toBeTruthy()
    expect(search().value).toBe('nothing here')
  })

  it('a LoRA that is on and filtered out still counts and still runs', () => {
    open()
    fireEvent.click(screen.getByTitle('Anime_Lineart_XL.safetensors'))
    fireEvent.change(search(), { target: { value: 'slider' } })
    expect(screen.getByText('· 1 active')).toBeTruthy()
    expect(useCreateStore.getState().selectedLoras.map((l) => l.name)).toEqual(['Anime_Lineart_XL.safetensors'])
  })
})

describe('closing the drawer keeps where the stack was left', () => {
  it('the search is still there after a close and an open', () => {
    open()
    fireEvent.change(search(), { target: { value: 'slider' } })
    cleanup()
    open()
    expect(search().value).toBe('slider')
    expect(rowNames()).toEqual(['detail_slider_xl.safetensors', 'age_slider_xl.safetensors'])
  })

  it('the list opens at the scroll position it was left at', () => {
    open()
    list().scrollTop = 120
    fireEvent.scroll(list())
    cleanup()
    open()
    expect(list().scrollTop).toBe(120)
  })

  it('a new search starts the list at the top', () => {
    open()
    list().scrollTop = 120
    fireEvent.scroll(list())
    fireEvent.change(search(), { target: { value: 'xl' } })
    expect(list().scrollTop).toBe(0)
    cleanup()
    open()
    expect(list().scrollTop).toBe(0)
  })
})

describe('copying the name of a LoRA', () => {
  it('puts the file name without folder and ending on the clipboard, trigger words included', () => {
    open()
    expect(screen.getAllByRole('button', { name: 'Copy file name' })).toHaveLength(5)
    fireEvent.click(copyFor('ohwx woman, red dress.safetensors'))
    expect(writeText).toHaveBeenCalledWith('ohwx woman, red dress')
    fireEvent.click(copyFor('film_grain_xl.safetensors'))
    expect(writeText).toHaveBeenLastCalledWith('film_grain_xl')
  })

  it('does not turn the LoRA on, and says it copied for a moment', () => {
    vi.useFakeTimers()
    open()
    const copy = copyFor('age_slider_xl.safetensors')
    expect(copy.getAttribute('title')).toBe('Copy "age_slider_xl"')
    fireEvent.click(copy)
    expect(useCreateStore.getState().selectedLoras).toEqual([])
    expect(copy.getAttribute('aria-label')).toBe('Copied')
    act(() => { vi.advanceTimersByTime(2000) })
    expect(copy.getAttribute('aria-label')).toBe('Copy file name')
  })
})
