/**
 * @vitest-environment jsdom
 *
 * Discord, 15.10.2026: a Wan 2.2 Animate workflow tagged together with the
 * Wan Animate model on the Video row of the Workflows window must show up in
 * the Workflow picker of Advanced settings. The picker looked the model's tags
 * up under Image (a Wan Animate model is not a plain video model), found none
 * and said "No tagged workflows".
 *
 * Run: npx vitest run src/components/create/__tests__/the-workflow-picker-offers-a-motion-workflow.test.tsx
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import example from '../../../api/__tests__/fixtures/wan-animate/quantstack-example.api.json'
import { parseImportedWorkflow } from '../../../api/workflows'
import { useWorkflowStore } from '../../../stores/workflowStore'
import { WorkflowFinder } from '../WorkflowFinder'
import type { ComfyApiGraph } from '../../../types/comfy-graph'

const MODEL = 'Wan2.2-Animate-14B-Q4_K_M.gguf'

beforeEach(() => {
  useWorkflowStore.setState({
    installedWorkflows: [], modelTypeAssignments: {}, modelNameAssignments: {},
    tags: [], workflowTags: {}, modelTags: {},
  } as never)
  const s = useWorkflowStore.getState()
  s.installWorkflow({ ...parseImportedWorkflow('Wan animate native', example as unknown as ComfyApiGraph), id: 'wf1', installedAt: 1 })
  const tag = s.createTag('Wan Animate')!
  s.setWorkflowTags('wf1', [tag])
  s.setModelTags(MODEL, 'video', [tag])
})
afterEach(cleanup)

describe('the Workflow picker on Motion Control', () => {
  it('offers the tagged workflow for the Wan Animate model', () => {
    render(<WorkflowFinder modelName={MODEL} modelType="wananimate" />)
    expect(screen.queryByText('No tagged workflows')).toBeNull()
    expect(screen.getByText('1 compatible workflow')).toBeTruthy()
  })
})
