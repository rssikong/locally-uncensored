// @vitest-environment jsdom
/**
 * Discord report (3.0.7), Motion Control: with only an image or only a video
 * the prompt field could not be typed into, and with both it disappeared.
 *
 * What looked like a field was the caption "Add a character image and a
 * driving dance/pose video above", grey, in the place and padding of the
 * prompt inside the prompt window, which read as a placeholder. It hid once
 * both inputs were in, so the window lost its only line. The local lanes do
 * read a prompt: the ComfyUI graph encodes it (dynamic-workflow
 * buildMotionWorkflow) and the Mac sends it, each with a line of its own
 * when it is empty. The cloud model takes none.
 *
 * Now the caption stands above the prompt window as a note. On the local
 * lanes the window holds a field that takes typing before and after the
 * inputs are in, and Create does not wait for it; on the cloud there is no
 * field, and the note says no prompt is needed.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/motion-shows-no-prompt-field.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, screen, act, fireEvent } from '@testing-library/react'

const host = vi.hoisted(() => ({ mac: false }))

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: null,
    samplerList: [], schedulerList: [], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
    connected: true, modelsLoaded: true, modelLoadError: null, mlxMissing: null,
    installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))
vi.mock('../../../../api/mlx-image', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  isMlxImageHost: () => host.mac,
}))
vi.mock('../../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  openExternal: vi.fn(),
}))

import { Composer } from '../Composer'
import { useCreateStore } from '../../../../stores/createStore'
import { intentTakesOptionalPrompt } from '../intents'

const picture = { filename: 'dancer.png', url: 'blob:dancer', width: 768, height: 1024 }
const clip = { blob: new Blob(['x'], { type: 'video/mp4' }), name: 'dance.mp4', url: 'blob:dance' }

const LANES = [
  { name: 'Windows or Linux with ComfyUI', backend: 'local', mac: false },
  { name: 'a Mac', backend: 'local', mac: true },
  { name: 'the cloud', backend: 'cloud', mac: false },
] as const

beforeEach(() => {
  useCreateStore.setState({ isGenerating: false, batchRun: null, error: null, gallery: [], source: null, videoInput: null, prompt: '' } as never)
})
afterEach(() => { cleanup(); host.mac = false })

/** The prompt window: the box that holds the field and the action bar with Create. */
function promptWindow(): HTMLElement {
  const create = screen.getByRole('button', { name: /Create/ })
  const bar = create.closest('div.border-t')
  expect(bar, 'the action bar').toBeTruthy()
  return bar!.parentElement as HTMLElement
}

describe.each(LANES)('Motion Control on $name', (lane) => {
  function open(inputs: { source?: boolean; video?: boolean }) {
    host.mac = lane.mac
    useCreateStore.setState({ backend: lane.backend } as never)
    useCreateStore.getState().setIntent('motion')
    useCreateStore.setState({ source: inputs.source ? picture : null, videoInput: inputs.video ? clip : null } as never)
    render(<Composer onOpenAdvanced={() => {}} onOpenWorkflows={() => {}} />)
  }

  const local = lane.backend === 'local'

  it.each([
    ['only the image', { source: true }],
    ['only the video', { video: true }],
    ['neither', {}],
  ] as const)('with %s the prompt window holds a field only where the lane reads one', (_label, inputs) => {
    open(inputs)
    const box = promptWindow()
    const field = document.querySelector('textarea')
    if (local) {
      expect(field, 'a prompt field').not.toBeNull()
      expect(box.contains(field)).toBe(true)
      expect((field as HTMLTextAreaElement).disabled).toBe(false)
      fireEvent.change(field!, { target: { value: 'on a beach at dusk' } })
      expect(useCreateStore.getState().prompt).toBe('on a beach at dusk')
      expect(field!.getAttribute('placeholder')).toMatch(/^Optional/)
      // No negative here: the lanes read only the prompt.
      expect(screen.queryByRole('button', { name: 'Negative' })).toBeNull()
    } else {
      expect(field).toBeNull()
      // Only the action bar is in it: no line in the place of the prompt.
      expect(box.children).toHaveLength(1)
    }
    expect(box.textContent).not.toMatch(/character image|driving/)
    // The note above says what the tab waits for, and what the prompt is.
    const note = screen.getByText(/character image and a driving dance\/pose video/)
    expect(note.textContent).toMatch(local ? /The prompt is optional/ : /^No prompt needed/)
    expect(box.contains(note)).toBe(false)
  })

  it('with the image and the video the prompt window stays as it was', () => {
    open({ source: true })
    const before = promptWindow().children.length
    act(() => { useCreateStore.setState({ videoInput: clip } as never) })
    expect(!!document.querySelector('textarea')).toBe(local)
    expect(promptWindow().children).toHaveLength(before)
    // The note named inputs that are in now; it goes, the window stays.
    expect(screen.queryByText(/driving dance\/pose video/)).toBeNull()
  })

  it('the start counts the prompt as optional only on the local lanes', () => {
    expect(intentTakesOptionalPrompt('motion', lane.backend)).toBe(local)
  })
})
