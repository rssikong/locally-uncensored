/**
 * @vitest-environment jsdom
 *
 * Settings, ComfyUI node packs (GitHub wish #14): the list shows what sits in
 * custom_nodes with origin, state and disabled packs; a pasted link installs
 * only after the sentence about foreign code was on screen; Remove asks twice
 * and ends in the trash; after a change the Restart button appears.
 *
 * Run: npx vitest run src/components/settings/__tests__/custom-nodes-settings.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import type { NodePack, NodePackList } from '../../../api/custom-node-packs'

const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []
let listing: NodePackList
let logLines: string[] = []
let installResult: unknown = { status: 'installed' }

vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => true,
  backendCall: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === 'list_custom_nodes') return listing
    if (cmd === 'custom_node_log') {
      const since = typeof args?.since === 'number' ? args.since : logLines.length
      return { lines: logLines.slice(since), next: logLines.length }
    }
    if (cmd === 'install_custom_node') {
      logLines.push('Cloning https://github.com/a/my-pack into custom_nodes/my-pack', 'Successfully installed gguf-0.1')
      if (installResult instanceof Error) throw installResult.message
      return installResult
    }
    if (cmd === 'remove_custom_node') return { trashed: true, restarted: false }
    return null
  }),
}))

const restart = vi.fn(async () => {})
vi.mock('../../../api/comfy-restart', () => ({ restartComfyForNewNodes: () => restart() }))

const { CustomNodesSettings } = await import('../CustomNodesSettings')
const { FOREIGN_CODE_NOTICE } = await import('../../../api/custom-node-packs')

const pack = (over: Partial<NodePack>): NodePack => ({
  folder: 'x', name: 'x', enabled: true, inDisabledDir: false, kind: 'git', origin: null, branch: null,
  commit: null, committedAt: null, hasRequirements: false, ...over,
})

beforeEach(() => {
  calls.length = 0
  logLines = []
  installResult = { status: 'installed' }
  restart.mockClear()
  listing = {
    available: true,
    path: 'C:\\ComfyUI\\custom_nodes',
    packs: [
      pack({
        folder: 'ComfyUI-GGUF', name: 'ComfyUI-GGUF', origin: 'https://github.com/city96/ComfyUI-GGUF',
        branch: 'main', commit: 'abcdef1', committedAt: '2026-10-01T10:00:00+02:00', hasRequirements: true,
      }),
      pack({ folder: 'ComfyUI-RMBG.disabled', name: 'ComfyUI-RMBG', enabled: false, origin: 'https://github.com/1038lab/ComfyUI-RMBG', commit: '58f1947' }),
      pack({ folder: 'loose', name: 'loose', kind: 'folder' }),
    ],
  }
})
afterEach(() => cleanup())

const rowOf = (name: string) => screen.getByText(name).closest('li') as HTMLElement

describe('Settings, ComfyUI node packs', () => {
  it('lists every pack with origin, state and what is disabled', async () => {
    render(createElement(CustomNodesSettings))
    await screen.findByText('ComfyUI-GGUF')
    expect(screen.getByText('Installed (3)')).toBeTruthy()
    const gguf = rowOf('ComfyUI-GGUF')
    expect(gguf.textContent).toContain('github.com/city96/ComfyUI-GGUF')
    expect(gguf.textContent).toContain('main · abcdef1 · 2026-10-01')
    const rmbg = rowOf('ComfyUI-RMBG')
    expect(within(rmbg).getByText('Disabled')).toBeTruthy()
    expect(rmbg.textContent).toContain('pinned · 58f1947')
    expect((within(rmbg).getByLabelText('Update ComfyUI-RMBG') as HTMLButtonElement).disabled).toBe(true)
    expect(within(rowOf('loose')).getByText('No git')).toBeTruthy()
    expect((within(gguf).getByLabelText('Update ComfyUI-GGUF') as HTMLButtonElement).disabled).toBe(false)
  })

  it('says why when ComfyUI is on another machine, and offers nothing', async () => {
    listing = { available: false, reason: 'Your ComfyUI runs on 10.0.0.5. LU cannot manage node packs on another machine.', packs: [] }
    render(createElement(CustomNodesSettings))
    await screen.findByText(/runs on 10\.0\.0\.5/)
    expect(screen.queryByLabelText('Git link of a node pack')).toBeNull()
  })

  it('a link installs only after the foreign code sentence, then shows the log and Restart', async () => {
    render(createElement(CustomNodesSettings))
    await screen.findByText('ComfyUI-GGUF')
    const input = screen.getByLabelText('Git link of a node pack')

    fireEvent.change(input, { target: { value: 'https://example.com/a/b' } })
    expect(screen.getByText(/github.com, gitlab.com and codeberg.org only/)).toBeTruthy()
    expect((screen.getByText('Install') as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(input, { target: { value: 'https://github.com/a/my-pack' } })
    fireEvent.click(screen.getByText('Install'))
    expect(calls.some((c) => c.cmd === 'install_custom_node')).toBe(false)
    const confirm = screen.getByTestId('node-pack-confirm')
    expect(confirm.textContent).toContain(FOREIGN_CODE_NOTICE)
    expect(confirm.textContent).toContain('https://github.com/a/my-pack into custom_nodes/my-pack')

    fireEvent.click(screen.getByText('Install my-pack'))
    await screen.findByText('my-pack is installed. Restart ComfyUI to load the change.')
    expect(calls.find((c) => c.cmd === 'install_custom_node')?.args).toEqual({
      repoUrl: 'https://github.com/a/my-pack', nodeName: 'my-pack', freshOnly: true,
    })
    await waitFor(() => expect(screen.getByTestId('node-pack-log').textContent).toContain('Successfully installed gguf-0.1'))

    fireEvent.click(screen.getByText('Restart ComfyUI'))
    await screen.findByText('ComfyUI restarted with the current node packs.')
    expect(restart).toHaveBeenCalledTimes(1)
  })

  it('a failed install shows the reason and no restart', async () => {
    installResult = new Error('Failed to clone my-pack: repository not found')
    render(createElement(CustomNodesSettings))
    await screen.findByText('ComfyUI-GGUF')
    fireEvent.change(screen.getByLabelText('Git link of a node pack'), { target: { value: 'https://github.com/a/my-pack' } })
    fireEvent.click(screen.getByText('Install'))
    fireEvent.click(screen.getByText('Install my-pack'))
    await screen.findByText(/repository not found/)
    expect(screen.queryByText('Restart ComfyUI')).toBeNull()
  })

  it('Remove asks twice and moves the pack to the trash', async () => {
    render(createElement(CustomNodesSettings))
    await screen.findByText('ComfyUI-GGUF')
    fireEvent.click(screen.getByLabelText('Remove ComfyUI-GGUF'))
    expect(calls.some((c) => c.cmd === 'remove_custom_node')).toBe(false)
    expect(screen.getByLabelText('Remove ComfyUI-GGUF').textContent).toContain('Confirm')
    fireEvent.click(screen.getByLabelText('Remove ComfyUI-GGUF'))
    await screen.findByText('ComfyUI-GGUF is in the trash. Restart ComfyUI to load the change.')
    expect(calls.find((c) => c.cmd === 'remove_custom_node')?.args).toEqual({ folder: 'ComfyUI-GGUF', inDisabledDir: false })
    expect(screen.getByText('Restart ComfyUI')).toBeTruthy()
  })
})
