/**
 * Remove refusals (A14): the small helpers the dialog reads its numbers
 * through, the row fields the model list carries, and the prompt block of the
 * two local render tools, which must not depend on the model refusing.
 *
 * Run: npx vitest run src/api/__tests__/abliterate.test.ts
 */
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gb, minutesRange, phaseShare, roughDuration } from '../abliterate'

vi.mock('../backend', () => ({ backendCall: vi.fn(), isTauri: () => false }))

describe('numbers in the dialog', () => {
  it('reads time, size and progress the way people say them', () => {
    expect(minutesRange(13, 33)).toBe('13–33 min')
    expect(minutesRange(74, 191)).toBe('1–3 h')
    expect(minutesRange(40, 110)).toBe('40 min – 2 h')
    expect(roughDuration(90)).toBe('2 min')
    expect(roughDuration(5400)).toBe('1 h 30 min')
    expect(gb(988_097_824)).toBe('1.0 GB')
    expect(gb(27_900_000_000)).toBe('28 GB')
    expect(gb(null)).toBe('?')
    expect(gb(22_011_023)).toBe('22 MB')
    expect(phaseShare({ step: 50, total: 200 })).toBe(0.25)
    expect(phaseShare({ step: 5, total: 0 })).toBeNull()
  })
})

describe('the model list', () => {
  it('carries where the original is and whether LU made the copy', async () => {
    const { bundledToAIModels } = await import('../engine')
    const [orig, copy, older] = bundledToAIModels([
      { name: 'Qwen2.5-0.5B-Instruct-Q8_0', path: '/m/a.gguf', size: 1, loaded: false, sourceRepo: 'Qwen/Qwen2.5-0.5B-Instruct', refusalsRemoved: false },
      { name: 'Qwen2.5-0.5B-Instruct-refusals-removed-Q8_0', path: '/m/b.gguf', size: 1, loaded: false, sourceRepo: null, refusalsRemoved: true },
      { name: 'old', path: '/m/c.gguf', size: 1, loaded: false },
    ])
    expect(orig).toMatchObject({ sourceRepo: 'Qwen/Qwen2.5-0.5B-Instruct' })
    expect('refusalsRemoved' in orig).toBe(false)
    expect(copy).toMatchObject({ refusalsRemoved: true })
    expect('sourceRepo' in copy).toBe(false)
    expect('sourceRepo' in older || 'refusalsRemoved' in older).toBe(false)
  })
})

describe('the local render tools check the prompt themselves', () => {
  it('blocks what the safety module blocks, on every string argument', async () => {
    const { localRenderBlocked } = await import('../mcp/builtin-tools')
    expect(localRenderBlocked({ prompt: 'a lighthouse at dusk, film grain' })).toBeNull()
    expect(localRenderBlocked({ prompt: 'portrait', negative_prompt: 'child porn' })).toMatch(/^Error: This prompt was blocked/)
    expect(localRenderBlocked({ prompt: 'nude', extra: 'a 12 year old' })).toMatch(/^Error: /)
  })

  it('every way out of image_generate and video_generate passes the check first', () => {
    const src = readFileSync(resolve(__dirname, '../mcp/builtin-tools.ts'), 'utf8')
    const body = (name: string) => {
      const start = src.indexOf(`async function ${name}(`)
      const end = src.indexOf('\nasync function ', start + 10)
      return src.slice(start, end)
    }
    for (const fn of ['executeImageGenerate', 'executeVideoGenerate']) {
      const b = body(fn)
      const exits = [...b.matchAll(/return (executeImageGenerateMlx|executeVideoGenerateMlx|vramHandoffGenerate)\(/g)]
      expect(exits.length, fn).toBeGreaterThan(0)
      for (const exit of exits) {
        const before = b.slice(0, exit.index)
        const lastCheck = before.lastIndexOf('localRenderBlocked(')
        const lastExit = Math.max(
          before.lastIndexOf('return executeImageGenerateMlx('),
          before.lastIndexOf('return executeVideoGenerateMlx('),
        )
        expect(lastCheck, `${fn}: ${exit[0]} without a check before it`).toBeGreaterThan(lastExit)
      }
    }
  })
})
