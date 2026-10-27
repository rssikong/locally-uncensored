/**
 * GH #143: Ollama and ComfyUI as services on a LAN box, LU on a
 * Windows PC. Every model download for ComfyUI failed, with "Create models dir:
 * permission denied (os error 5)" or "ComfyUI path not set", and the node pack
 * install with "ComfyUI not found".
 *
 * The files land on this machine now, in the Storage folder and in
 * ComfyUI's layout (download.rs remote_comfy, tested there), and the Model
 * Manager says where they went and what is left to do on the other machine,
 * instead of trying to install a node pack into a ComfyUI that is not here.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
import type { ModelBundle } from '../discover'

const backendCall = vi.fn<(cmd: string, args?: unknown) => Promise<unknown>>()

vi.mock('../backend', () => ({
  backendCall: (...a: unknown[]) => backendCall(...(a as [string, unknown])),
  localFetch: vi.fn(async () => new Response('{}', { status: 200 })),
  comfyuiUrl: (p: string) => `http://192.168.1.20:8188${p}`,
  fetchExternal: vi.fn(),
  fetchLocalhostBytes: vi.fn(),
  isTauri: () => true,
}))

import { comfyModelTarget, installBundleComplete, remoteBundleNotice } from '../discover'

const REMOTE = { remote: true, host: '192.168.1.20', root: 'D:\\LU models' }

const bundle = (): ModelBundle => ({
  name: 'Wan 2.1 Unfiltered',
  description: '',
  tags: [],
  totalSizeGB: 1,
  vramRequired: '12 GB',
  customNodes: ['gguf'],
  files: [{
    name: '', description: '', pulls: '', tags: [], updated: '',
    downloadUrl: 'https://example.test/wan.gguf',
    filename: 'wan.gguf',
    subfolder: 'unet',
    sizeGB: 1,
  }],
} as unknown as ModelBundle)

beforeAll(() => {
  ;(globalThis as unknown as { window: EventTarget }).window = new EventTarget()
})

beforeEach(() => {
  backendCall.mockReset().mockImplementation(async (cmd: string) => {
    if (cmd === 'comfy_model_target') return REMOTE
    if (cmd === 'check_model_sizes') return []
    if (cmd === 'check_download_space') return { fits: true }
    if (cmd === 'download_model') return { status: 'started', id: '1' }
    return { status: 'installed' }
  })
})

describe('a bundle for a ComfyUI on another machine', () => {
  it('downloads, installs no node pack here, and reports what is left over there', async () => {
    const report = await installBundleComplete(bundle())
    const calls = backendCall.mock.calls.map((c) => c[0])
    expect(calls).toContain('download_model')
    expect(calls).not.toContain('install_custom_node')
    expect(report.remote).toEqual({ host: '192.168.1.20', root: 'D:\\LU models', customNodes: ['ComfyUI-GGUF'] })
  })

  it('the notice names the machine, the folder, the layout and the node pack', () => {
    const text = remoteBundleNotice('Wan 2.1 Unfiltered', { host: '192.168.1.20', root: 'D:\\LU models', customNodes: ['ComfyUI-GGUF'] })
    expect(text).toContain('your ComfyUI runs on 192.168.1.20')
    expect(text).toContain('D:\\LU models')
    expect(text).toContain("ComfyUI's own folder layout")
    expect(text).toContain('this node pack on that machine: ComfyUI-GGUF')
  })

  it('COUNTER-CHECK: a ComfyUI on this machine installs its node pack as before', async () => {
    backendCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'comfy_model_target') return { remote: false }
      if (cmd === 'check_model_sizes') return []
      if (cmd === 'check_download_space') return { fits: true }
      if (cmd === 'download_model') return { status: 'started', id: '1' }
      return { status: 'installed' }
    })
    const report = await installBundleComplete(bundle())
    expect(report.remote).toBeUndefined()
    await vi.waitFor(() => expect(backendCall.mock.calls.map((c) => c[0])).toContain('install_custom_node'))
  })

  it('an older backend without the command counts as local', async () => {
    backendCall.mockImplementation(async () => { throw new Error('unknown command') })
    await expect(comfyModelTarget()).resolves.toEqual({ remote: false })
  })
})
