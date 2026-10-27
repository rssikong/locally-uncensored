// @vitest-environment jsdom
/**
 * Discord 25.10.2026 ("charcter isnt working", Comfy Desktop, RTX 3060): the
 * panel said all three base files were missing while Z-Image Base was already
 * in the model picker, and "Download base files" did nothing: no row in the
 * Downloads tray, the note stuck at "Starting the downloads...". The
 * downloader had answered "exists" for each file (it found them in a ComfyUI
 * model folder the trainer did not search) and the panel never read the
 * answer. It reads it now, looks again, and says what happened.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/trainer-bases-silent-start.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => null }))
vi.mock('../../../../api/backend', () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
  isLinux: () => false,
  backendCall: vi.fn(async () => ({ status: 'ok' })),
}))

let statuses: Record<string, unknown>[] = []
const characterTrainerStatus = vi.fn(async () => (statuses.length > 1 ? statuses.shift() : statuses[0]))
vi.mock('../../../../api/trainer', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/trainer')>('../../../../api/trainer')
  return { ...actual, characterTrainerStatus: () => characterTrainerStatus() }
})
vi.mock('../../../../api/comfyui', () => ({ getLoraModels: vi.fn(async () => []), refreshComfyModels: vi.fn(async () => {}) }))
vi.mock('../../../../api/cloud/loras', () => ({ listLoras: vi.fn(async () => []), deleteLora: vi.fn() }))
type StartAnswer = { status: string; id?: string; error?: string }
let answers: Record<string, StartAnswer | Error> = {}
const startModelDownload = vi.fn(async (_url: string, _sub: string, filename: string) => {
  const a = answers[filename] ?? { status: 'started', id: filename }
  if (a instanceof Error) throw a
  return a
})
vi.mock('../../../../api/discover', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/discover')>('../../../../api/discover')
  return {
    ...actual,
    startModelDownload: (...a: unknown[]) => startModelDownload(...(a as [string, string, string])),
    getDownloadProgress: vi.fn(async () => ({})),
  }
})

import { SpecialControls } from '../SpecialIntentControls'
import { useCreateStore } from '../../../../stores/createStore'

const allMissing = {
  envReady: true,
  basesReady: false,
  dit: null,
  textEncoder: null,
  vae: null,
  missingBases: [
    { filename: 'z_image_bf16.safetensors', subfolder: 'diffusion_models', bytes: 12_309_866_400 },
    { filename: 'qwen_3_4b.safetensors', subfolder: 'text_encoders', bytes: 8_044_982_048 },
    { filename: 'ae.safetensors', subfolder: 'vae', bytes: 335_304_388 },
  ],
  root: 'C:\\Users\\m\\AppData\\Roaming\\Locally Uncensored\\musubi',
  customized: false,
  suggestedRoot: null,
  install: { status: 'idle', logs: [] },
}
const ready = {
  ...allMissing,
  basesReady: true,
  dit: 'D:\\shared\\diffusion_models\\z_image_bf16.safetensors',
  textEncoder: 'D:\\shared\\text_encoders\\qwen_3_4b.safetensors',
  vae: 'D:\\shared\\vae\\ae.safetensors',
  missingBases: [],
}

beforeEach(() => {
  cleanup()
  startModelDownload.mockClear()
  characterTrainerStatus.mockClear()
  answers = {}
  useCreateStore.setState({ backend: 'local', characterTab: 'train' })
})

const note = () => screen.getByRole('status').textContent ?? ''

describe('Download base files never does nothing', () => {
  it('every file "exists" but the trainer still misses them: says so and stops spinning', async () => {
    statuses = [allMissing]
    answers = Object.fromEntries(allMissing.missingBases.map((b) => [b.filename, { status: 'exists' }]))
    render(<SpecialControls intent="character" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download base files' }))
    await waitFor(() => expect(note()).toMatch(/already in a ComfyUI model folder, but the trainer does not find them/))
    expect(note()).toMatch(/Z Image base model, Text encoder, VAE are/)
    expect(note()).toMatch(/Settings, AI Backends, ComfyUI/)
    expect(note()).not.toMatch(/Starting the downloads/)
    expect(screen.getByRole('button', { name: 'Download base files' })).toBeTruthy()
  })

  it('every file "exists" and the trainer now finds them: goes on to training', async () => {
    statuses = [allMissing, ready]
    answers = Object.fromEntries(allMissing.missingBases.map((b) => [b.filename, { status: 'exists' }]))
    render(<SpecialControls intent="character" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download base files' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /Download base files|Downloading/ })).toBeNull())
    expect(screen.queryByText(/already in a ComfyUI model folder/)).toBeNull()
  })

  it('a refused start shows the reason the downloader gave', async () => {
    statuses = [{ ...allMissing, missingBases: [allMissing.missingBases[1]], dit: 'x', vae: 'y' }]
    answers = { 'qwen_3_4b.safetensors': { status: 'error', error: 'Another download is already writing a file called qwen_3_4b.safetensors.' } }
    render(<SpecialControls intent="character" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download base files' }))
    await waitFor(() => expect(note()).toMatch(/Did not start: Text encoder: Another download is already writing/))
  })

  it('a thrown start is named too', async () => {
    statuses = [{ ...allMissing, missingBases: [allMissing.missingBases[1]], dit: 'x', vae: 'y' }]
    answers = { 'qwen_3_4b.safetensors': new Error('Create models dir: access denied') }
    render(<SpecialControls intent="character" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download base files' }))
    await waitFor(() => expect(note()).toMatch(/Did not start: Text encoder: Create models dir: access denied/))
  })

  it('one file starts, one is refused: the refusal stays on screen', async () => {
    statuses = [allMissing]
    answers = { 'qwen_3_4b.safetensors': { status: 'error', error: 'refused' } }
    render(<SpecialControls intent="character" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Download base files' }))
    await waitFor(() => expect(note()).toMatch(/Did not start: Text encoder: refused/))
    expect(startModelDownload).toHaveBeenCalledTimes(3)
  })
})
