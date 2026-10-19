// @vitest-environment jsdom
/**
 * Box run, 3.0.7: only z_image_bf16 (11.46 GB) was missing, qwen_3_4b and ae
 * were on disk, yet Character Studio said "about 19 GB" above the button and
 * "of about 19 GB" while loading. The line now names the missing files with
 * their size, and only those are downloaded.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/trainer-bases-only-missing.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// 3.0.8 D20: the Train tab reads the card's memory for the Low VRAM hint;
// this file is about the trainer setup, so no card is reported.
vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => null }))
vi.mock('../../../../api/backend', () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => false,
  isLinux: () => true,
  backendCall: vi.fn(async () => ({ status: 'ok' })),
}))

let mockedStatus: Record<string, unknown> = {}
vi.mock('../../../../api/trainer', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/trainer')>('../../../../api/trainer')
  return { ...actual, characterTrainerStatus: vi.fn(async () => mockedStatus) }
})
vi.mock('../../../../api/comfyui', () => ({ getLoraModels: vi.fn(async () => []), refreshComfyModels: vi.fn(async () => {}) }))
vi.mock('../../../../api/cloud/loras', () => ({ listLoras: vi.fn(async () => []), deleteLora: vi.fn() }))
const startModelDownload = vi.fn(async () => {})
vi.mock('../../../../api/discover', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/discover')>('../../../../api/discover')
  return {
    ...actual,
    startModelDownload: (...a: unknown[]) => startModelDownload(...(a as [])),
    getDownloadProgress: vi.fn(async () => ({})),
  }
})

import { SpecialControls } from '../SpecialIntentControls'
import { useCreateStore } from '../../../../stores/createStore'

function status(overrides: Record<string, unknown>) {
  return {
    envReady: true,
    basesReady: false,
    dit: null,
    textEncoder: '/c/models/text_encoders/qwen_3_4b.safetensors',
    vae: '/c/models/vae/ae.safetensors',
    root: '/data/lu/musubi',
    customized: false,
    suggestedRoot: null,
    install: { status: 'idle', logs: [] },
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  startModelDownload.mockClear()
  useCreateStore.setState({ backend: 'local', characterTab: 'train' })
})

describe('Character Studio base files: only what is missing', () => {
  it('names the one missing file and its size, and downloads only that', async () => {
    mockedStatus = status({ missingBases: [{ filename: 'z_image_bf16.safetensors', subfolder: 'diffusion_models', bytes: 12_309_866_400 }] })
    render(<SpecialControls intent="character" />)
    const button = await screen.findByRole('button', { name: 'Download base files' })
    expect(screen.getByText('Missing for Z Image training: Z Image base model (about 11 GB, one time).')).toBeTruthy()
    expect(screen.queryByText(/about 19 GB/)).toBeNull()
    fireEvent.click(button)
    await waitFor(() => expect(startModelDownload).toHaveBeenCalledTimes(1))
    expect((startModelDownload.mock.calls[0] as unknown[])[2]).toBe('z_image_bf16.safetensors')
  })

  it('works the same against an older backend without missingBases', async () => {
    mockedStatus = status({})
    render(<SpecialControls intent="character" />)
    await screen.findByRole('button', { name: 'Download base files' })
    expect(screen.getByText(/Z Image base model \(about 11 GB, one time\)/)).toBeTruthy()
  })

  it('still says about 19 GB when all three are missing', async () => {
    mockedStatus = status({ textEncoder: null, vae: null })
    render(<SpecialControls intent="character" />)
    await screen.findByRole('button', { name: 'Download base files' })
    expect(screen.getByText('Z Image training base files are missing (about 19 GB, one time).')).toBeTruthy()
  })
})
