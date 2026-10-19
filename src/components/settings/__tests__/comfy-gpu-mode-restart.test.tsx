/**
 * @vitest-environment jsdom
 *
 * Settings, Hardware, ComfyUI GPU: every change of the mode says that ComfyUI
 * has to start again, and offers the restart.
 *
 * 3.0.7, from Discord: Force GPU with the vendor left on Auto changed the mode
 * without a word. The only hint in the section was tied to a vendor or card
 * pick (`vendor !== 'auto' || indices.length > 0`), so the running ComfyUI
 * kept the --cpu it was started with and the switch looked broken.
 *
 * Negative control: put the hint back behind that old condition and the
 * Auto vendor cases below turn red.
 *
 * Run: npx vitest run src/components/settings/__tests__/comfy-gpu-mode-restart.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const calls: Array<{ cmd: string; args?: unknown }> = []
vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => true,
  isMacOS: () => false,
  backendCall: vi.fn(async (cmd: string, args?: unknown) => {
    calls.push({ cmd, args })
    if (cmd === 'detect_gpus') return [{ index: 0, vendor: 'intel', name: 'Intel Arc A770', memory_mib: 16384, source: 'wmic' }]
    return null
  }),
}))
vi.mock('../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))

const restart = vi.fn(async (_outside?: string) => {})
vi.mock('../../../api/comfy-restart', () => ({ restartComfyForNewNodes: (m?: string) => restart(m) }))

const { HardwareSettings } = await import('../HardwareSettings')
const { useSettingsStore } = await import('../../../stores/settingsStore')
const { comfyDeviceLine } = await import('../../create/experimental/comfyError')

const MODES = [
  ['gpu', 'Force GPU'],
  ['cpu', 'Force CPU'],
  ['auto', 'Auto (recommended)'],
] as const

function radio(label: string): HTMLInputElement {
  const el = screen.getByText(label).closest('label')?.querySelector('input')
  if (!el) throw new Error(`no radio for ${label}`)
  return el as HTMLInputElement
}

beforeEach(() => {
  calls.length = 0
  restart.mockClear()
  restart.mockImplementation(async () => {})
  useSettingsStore.getState().updateSettings({ gpuVendor: 'auto', gpuIndices: [], comfyGpuMode: 'auto' })
})
afterEach(cleanup)

describe('THE FIX: a ComfyUI GPU change always asks for a restart', () => {
  it('nothing is said before anything changed', () => {
    render(<HardwareSettings />)
    expect(screen.queryByTestId('comfy-gpu-restart-hint')).toBeNull()
  })

  for (const vendor of ['auto', 'intel', 'amd'] as const) {
    for (const [mode, label] of MODES) {
      it(`vendor ${vendor}, mode ${mode}: the hint and the Restart ComfyUI button`, () => {
        useSettingsStore.getState().updateSettings({ gpuVendor: vendor, comfyGpuMode: mode === 'auto' ? 'gpu' : 'auto' })
        render(<HardwareSettings />)
        fireEvent.click(radio(label))
        expect(useSettingsStore.getState().settings.comfyGpuMode).toBe(mode)
        const hint = screen.getByTestId('comfy-gpu-restart-hint')
        expect(hint.textContent).toMatch(/ComfyUI only reads this when it starts/)
        expect(hint.textContent).toMatch(/Device line/)
        expect(screen.getByRole('button', { name: /Restart ComfyUI/ })).toBeTruthy()
        expect(calls).toContainEqual({ cmd: 'set_comfy_gpu_mode', args: { mode } })
      })
    }
  }

  it('the button runs the shared restart, after sending the mode once more', async () => {
    render(<HardwareSettings />)
    fireEvent.click(radio('Force GPU'))
    calls.length = 0
    fireEvent.click(screen.getByRole('button', { name: /Restart ComfyUI/ }))
    await waitFor(() => expect(screen.getByText(/ComfyUI is starting again with the new mode/)).toBeTruthy())
    expect(restart).toHaveBeenCalledTimes(1)
    expect(calls[0]).toEqual({ cmd: 'set_comfy_gpu_mode', args: { mode: 'gpu' } })
    // A ComfyUI outside LU is told the GPU sentence, not the node pack one.
    expect(restart.mock.calls[0][0]).toMatch(/ComfyUI GPU setting only applies to a ComfyUI that LU starts/)
  })

  it('a restart that fails says why', async () => {
    restart.mockImplementation(async () => { throw new Error('Your ComfyUI is running outside LU, so LU cannot restart it.') })
    render(<HardwareSettings />)
    fireEvent.click(radio('Force CPU'))
    fireEvent.click(screen.getByRole('button', { name: /Restart ComfyUI/ }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/running outside LU/))
  })
})

describe('the Device line ComfyUI prints at start', () => {
  it('is found among the start output, with a log prefix or without', () => {
    expect(comfyDeviceLine(['Total VRAM 16384 MB', 'Device: xpu:0 Intel(R) Arc(TM) A770 Graphics', 'Starting server'])).toBe('Device: xpu:0 Intel(R) Arc(TM) A770 Graphics')
    expect(comfyDeviceLine(['[2026-10-19 10:00:00] Device: cuda:0 AMD Radeon RX 7900 XTX : native'])).toBe('Device: cuda:0 AMD Radeon RX 7900 XTX : native')
    expect(comfyDeviceLine(['Device: cpu'])).toBe('Device: cpu')
  })

  it('the last one wins, and no line means no text', () => {
    expect(comfyDeviceLine(['Device: cpu', 'Device: xpu:0 Arc'])).toBe('Device: xpu:0 Arc')
    expect(comfyDeviceLine([])).toBe('')
    expect(comfyDeviceLine(null)).toBe('')
    expect(comfyDeviceLine(['Device: '])).toBe('')
  })
})
