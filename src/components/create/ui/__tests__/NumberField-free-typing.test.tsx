// @vitest-environment jsdom
/**
 * A size can be typed by hand (Discord #bug-reports,
 * 22.10.2026): emptying Width and typing 1920 showed 64 at the first digit,
 * the next one made it 641. Every keystroke went to the store, whose setSize
 * clamps to 64..4096. Now the field holds what is typed and commits on leaving
 * it or on Enter, rounded to the grid; the arrows and the stepper still act at
 * once.
 *
 * Run: npx vitest run src/components/create/ui/__tests__/NumberField-free-typing.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../../experimental/CreateContext', () => ({
  useCreateExp: () => ({
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
  }),
}))

import { NumberField } from '../NumberField'
import { ParamGroups } from '../../experimental/ParamGroups'
import { useCreateStore } from '../../../../stores/createStore'

/** The field wired like Create: a store that clamps every value it gets. */
function Clamped({ grid, initial = 1024 }: { grid?: number; initial?: number }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <NumberField label="Width" value={value} min={64} max={4096} step={64} grid={grid}
        onChange={(v) => setValue(Math.max(64, Math.min(4096, Math.floor(v))))} />
      <output data-testid="stored">{value}</output>
    </>
  )
}
const field = () => screen.getByLabelText('Width') as HTMLInputElement
const stored = () => Number(screen.getByTestId('stored').textContent)
const type = (text: string) => fireEvent.change(field(), { target: { value: text } })

afterEach(() => { cleanup() })

describe('a width typed by hand', () => {
  it('emptied and typed digit by digit, the field shows what is typed, not 64 or 641', () => {
    render(<Clamped />)
    for (const text of ['', '1', '19', '192', '1920']) {
      type(text)
      expect(field().value).toBe(text)
    }
    expect(stored()).toBe(1920)
    fireEvent.blur(field())
    expect(field().value).toBe('1920')
    expect(stored()).toBe(1920)
  })

  it('a value outside the bounds is not sent while typing, and is clamped on leaving', () => {
    render(<Clamped />)
    type('5')
    expect(stored()).toBe(1024)
    type('50000')
    expect(stored()).toBe(1024)
    fireEvent.blur(field())
    expect(stored()).toBe(4096)
    expect(field().value).toBe('4096')
  })

  it('Enter commits and rounds onto the grid', () => {
    render(<Clamped />)
    type('1000')
    fireEvent.keyDown(field(), { key: 'Enter' })
    expect(stored()).toBe(1024)
    expect(field().value).toBe('1024')
  })

  it('a finer grid keeps 1360 (Qwen-Image 2.1, 16 pixels a cell)', () => {
    render(<Clamped grid={16} />)
    type('1360')
    fireEvent.blur(field())
    expect(stored()).toBe(1360)
    cleanup()
    render(<Clamped />)
    type('1360')
    fireEvent.blur(field())
    expect(stored()).toBe(1344)
  })

  it('an emptied field that is left goes back to the stored value', () => {
    render(<Clamped />)
    type('')
    fireEvent.blur(field())
    expect(field().value).toBe('1024')
    expect(stored()).toBe(1024)
  })

  it('the arrows and the stepper still take effect at once', () => {
    render(<Clamped />)
    // An arrow key or a stepper click arrives as a change to a value in range.
    type('1088')
    expect(stored()).toBe(1088)
  })
})

describe('the Create size fields', () => {
  for (const intent of ['image', 'edit'] as const) {
    it(`${intent}: Width and Height take a typed 1920 × 1360 on a Qwen-Image 2.1 model`, () => {
      const qwen = 'qwen_image_2.1_int8_convrot.safetensors'
      useCreateStore.setState({
        backend: 'local', isGenerating: false, transparentBackground: false, improvePrompt: false, cloudStudioOptions: {},
        imageModel: qwen, imageModelList: [{ name: qwen, type: 'qwenimage' }],
        cloudOp: null, utilityOp: null, removebg: false, mask: null, source: null,
      } as never)
      useCreateStore.getState().setIntent(intent)
      useCreateStore.setState({ width: 1024, height: 1024 } as never)
      render(<ParamGroups />)
      const width = screen.getByLabelText('Width') as HTMLInputElement
      const height = screen.getByLabelText('Height') as HTMLInputElement
      for (const text of ['', '1', '19', '192', '1920']) {
        fireEvent.change(width, { target: { value: text } })
        expect(width.value).toBe(text)
      }
      fireEvent.blur(width)
      fireEvent.change(height, { target: { value: '1360' } })
      fireEvent.keyDown(height, { key: 'Enter' })
      expect(useCreateStore.getState()).toMatchObject({ width: 1920, height: 1360 })
    })
  }
})
