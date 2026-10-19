/**
 * @vitest-environment jsdom
 *
 * GH #183: LU ignored the shared folders configured for ComfyUI. Which folder
 * wins per key is proven in Rust (`comfy_user_paths.rs`, with real
 * `extra_model_paths.yaml` examples); this file proves the Settings readout
 * shows the backend's answer, one short line per kind, and stays silent
 * where there is nothing to show.
 *
 * Run: npx vitest run src/lib/__tests__/comfy-folder-targets.test.tsx
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const backendCall = vi.fn()
vi.mock('../../api/backend', () => ({
  backendCall: (...args: unknown[]) => backendCall(...args),
  isTauri: () => true,
  isMacOS: () => false,
}))

import { loadComfyFolderTargets, sourceLabel } from '../comfy-folder-targets'
import { ComfyFolderTargets } from '../../components/settings/ComfyFolderTargets'

const ISSUE_183 = {
  shown: true,
  models: [
    { key: 'checkpoints', dir: 'd:\\comfyui\\model\\checkpoints', source: 'D:\\ComfyUI\\Comfy\\ComfyUI\\extra_model_paths.yaml' },
    { key: 'loras', dir: 'd:\\comfyui\\model\\loras', source: 'D:\\ComfyUI\\Comfy\\ComfyUI\\extra_model_paths.yaml' },
    { key: 'vae', dir: 'D:\\ComfyUI\\Comfy\\ComfyUI\\models\\vae', source: 'ComfyUI folder' },
  ],
  input: 'D:\\ComfyUI\\io\\input',
  output: 'D:\\ComfyUI\\io\\output',
  sources: ['D:\\ComfyUI\\Comfy\\ComfyUI\\extra_model_paths.yaml'],
  problems: [],
}

beforeEach(() => { backendCall.mockReset() })

describe('comfy folder targets', () => {
  it('asks the backend once and keeps its answer', async () => {
    backendCall.mockResolvedValue(ISSUE_183)
    const t = await loadComfyFolderTargets()
    expect(backendCall).toHaveBeenCalledWith('comfy_folder_targets')
    expect(t.shown).toBe(true)
    expect(t.models.find((r) => r.key === 'loras')?.dir).toBe('d:\\comfyui\\model\\loras')
  })

  it('never throws and shows nothing on an older backend or a remote ComfyUI', async () => {
    backendCall.mockRejectedValue(new Error('unknown command'))
    expect((await loadComfyFolderTargets()).shown).toBe(false)
    backendCall.mockResolvedValue({ shown: false })
    expect((await loadComfyFolderTargets()).shown).toBe(false)
    backendCall.mockResolvedValue(null)
    expect((await loadComfyFolderTargets()).shown).toBe(false)
  })

  it('names the config file by its name only', () => {
    expect(sourceLabel('D:\\ComfyUI\\Comfy\\ComfyUI\\extra_model_paths.yaml')).toBe('extra_model_paths.yaml')
    expect(sourceLabel('/home/u/comfy/extra_model_paths.yaml')).toBe('extra_model_paths.yaml')
    expect(sourceLabel('ComfyUI folder')).toBe('ComfyUI folder')
    expect(sourceLabel('running ComfyUI')).toBe('running ComfyUI')
  })

  it('shows one line per kind with the folder and where it came from', async () => {
    backendCall.mockResolvedValue({ ...ISSUE_183, problems: ['C:\\x\\extra.yaml: not readable YAML'] })
    render(<ComfyFolderTargets path="D:\\ComfyUI\\Comfy\\ComfyUI" running={false} />)
    await waitFor(() => expect(screen.getByTestId('comfy-folder-targets')).toBeTruthy())
    const box = screen.getByTestId('comfy-folder-targets')
    expect(box.textContent).toContain('loras: d:\\comfyui\\model\\loras (extra_model_paths.yaml)')
    expect(box.textContent).toContain('vae: D:\\ComfyUI\\Comfy\\ComfyUI\\models\\vae (ComfyUI folder)')
    expect(box.textContent).toContain('output: D:\\ComfyUI\\io\\output')
    expect(box.textContent).toContain('Not used: C:\\x\\extra.yaml: not readable YAML')
    expect(box.querySelectorAll('p.t-micro').length).toBe(3 + 2 + 1)
  })

  it('renders nothing when the backend has nothing to show', async () => {
    backendCall.mockResolvedValue({ shown: false })
    const { container } = render(<ComfyFolderTargets path="/x" running={false} />)
    await waitFor(() => expect(backendCall).toHaveBeenCalled())
    expect(container.innerHTML).toBe('')
  })
})
