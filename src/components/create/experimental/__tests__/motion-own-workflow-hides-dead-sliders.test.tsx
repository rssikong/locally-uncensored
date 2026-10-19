// @vitest-environment jsdom
/**
 * How-it-works session, 3.0.7: Motion Control with a workflow of the user's
 * own still showed "Quality (steps) 20", Size and "Frames 77f" above the
 * prompt, and Steps, Guidance, Width, Height, Frames and FPS in Advanced
 * settings. The run reads none of them (injectLaneParameters takes the
 * workflow's own). With such a workflow the sliders give way to a line that
 * points to Workflow parameters, where the KSampler's steps and CFG are
 * editable (the lane path, not the "Set by LU" of a normal run).
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/motion-own-workflow-hides-dead-sliders.test.tsx
 */
import { createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import example from '../../../../api/__tests__/fixtures/wan-animate/quantstack-example.api.json'
import type { ComfyApiGraph } from '../../../../types/comfy-graph'

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({
    generate: vi.fn(), cancel: vi.fn(), makeVoice: vi.fn(), quota: null,
    samplerList: ['euler'], schedulerList: ['simple'], loraList: [], vaeList: [], refreshModelLists: vi.fn(),
    connected: true, modelsLoaded: true, modelLoadError: null, mlxMissing: null,
    installCapability: vi.fn(), installModelBundle: vi.fn(),
  }),
}))
vi.mock('../../../../api/mlx-image', () => ({ isMlxImageHost: () => false }))
vi.mock('../../../../api/backend', async (orig) => ({
  ...((await orig()) as Record<string, unknown>),
  openExternal: vi.fn(),
}))
vi.mock('../../../../api/workflow-import', () => ({ loadNodeDefs: async () => null }))

const { Composer } = await import('../Composer')
const { ParamGroups } = await import('../ParamGroups')
const { AdvancedDrawer } = await import('../AdvancedDrawer')
const { useCreateStore } = await import('../../../../stores/createStore')
const { useWorkflowStore } = await import('../../../../stores/workflowStore')
const { parseImportedWorkflow } = await import('../../../../api/workflows')

const MODEL = 'Wan2.2-Animate-14B-Q4_K_M.gguf'
const wf = { ...parseImportedWorkflow('Wan animate native', example as unknown as ComfyApiGraph), id: 'wf-anim', installedAt: 1 }

function setup(withWorkflow: boolean) {
  useCreateStore.setState({
    backend: 'local', isGenerating: false, error: null, gallery: [], source: null, expertOpen: true,
    motionModelList: [{ name: MODEL, type: 'wananimate' }], localOpModel: MODEL,
  } as never)
  useCreateStore.getState().setIntent('motion')
  useWorkflowStore.setState({
    installedWorkflows: [wf], paramOverrides: {}, modelTypeAssignments: {}, modelTags: {}, workflowTags: {},
    modelNameAssignments: withWorkflow ? { [MODEL]: 'wf-anim' } : {},
  } as never)
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Motion Control with an own workflow', () => {
  it('the row above the prompt has no steps, size or frames, and says where they are', () => {
    setup(true)
    render(createElement(Composer, { onOpenAdvanced: () => {}, onOpenWorkflows: () => {} }))
    expect(screen.queryByText('Quality (steps)')).toBeNull()
    expect(screen.queryByText('Size')).toBeNull()
    expect(screen.queryByText('Frames')).toBeNull()
    expect(screen.getByTestId('motion-own-workflow').textContent).toMatch(/come from your workflow/)
  })

  it('Advanced settings has no Steps, Guidance, size, Frames, FPS, Sampler', () => {
    setup(true)
    render(createElement(ParamGroups))
    for (const label of ['Steps', 'Guidance', 'Width', 'Height', 'Frames', 'FPS', 'Sampler', 'Scheduler']) {
      expect(screen.queryByText(label)).toBeNull()
    }
    expect(screen.getByTestId('motion-own-workflow-note')).toBeTruthy()
    // The seed is still the tab's: the lane sets it.
    expect(screen.getByText(/Seed/)).toBeTruthy()
  })

  it('the parameter list in Advanced settings offers the workflow\'s own steps', async () => {
    setup(true)
    render(createElement(AdvancedDrawer, { open: true, onClose: () => {} }))
    await waitFor(() => expect(screen.getByText('Workflow parameters')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /KSampler/ }))
    expect((screen.getByLabelText('Steps') as HTMLInputElement).value).toBe('6')
    expect(screen.getByText('Set by LU: Seed')).toBeTruthy()
  })

  it('without an own workflow the sliders stay, LU\'s graph reads them', () => {
    setup(false)
    render(createElement(Composer, { onOpenAdvanced: () => {}, onOpenWorkflows: () => {} }))
    expect(screen.getByText('Quality (steps)')).toBeTruthy()
    expect(screen.queryByTestId('motion-own-workflow')).toBeNull()
  })
})
