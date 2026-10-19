import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkflowStore, shouldShowManagerNotice } from '../workflowStore'
import type { WorkflowTemplate } from '../../types/workflows'

// ── Helpers ─────────────────────────────────────────────────────

function makeWorkflow(id: string, name: string, opts: Partial<WorkflowTemplate> = {}): WorkflowTemplate {
  return {
    id,
    name,
    description: `Workflow ${name}`,
    source: 'manual',
    modelTypes: ['sdxl'],
    mode: 'image',
    workflow: { '1': { class_type: 'KSampler' } },
    parameterMap: {},
    installedAt: Date.now(),
    ...opts,
  }
}

const INITIAL_STATE = {
  installedWorkflows: [],
  modelTypeAssignments: {},
  modelNameAssignments: {},
  tags: [],
  workflowTags: {},
  modelTags: {},
  civitaiApiKey: '',
  civitaiHost: 'civitai.com',
  managerNoticeSeen: false,
  paramOverrides: {},
}

// ═══════════════════════════════════════════════════════════════
//  workflowStore
// ═══════════════════════════════════════════════════════════════

describe('workflowStore', () => {
  beforeEach(() => {
    useWorkflowStore.setState(INITIAL_STATE)
  })

  // ── Initial state ──────────────────────────────────────────

  describe('initial state', () => {
    it('has empty workflows and assignments', () => {
      const state = useWorkflowStore.getState()
      expect(state.installedWorkflows).toEqual([])
      expect(state.modelTypeAssignments).toEqual({})
      expect(state.modelNameAssignments).toEqual({})
      expect(state.civitaiApiKey).toBe('')
    })
  })

  // ── installWorkflow ────────────────────────────────────────

  describe('installWorkflow', () => {
    it('adds a workflow to the list', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'SDXL Basic'))
      expect(useWorkflowStore.getState().installedWorkflows).toHaveLength(1)
      expect(useWorkflowStore.getState().installedWorkflows[0].name).toBe('SDXL Basic')
    })

    it('prepends new workflows (most recent first)', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'First'))
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-2', 'Second'))
      const workflows = useWorkflowStore.getState().installedWorkflows
      expect(workflows[0].id).toBe('wf-2')
      expect(workflows[1].id).toBe('wf-1')
    })

    it('deduplicates by id — replaces existing with same id', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Original'))
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Updated'))
      const workflows = useWorkflowStore.getState().installedWorkflows
      expect(workflows).toHaveLength(1)
      expect(workflows[0].name).toBe('Updated')
    })

    it('deduplication moves updated workflow to front', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'First'))
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-2', 'Second'))
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'First Updated'))
      const workflows = useWorkflowStore.getState().installedWorkflows
      expect(workflows[0].id).toBe('wf-1')
      expect(workflows[0].name).toBe('First Updated')
      expect(workflows[1].id).toBe('wf-2')
    })

    it('handles multiple unique workflows', () => {
      for (let i = 0; i < 5; i++) {
        useWorkflowStore.getState().installWorkflow(makeWorkflow(`wf-${i}`, `Workflow ${i}`))
      }
      expect(useWorkflowStore.getState().installedWorkflows).toHaveLength(5)
    })
  })

  // ── removeWorkflow ─────────────────────────────────────────

  describe('removeWorkflow', () => {
    it('removes a workflow by id', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Test'))
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().installedWorkflows).toHaveLength(0)
    })

    it('does nothing when id does not exist', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Test'))
      useWorkflowStore.getState().removeWorkflow('nonexistent')
      expect(useWorkflowStore.getState().installedWorkflows).toHaveLength(1)
    })

    it('cascades to modelTypeAssignments', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Test'))
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().modelTypeAssignments).toEqual({})
    })

    it('cascades to modelNameAssignments', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Test'))
      useWorkflowStore.getState().assignToModelName('sdxl_turbo.safetensors', 'wf-1')
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().modelNameAssignments).toEqual({})
    })

    it('cascades to both assignment maps simultaneously', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Test'))
      useWorkflowStore.getState().assignToModelType('flux', 'wf-1')
      useWorkflowStore.getState().assignToModelName('flux-model.safetensors', 'wf-1')
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().modelTypeAssignments).toEqual({})
      expect(useWorkflowStore.getState().modelNameAssignments).toEqual({})
    })

    it('does not cascade assignments pointing to other workflows', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'One'))
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-2', 'Two'))
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().assignToModelType('flux', 'wf-2')
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().modelTypeAssignments).toEqual({ flux: 'wf-2' })
    })
  })

  // ── assignToModelType / unassignModelType ──────────────────

  describe('assignToModelType', () => {
    it('creates a model type to workflow mapping', () => {
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      expect(useWorkflowStore.getState().modelTypeAssignments['sdxl']).toBe('wf-1')
    })

    it('overwrites previous assignment for same type', () => {
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-2')
      expect(useWorkflowStore.getState().modelTypeAssignments['sdxl']).toBe('wf-2')
    })

    it('allows different types to map to same workflow', () => {
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().assignToModelType('flux', 'wf-1')
      expect(useWorkflowStore.getState().modelTypeAssignments['sdxl']).toBe('wf-1')
      expect(useWorkflowStore.getState().modelTypeAssignments['flux']).toBe('wf-1')
    })
  })

  describe('unassignModelType', () => {
    it('removes a model type assignment', () => {
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().unassignModelType('sdxl')
      expect(useWorkflowStore.getState().modelTypeAssignments['sdxl']).toBeUndefined()
    })

    it('does nothing for non-existent type', () => {
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().unassignModelType('flux')
      expect(useWorkflowStore.getState().modelTypeAssignments['sdxl']).toBe('wf-1')
    })
  })

  // ── assignToModelName / unassignModelName ──────────────────

  describe('assignToModelName', () => {
    it('creates a model name to workflow mapping', () => {
      useWorkflowStore.getState().assignToModelName('sdxl_turbo.safetensors', 'wf-1')
      expect(useWorkflowStore.getState().modelNameAssignments['sdxl_turbo.safetensors']).toBe('wf-1')
    })

    it('overwrites previous assignment for same name', () => {
      useWorkflowStore.getState().assignToModelName('model.safetensors', 'wf-1')
      useWorkflowStore.getState().assignToModelName('model.safetensors', 'wf-2')
      expect(useWorkflowStore.getState().modelNameAssignments['model.safetensors']).toBe('wf-2')
    })
  })

  describe('unassignModelName', () => {
    it('removes a model name assignment', () => {
      useWorkflowStore.getState().assignToModelName('model.safetensors', 'wf-1')
      useWorkflowStore.getState().unassignModelName('model.safetensors')
      expect(useWorkflowStore.getState().modelNameAssignments['model.safetensors']).toBeUndefined()
    })

    it('does nothing for non-existent name', () => {
      useWorkflowStore.getState().assignToModelName('model.safetensors', 'wf-1')
      useWorkflowStore.getState().unassignModelName('other.safetensors')
      expect(useWorkflowStore.getState().modelNameAssignments['model.safetensors']).toBe('wf-1')
    })
  })

  // ── getWorkflowForModel ────────────────────────────────────

  describe('getWorkflowForModel', () => {
    it('returns null when no assignments exist', () => {
      const wf = useWorkflowStore.getState().getWorkflowForModel('model.safetensors', 'sdxl')
      expect(wf).toBeNull()
    })

    it('returns workflow matched by model name (priority 1)', () => {
      const workflow = makeWorkflow('wf-name', 'Name Match')
      useWorkflowStore.getState().installWorkflow(workflow)
      useWorkflowStore.getState().assignToModelName('specific.safetensors', 'wf-name')
      const result = useWorkflowStore.getState().getWorkflowForModel('specific.safetensors', 'sdxl')
      expect(result).not.toBeNull()
      expect(result!.id).toBe('wf-name')
    })

    it('returns workflow matched by model type (priority 2)', () => {
      const workflow = makeWorkflow('wf-type', 'Type Match')
      useWorkflowStore.getState().installWorkflow(workflow)
      useWorkflowStore.getState().assignToModelType('flux', 'wf-type')
      const result = useWorkflowStore.getState().getWorkflowForModel('any-flux.safetensors', 'flux')
      expect(result).not.toBeNull()
      expect(result!.id).toBe('wf-type')
    })

    it('name override takes priority over type', () => {
      const wfType = makeWorkflow('wf-type', 'Type Workflow')
      const wfName = makeWorkflow('wf-name', 'Name Workflow')
      useWorkflowStore.getState().installWorkflow(wfType)
      useWorkflowStore.getState().installWorkflow(wfName)
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-type')
      useWorkflowStore.getState().assignToModelName('special.safetensors', 'wf-name')
      const result = useWorkflowStore.getState().getWorkflowForModel('special.safetensors', 'sdxl')
      expect(result!.id).toBe('wf-name')
    })

    it('falls back to type when name has no match', () => {
      const wfType = makeWorkflow('wf-type', 'Type Workflow')
      useWorkflowStore.getState().installWorkflow(wfType)
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-type')
      const result = useWorkflowStore.getState().getWorkflowForModel('unassigned.safetensors', 'sdxl')
      expect(result!.id).toBe('wf-type')
    })

    it('returns null when assigned workflow is not installed', () => {
      useWorkflowStore.getState().assignToModelType('sdxl', 'deleted-wf')
      const result = useWorkflowStore.getState().getWorkflowForModel('model.safetensors', 'sdxl')
      expect(result).toBeNull()
    })

    it('returns null when name assignment points to missing workflow', () => {
      useWorkflowStore.getState().assignToModelName('model.safetensors', 'deleted-wf')
      // Should fall through to type check, which also finds nothing
      const result = useWorkflowStore.getState().getWorkflowForModel('model.safetensors', 'sdxl')
      expect(result).toBeNull()
    })

    it('falls back to type when name assignment points to missing workflow', () => {
      const wfType = makeWorkflow('wf-type', 'Type Fallback')
      useWorkflowStore.getState().installWorkflow(wfType)
      useWorkflowStore.getState().assignToModelName('model.safetensors', 'deleted-wf')
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-type')
      const result = useWorkflowStore.getState().getWorkflowForModel('model.safetensors', 'sdxl')
      expect(result!.id).toBe('wf-type')
    })
  })

  // ── workflow and model tags ──────────────────────────────────

  describe('tags', () => {
    it('creates a trimmed tag and deduplicates names case-insensitively', () => {
      const firstId = useWorkflowStore
        .getState()
        .createTag('  Wan   2.2  ')

      const duplicateId = useWorkflowStore
        .getState()
        .createTag('wan 2.2')

      expect(firstId).not.toBeNull()
      expect(duplicateId).toBe(firstId)

      const tags = useWorkflowStore.getState().tags

      expect(tags).toHaveLength(1)
      expect(tags[0].name).toBe('Wan 2.2')
    })

    it('blocks an explicitly assigned workflow that does not match the model tags', () => {
      const wanTag = useWorkflowStore
        .getState()
        .createTag('Wan 2.2')!

      const i2vTag = useWorkflowStore
        .getState()
        .createTag('I2V')!

      const t2vTag = useWorkflowStore
        .getState()
        .createTag('T2V')!

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-t2v', 'Wan T2V', {
            mode: 'video',
          }),
        )

      useWorkflowStore
        .getState()
        .setWorkflowTags(
          'wf-t2v',
          [wanTag, t2vTag],
        )

      useWorkflowStore
        .getState()
        .setModelTags(
          'wan-i2v.gguf',
          'video',
          [wanTag, i2vTag],
        )

      useWorkflowStore
        .getState()
        .assignToModelName(
          'wan-i2v.gguf',
          'wf-t2v',
        )

      expect(
        useWorkflowStore
          .getState()
          .getWorkflowForModel(
            'wan-i2v.gguf',
            'wan',
          ),
      ).toBeNull()
    })

    it('rejects an empty tag name', () => {
      const id = useWorkflowStore.getState().createTag('   ')

      expect(id).toBeNull()
      expect(useWorkflowStore.getState().tags).toEqual([])
    })

    it('renames a tag', () => {
      const id = useWorkflowStore
        .getState()
        .createTag('Old name')!

      useWorkflowStore
        .getState()
        .renameTag(id, 'New name')

      expect(useWorkflowStore.getState().tags[0].name)
        .toBe('New name')
    })

    it('removes a deleted tag from workflows and models', () => {
      const id = useWorkflowStore
        .getState()
        .createTag('Wan')!

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-1', [id])

      useWorkflowStore
        .getState()
        .setModelTags('wan.gguf', 'video', [id])

      useWorkflowStore
        .getState()
        .deleteTag(id)

      const state = useWorkflowStore.getState()

      expect(state.tags).toEqual([])
      expect(state.workflowTags).toEqual({})
      expect(state.modelTags).toEqual({})
    })

    it('filters unknown and duplicate tag IDs from assignments', () => {
      const id = useWorkflowStore
        .getState()
        .createTag('I2V')!

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-1', [
          id,
          'missing-tag',
          id,
        ])

      expect(
        useWorkflowStore.getState().workflowTags['wf-1'],
      ).toEqual([id])
    })

    it('matches a workflow when the model has every required tag', () => {
      const wanTag = useWorkflowStore
        .getState()
        .createTag('Wan 2.2')!

      const i2vTag = useWorkflowStore
        .getState()
        .createTag('I2V')!

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-i2v', 'Wan I2V', {
            mode: 'video',
          }),
        )

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-i2v', [
          wanTag,
          i2vTag,
        ])

      useWorkflowStore
        .getState()
        .setModelTags(
          'wan-i2v.gguf',
          'video',
          [wanTag],
        )

      expect(
        useWorkflowStore
          .getState()
          .getMatchingWorkflows(
            'wan-i2v.gguf',
            'video',
          ),
      ).toEqual([])

      useWorkflowStore
        .getState()
        .setModelTags(
          'wan-i2v.gguf',
          'video',
          [wanTag, i2vTag],
        )

      expect(
        useWorkflowStore
          .getState()
          .getMatchingWorkflows(
            'wan-i2v.gguf',
            'video',
          )
          .map((workflow) => workflow.id),
      ).toEqual(['wf-i2v'])
    })

    it('normalises model casing and Windows path separators', () => {
      const tagId = useWorkflowStore
        .getState()
        .createTag('Wan')!

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-video', 'Wan Video', {
            mode: 'video',
          }),
        )

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-video', [tagId])

      useWorkflowStore
        .getState()
        .setModelTags(
          'Models\\WAN.GGUF',
          'video',
          [tagId],
        )

      const matches = useWorkflowStore
        .getState()
        .getMatchingWorkflows(
          'models/wan.gguf',
          'video',
        )

      expect(matches.map((workflow) => workflow.id))
        .toEqual(['wf-video'])
    })

    it('does not offer an image-only workflow for a video model', () => {
      const tagId = useWorkflowStore
        .getState()
        .createTag('Shared')!

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-image', 'Image only', {
            mode: 'image',
          }),
        )

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-image', [tagId])

      useWorkflowStore
        .getState()
        .setModelTags(
          'wan.gguf',
          'video',
          [tagId],
        )

      expect(
        useWorkflowStore
          .getState()
          .getMatchingWorkflows(
            'wan.gguf',
            'video',
          ),
      ).toEqual([])
    })

    it('sorts more specific matching workflows first', () => {
      const wanTag = useWorkflowStore
        .getState()
        .createTag('Wan')!

      const i2vTag = useWorkflowStore
        .getState()
        .createTag('I2V')!

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-general', 'Wan general', {
            mode: 'video',
          }),
        )

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-specific', 'Wan I2V', {
            mode: 'video',
          }),
        )

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-general', [
          wanTag,
        ])

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-specific', [
          wanTag,
          i2vTag,
        ])

      useWorkflowStore
        .getState()
        .setModelTags(
          'wan-i2v.gguf',
          'video',
          [wanTag, i2vTag],
        )

      expect(
        useWorkflowStore
          .getState()
          .getMatchingWorkflows(
            'wan-i2v.gguf',
            'video',
          )
          .map((workflow) => workflow.id),
      ).toEqual([
        'wf-specific',
        'wf-general',
      ])
    })

    it('does not activate a tag match automatically', () => {
      const tagId = useWorkflowStore
        .getState()
        .createTag('SDXL')!

      useWorkflowStore
        .getState()
        .installWorkflow(
          makeWorkflow('wf-tagged', 'Tagged SDXL'),
        )

      useWorkflowStore
        .getState()
        .setWorkflowTags('wf-tagged', [tagId])

      useWorkflowStore
        .getState()
        .setModelTags(
          'model.safetensors',
          'image',
          [tagId],
        )

      expect(
        useWorkflowStore
          .getState()
          .getMatchingWorkflows(
            'model.safetensors',
            'image',
          ),
      ).toHaveLength(1)

      expect(
        useWorkflowStore
          .getState()
          .getWorkflowForModel(
            'model.safetensors',
            'sdxl',
          ),
      ).toBeNull()
    })
  })

  // ── setCivitaiApiKey ───────────────────────────────────────

  describe('setCivitaiApiKey', () => {
    it('sets the CivitAI API key', () => {
      useWorkflowStore.getState().setCivitaiApiKey('civitai-key-123')
      expect(useWorkflowStore.getState().civitaiApiKey).toBe('civitai-key-123')
    })

    it('can clear the key', () => {
      useWorkflowStore.getState().setCivitaiApiKey('key')
      useWorkflowStore.getState().setCivitaiApiKey('')
      expect(useWorkflowStore.getState().civitaiApiKey).toBe('')
    })
  })

  // ── Integration scenarios ──────────────────────────────────

  describe('integration', () => {
    it('full lifecycle: install, assign, query, remove', () => {
      const wf = makeWorkflow('wf-1', 'My Custom SDXL')
      useWorkflowStore.getState().installWorkflow(wf)
      useWorkflowStore.getState().assignToModelType('sdxl', 'wf-1')
      useWorkflowStore.getState().assignToModelName('special-sdxl.safetensors', 'wf-1')

      // Query by name
      expect(useWorkflowStore.getState().getWorkflowForModel('special-sdxl.safetensors', 'sdxl')!.id).toBe('wf-1')
      // Query by type
      expect(useWorkflowStore.getState().getWorkflowForModel('other-sdxl.safetensors', 'sdxl')!.id).toBe('wf-1')

      // Remove
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().getWorkflowForModel('special-sdxl.safetensors', 'sdxl')).toBeNull()
      expect(useWorkflowStore.getState().getWorkflowForModel('other-sdxl.safetensors', 'sdxl')).toBeNull()
    })
  })

  // ── The one-time Create notice ─────────────────────────────

  describe('manager notice', () => {
    it('shows on the local backend until it is dismissed', () => {
      expect(shouldShowManagerNotice('local', false)).toBe(true)
      expect(shouldShowManagerNotice('local', true)).toBe(false)
    })

    it('never shows in cloud mode, where a local graph cannot run', () => {
      expect(shouldShowManagerNotice('cloud', false)).toBe(false)
      expect(shouldShowManagerNotice('cloud', true)).toBe(false)
    })

    it('starts undismissed and stays dismissed once set', () => {
      expect(useWorkflowStore.getState().managerNoticeSeen).toBe(false)
      useWorkflowStore.getState().setManagerNoticeSeen(true)
      expect(useWorkflowStore.getState().managerNoticeSeen).toBe(true)
      // Installing a workflow must not resurrect the notice.
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-9', 'Any'))
      expect(useWorkflowStore.getState().managerNoticeSeen).toBe(true)
    })
  })

  // ── Workflow parameters (GitHub wish #8) ───────────────────

  describe('paramOverrides', () => {
    it('keeps only what differs from the file, per workflow, and Reset drops it', () => {
      const { setParamOverride, resetParamOverrides } = useWorkflowStore.getState()
      setParamOverride('wf-1', '3', 'denoise', 0.5)
      setParamOverride('wf-1', '10', 'lora_name', 'a.safetensors')
      setParamOverride('wf-2', '3', 'denoise', 0.7)
      expect(useWorkflowStore.getState().paramOverrides).toEqual({
        'wf-1': { '3': { denoise: 0.5 }, '10': { lora_name: 'a.safetensors' } },
        'wf-2': { '3': { denoise: 0.7 } },
      })
      setParamOverride('wf-1', '10', 'lora_name', undefined)
      expect(useWorkflowStore.getState().paramOverrides['wf-1']).toEqual({ '3': { denoise: 0.5 } })
      resetParamOverrides('wf-1')
      expect(useWorkflowStore.getState().paramOverrides).toEqual({ 'wf-2': { '3': { denoise: 0.7 } } })
    })

    it('is persisted with the workflow store, which the update backup covers', () => {
      useWorkflowStore.getState().setParamOverride('wf-1', '11', 'stop_at_clip_layer', -1)
      const options = useWorkflowStore.persist.getOptions()
      expect(options.name).toBe('workflow-store')
      const saved = options.partialize!(useWorkflowStore.getState()) as { paramOverrides?: unknown }
      expect(saved.paramOverrides).toEqual({ 'wf-1': { '11': { stop_at_clip_layer: -1 } } })
    })

    it('goes with the workflow when it is removed', () => {
      useWorkflowStore.getState().installWorkflow(makeWorkflow('wf-1', 'Mine'))
      useWorkflowStore.getState().setParamOverride('wf-1', '3', 'denoise', 0.5)
      useWorkflowStore.getState().removeWorkflow('wf-1')
      expect(useWorkflowStore.getState().paramOverrides).toEqual({})
    })
  })
})
