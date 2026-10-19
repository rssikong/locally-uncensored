/**
 * d307-c H2 (Windows box): a second 4x Enhance of the same picture with the
 * same model came out of ComfyUI's cache. Only the save ran, and the line said
 * "Queued... 0s" to "10s" until the end. Once ComfyUI starts the prompt the
 * line leaves "Queued": starting, or saving when the heavy work is cached.
 *
 * Run: npx vitest run src/lib/__tests__/render-phase-cached-run.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { phaseForExecutionStart, phaseForSaveNode, phaseForExecutingNode } from '../render-phase-labels'

describe('a started prompt is not queued any more', () => {
  it('execution_start says starting', () => {
    expect(phaseForExecutionStart('queued')).toEqual({ phase: 'queued', pct: 12, label: 'Starting...' })
  })

  it('a cached Enhance says saving', () => {
    const step = phaseForExecutionStart('queued', ['LoadImage', 'UpscaleModelLoader', 'ImageUpscaleWithModel'])
    expect(step?.label).toBe('Saving...')
    expect(step?.phase).toBe('decoding')
  })

  it('a cached sampler or decode says saving too', () => {
    expect(phaseForExecutionStart('queued', ['KSampler'])?.label).toBe('Saving...')
    expect(phaseForExecutionStart('queued', ['VAEDecode'])?.label).toBe('Saving...')
  })

  it('cached light nodes alone are just a start', () => {
    expect(phaseForExecutionStart('queued', ['LoadImage', 'CLIPTextEncode'])?.label).toBe('Starting...')
  })

  it('never walks a real phase back', () => {
    expect(phaseForExecutionStart('loading-model', ['KSampler'])).toBeNull()
    expect(phaseForExecutionStart('sampling')).toBeNull()
  })
})

describe('a save node with nothing said before it', () => {
  it('says saving while still queued or starting', () => {
    expect(phaseForSaveNode('SaveImage', 'queued')?.label).toBe('Saving...')
    expect(phaseForSaveNode('VHS_VideoCombine', 'queued')?.label).toBe('Saving...')
  })

  it('keeps the decode line after a real decode, and ignores other nodes', () => {
    expect(phaseForSaveNode('SaveImage', 'decoding')).toBeNull()
    expect(phaseForSaveNode('SaveImage', 'sampling')).toBeNull()
    expect(phaseForSaveNode('CLIPTextEncode', 'queued')).toBeNull()
    // The node policy itself still has nothing to say about a save.
    expect(phaseForExecutingNode('SaveImage', 'image')).toBeNull()
  })
})

describe('the WS loop uses them', () => {
  const src = readFileSync(resolve(__dirname, '../../hooks/useCreate.ts'), 'utf8')
  it('handles execution_start and execution_cached', () => {
    expect(src).toContain("case 'execution_start':")
    expect(src).toContain("case 'execution_cached': {")
    expect(src).toContain('const step = phaseForExecutionStart(st.progressPhase, cached)')
  })
  it('falls back to the save node policy', () => {
    expect(src).toContain('?? phaseForSaveNode(classType, st.progressPhase)')
  })
})
