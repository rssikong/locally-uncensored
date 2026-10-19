/**
 * @vitest-environment jsdom
 *
 * GitHub Discussion #124 on the real Workflows view: a picked folder imports
 * every top-level .json one after the other, and each file gets its own line
 * (installed, or the reason it was not). Regular ComfyUI saves are converted
 * through /object_info, served here from the fixture excerpt.
 *
 * Run: npx vitest run src/components/create/__tests__/workflow-folder-import.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'

const FIX = join(process.cwd(), 'src/api/__tests__/fixtures/comfy-ui')
const fixture = (name: string) => readFileSync(join(FIX, name), 'utf8')
const defs = JSON.parse(fixture('object-info.json')) as Record<string, unknown>

let comfyUp = true

vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => false,
  comfyuiUrl: (p: string) => `http://localhost:8188${p}`,
  localFetch: async (url: string) => {
    if (!comfyUp) throw new Error('connection refused')
    const type = decodeURIComponent(url.split('/object_info/')[1] ?? '')
    const body = defs[type] ? { [type]: defs[type] } : {}
    return new Response(JSON.stringify(body), { status: 200 })
  },
  secretGet: vi.fn().mockRejectedValue(new Error('no keychain here')),
  secretSet: vi.fn(),
  secretDelete: vi.fn(),
}))

vi.mock('../../../hooks/useModels', () => ({
  useModels: () => ({ models: [], fetchModels: async () => {} }),
}))

const { WorkflowsModal } = await import('../WorkflowsModal')
const { useWorkflowStore } = await import('../../../stores/workflowStore')

function inFolder(name: string, text: string, path = `wf/${name}`): File {
  const file = new File([text], name, { type: 'application/json' })
  Object.defineProperty(file, 'webkitRelativePath', { value: path })
  return file
}

function pickFolder(files: File[]) {
  const input = screen.getByTestId('workflow-folder-input')
  fireEvent.change(input, { target: { files } })
}

beforeEach(() => {
  comfyUp = true
  useWorkflowStore.setState({ installedWorkflows: [] })
})
afterEach(() => cleanup())

describe('Workflows view, folder import', () => {
  it('installs each workflow and says why the others were not', async () => {
    render(createElement(WorkflowsModal, { open: true, onClose: () => {} }))
    const groupNode = JSON.parse(fixture('z-image-turbo.ui.json'))
    groupNode.nodes.push({ id: 60, type: 'workflow>Old group', mode: 0 })

    pickFolder([
      inFolder('sdxl.json', fixture('sdxl-txt2img.ui.json')),
      inFolder('api.json', JSON.stringify({ '1': { class_type: 'SaveImage', inputs: { filename_prefix: 'a' } } })),
      inFolder('broken.json', '{ nope'),
      inFolder('readme.txt', 'not a workflow'),
      inFolder('nested.json', fixture('z-image-turbo.ui.json'), 'wf/deeper/nested.json'),
      inFolder('with-group-node.json', JSON.stringify(groupNode)),
      inFolder('zimage.json', fixture('templates/image_z_image_turbo.json')),
    ])

    const results = await screen.findByTestId('workflow-import-results')
    await waitFor(() => expect(results.textContent).toContain('Imported 3 of 5'))
    expect(results.textContent).toContain('sdxl.json: Installed "sdxl". Converted from the regular ComfyUI format')
    expect(results.textContent).toContain('api.json: Installed "api".')
    expect(results.textContent).toContain('broken.json: That file does not contain valid JSON.')
    expect(results.textContent).toContain('with-group-node.json: This workflow uses group nodes')
    expect(results.textContent).toContain('zimage.json: Installed "zimage". Converted from the regular ComfyUI format (1 subgraph unpacked')
    expect(results.textContent).not.toContain('readme.txt')
    expect(results.textContent).not.toContain('nested.json')

    const installed = useWorkflowStore.getState().installedWorkflows
    expect(installed.map((w) => w.name).sort()).toEqual(['api', 'sdxl', 'zimage'])
    const zimage = installed.find((w) => w.name === 'zimage')
    expect(zimage?.workflow['57:3']?.class_type).toBe('KSampler')
    expect(zimage?.parameterMap.positivePrompt).toEqual({ nodeId: '57:27', inputKey: 'text' })
    const sdxl = installed.find((w) => w.name === 'sdxl')
    expect(sdxl?.workflow['3']?.class_type).toBe('KSampler')
    expect(sdxl?.parameterMap.positivePrompt).toEqual({ nodeId: '6', inputKey: 'text' })
  })

  it('tells the user to start ComfyUI for a regular save when it is not running', async () => {
    comfyUp = false
    render(createElement(WorkflowsModal, { open: true, onClose: () => {} }))
    pickFolder([inFolder('wan.json', fixture('wan22-i2v.ui.json'))])
    const results = await screen.findByTestId('workflow-import-results')
    await waitFor(() => expect(results.textContent).toContain('ComfyUI has to be running'))
    expect(useWorkflowStore.getState().installedWorkflows).toEqual([])
  })

  it('says so when the folder has no .json files', async () => {
    render(createElement(WorkflowsModal, { open: true, onClose: () => {} }))
    pickFolder([inFolder('notes.txt', 'x')])
    expect(await screen.findByText('That folder has no .json files.')).toBeTruthy()
  })
})
