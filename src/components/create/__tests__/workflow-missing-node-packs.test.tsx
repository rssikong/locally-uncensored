/**
 * @vitest-environment jsdom
 *
 * GitHub wish #14 on the real Workflows view: a regular ComfyUI save that
 * uses node types ComfyUI does not know names them, offers the pack LU's own
 * registry knows for a type, and sends the rest to the Git link field. On the
 * Mac, which has no ComfyUI, nothing is offered.
 *
 * Run: npx vitest run src/components/create/__tests__/workflow-missing-node-packs.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const FIX = join(process.cwd(), 'src/api/__tests__/fixtures/comfy-ui')
const fixture = (name: string) => readFileSync(join(FIX, name), 'utf8')
const defs = JSON.parse(fixture('object-info.json')) as Record<string, unknown>

let mac = false
const calls: Array<{ cmd: string; args?: Record<string, unknown> }> = []

vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => false,
  isMacOS: () => mac,
  comfyuiUrl: (p: string) => `http://localhost:8188${p}`,
  localFetch: async (url: string) => {
    const type = decodeURIComponent(url.split('/object_info/')[1] ?? '')
    const body = defs[type] ? { [type]: defs[type] } : {}
    return new Response(JSON.stringify(body), { status: 200 })
  },
  backendCall: vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
    calls.push({ cmd, args })
    if (cmd === 'custom_node_log') return { lines: [], next: 0 }
    if (cmd === 'install_custom_node') return { status: 'installed' }
    return null
  }),
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: [], fetchModels: async () => {} }),
}))

const { WorkflowsModal } = await import('../WorkflowsModal')
const { useWorkflowStore } = await import('../../../stores/workflowStore')
const { useUIStore } = await import('../../../stores/uiStore')

/** The SDXL save with its SaveImage turned into VHS_VideoCombine (a pack LU
 *  knows) and its KSampler into a type nobody lists. Both stay wired. */
function withMissingNodes(): string {
  const ui = JSON.parse(fixture('sdxl-txt2img.ui.json'))
  for (const node of ui.nodes) {
    if (node.type === 'SaveImage') node.type = 'VHS_VideoCombine'
    if (node.type === 'KSampler') node.type = 'MysterySampler'
  }
  return JSON.stringify(ui)
}

function paste(text: string) {
  fireEvent.change(screen.getByPlaceholderText('Or paste the workflow JSON here'), { target: { value: text } })
  fireEvent.click(screen.getByText('Install pasted workflow'))
}

beforeEach(() => {
  mac = false
  calls.length = 0
  useWorkflowStore.setState({ installedWorkflows: [] })
})
afterEach(() => cleanup())

describe('Workflows view, missing node packs', () => {
  it('offers the known pack, names the unknown type and points to the link field', async () => {
    render(createElement(WorkflowsModal, { open: true, onClose: () => {} }))
    paste(withMissingNodes())

    const panel = await screen.findByTestId('missing-node-packs')
    expect(panel.textContent).toContain('ComfyUI-VideoHelperSuite for VHS_VideoCombine')
    expect(panel.textContent).toContain('install only packs you trust')
    expect(panel.textContent).toContain('LU does not know which pack brings this node: MysterySampler')

    fireEvent.click(screen.getByText('Install ComfyUI-VideoHelperSuite'))
    await screen.findByText(/Installed. Restart ComfyUI to load the new nodes/)
    expect(calls.find((c) => c.cmd === 'install_custom_node')?.args).toEqual({
      repoUrl: 'https://github.com/Kosinkadink/ComfyUI-VideoHelperSuite', nodeName: 'ComfyUI-VideoHelperSuite',
    })

    fireEvent.click(screen.getByText('Open node packs'))
    expect(useUIStore.getState().currentView).toBe('settings')
    expect(useUIStore.getState().settingsFocus).toEqual({ tab: 'backends', section: 'comfyui-nodes' })
  })

  it('a workflow whose nodes are all known shows no panel', async () => {
    render(createElement(WorkflowsModal, { open: true, onClose: () => {} }))
    paste(fixture('sdxl-txt2img.ui.json'))
    await screen.findByText(/Installed "Imported Workflow"/)
    expect(screen.queryByTestId('missing-node-packs')).toBeNull()
  })

  it('on the Mac the types are named in the error and nothing is offered', async () => {
    mac = true
    render(createElement(WorkflowsModal, { open: true, onClose: () => {} }))
    paste(withMissingNodes())
    await screen.findByText(/ComfyUI does not know these nodes: MysterySampler, VHS_VideoCombine/)
    expect(screen.queryByTestId('missing-node-packs')).toBeNull()
  })
})
