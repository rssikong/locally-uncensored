/**
 * @vitest-environment jsdom
 *
 * 3.0.8, A2 (.molot, two GPUs): Settings, Hardware offers a card per task, the
 * chat on one, pictures and video on the other. Two simulated cards, the
 * Windows order case included: nvidia-smi lists the 4090 as #0 and the 3060 as
 * #1, and the pick goes down to Rust as vendor, index AND name (the LU Engine
 * finds its Vulkan device by the name, gpu_roles.rs).
 *
 * Negative controls: one card shows no such section at all (one card behaves
 * exactly as before 3.0.8), and a Mac never gets here (its Hardware tab is a
 * readout, mac-hardware-is-a-readout.test.tsx).
 *
 * Run: npx vitest run src/components/settings/__tests__/zwei-karten-eine-pro-aufgabe.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const calls: Array<{ cmd: string; args?: unknown }> = []
let cards: unknown[] = []
vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => true,
  isMacOS: () => false,
  backendCall: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args })
    if (cmd === 'detect_gpus') return cards
    if (cmd === 'describe_gpu_roles') {
      return [
        { service: 'ComfyUI', env: ['CUDA_DEVICE_ORDER=PCI_BUS_ID', 'CUDA_VISIBLE_DEVICES=GPU-111'], args: [], note: null },
        { service: 'LU Engine', env: [], args: ['--device', 'Vulkan1'], note: null },
      ]
    }
    return null
  }),
}))
vi.mock('../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../../../api/comfy-restart', () => ({ restartComfyForNewNodes: async () => {} }))

const { HardwareSettings } = await import('../HardwareSettings')
const { useSettingsStore } = await import('../../../stores/settingsStore')
const { DEFAULT_SETTINGS } = await import('../../../lib/constants')

const TWO = [
  { index: 0, vendor: 'nvidia', name: 'NVIDIA GeForce RTX 4090', memory_mib: 24564, source: 'nvidia-smi' },
  { index: 1, vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3060', memory_mib: 12288, source: 'nvidia-smi' },
]

const lastRoles = () => [...calls].reverse().find((c) => c.cmd === 'set_gpu_roles')?.args as { roles: unknown } | undefined

beforeEach(() => {
  calls.length = 0
  useSettingsStore.setState((s) => ({ settings: { ...s.settings, ...DEFAULT_SETTINGS } }))
})
afterEach(() => cleanup())

describe('a card per task', () => {
  it('two cards: chat on the 4090, video on the 3060, and Rust gets both with their names', async () => {
    cards = TWO
    render(<HardwareSettings />)
    const chat = await screen.findByLabelText('Chat (LU Engine, Ollama)')
    const video = screen.getByLabelText('Pictures and video (ComfyUI)')
    fireEvent.change(chat, { target: { value: 'nvidia:0' } })
    fireEvent.change(video, { target: { value: 'nvidia:1' } })
    expect(useSettingsStore.getState().settings.gpuRoles).toEqual({
      chat: { vendor: 'nvidia', index: 0, name: 'NVIDIA GeForce RTX 4090' },
      comfy: { vendor: 'nvidia', index: 1, name: 'NVIDIA GeForce RTX 3060' },
    })
    await waitFor(() => expect(lastRoles()?.roles).toEqual({
      chat: { vendor: 'nvidia', index: 0, name: 'NVIDIA GeForce RTX 4090' },
      comfy: { vendor: 'nvidia', index: 1, name: 'NVIDIA GeForce RTX 3060' },
    }))
    expect(screen.getByText(/no longer takes the chat model off its card/)).toBeTruthy()
    expect(screen.getByTestId('gpu-roles-restart-hint')).toBeTruthy()
    // The readout of what each service gets.
    await waitFor(() => expect(screen.getByTestId('gpu-roles-plan').textContent).toContain('--device Vulkan1'))
  })

  it('both on one card says the chat still makes room', async () => {
    cards = TWO
    render(<HardwareSettings />)
    fireEvent.change(await screen.findByLabelText('Chat (LU Engine, Ollama)'), { target: { value: 'nvidia:1' } })
    fireEvent.change(screen.getByLabelText('Pictures and video (ComfyUI)'), { target: { value: 'nvidia:1' } })
    expect(screen.getByText(/still has to make room/)).toBeTruthy()
  })

  it('back to "Same as above" clears the role', async () => {
    cards = TWO
    useSettingsStore.getState().updateSettings({ gpuRoles: { chat: { vendor: 'nvidia', index: 0, name: 'x' }, comfy: null } })
    render(<HardwareSettings />)
    fireEvent.change(await screen.findByLabelText('Chat (LU Engine, Ollama)'), { target: { value: '' } })
    expect(useSettingsStore.getState().settings.gpuRoles).toEqual({ chat: null, comfy: null })
  })

  it('NEGATIVE: one card, no such section, nothing changes', async () => {
    cards = [TWO[0]]
    render(<HardwareSettings />)
    await waitFor(() => expect(calls.some((c) => c.cmd === 'detect_gpus')).toBe(true))
    await screen.findByText(/NVIDIA GeForce RTX 4090/)
    expect(screen.queryByTestId('gpu-roles')).toBeNull()
    expect(screen.queryByLabelText('Chat (LU Engine, Ollama)')).toBeNull()
  })

  it('a card of a vendor LU cannot pin (Apple, unknown) does not count as a second card', async () => {
    cards = [TWO[0], { index: 0, vendor: 'unknown', name: 'Microsoft Basic Display Adapter', memory_mib: null, source: 'wmic' }]
    render(<HardwareSettings />)
    await screen.findAllByText(/RTX 4090/)
    expect(screen.queryByTestId('gpu-roles')).toBeNull()
  })
})
