/**
 * Check 4 on an iPhone, N1 (and check 4 on Android, F5): the page of a model
 * showed "Tools" with the packing IQ2_XXS chosen, while its card and the
 * model sheet did not. One pattern knows a 1 or 2 bit packing, in every
 * spelling, and the card and the page ask the same function.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { packedBelowThreeBit, packedTooHard } from '../device-fit'
import { toolsInPacking } from '../../screens/models/parts/catalog'
import type { MobileModel } from '../../data/mobile-models'

const BELOW = ['Q2_K', 'Q2_K_S', 'Q2_K_L', 'IQ2_XXS', 'IQ2_XS', 'IQ2_S', 'IQ2_M', 'IQ1_S', 'IQ1_M', 'Q1', 'Q2', 'iq2_xxs', 'q2_k', ' IQ2_M ', 'UD-IQ2_XXS', 'UD-IQ2_M', 'i1-IQ2_XS', 'i1-Q2_K']
const FROM_THREE = ['Q3_K_S', 'Q3_K_M', 'Q3_K_L', 'IQ3_XXS', 'IQ3_XS', 'IQ3_S', 'IQ3_M', 'Q4_0', 'Q4_K_S', 'Q4_K_M', 'IQ4_XS', 'Q5_K_M', 'Q6_K', 'Q8_0', 'F16', 'BF16', 'F32', 'UD-Q4_K_XL', 'i1-Q4_K_M', 'Q10', 'Q20_K', 'GGUF', '']

describe('a 1 or 2 bit packing, in every spelling', () => {
  it('is known as one', () => {
    for (const quant of BELOW) expect(packedBelowThreeBit(quant), quant).toBe(true)
  })

  it('3 bits and more are not, and no packing is not', () => {
    for (const quant of FROM_THREE) expect(packedBelowThreeBit(quant), quant).toBe(false)
    expect(packedBelowThreeBit(undefined)).toBe(false)
  })

  it('the Tools mark of a model that drives tools goes with each of them and stays from 3 bits on', () => {
    const drives = { agent: true } as MobileModel
    for (const quant of BELOW) expect(toolsInPacking(drives, quant), quant).toBe(false)
    for (const quant of FROM_THREE) expect(toolsInPacking(drives, quant), quant).toBe(true)
    expect(toolsInPacking({ agent: false } as MobileModel, 'Q4_K_M')).toBe(false)
  })

  it('the mark "Packed very small" follows the same pattern, up to 4 billion parameters', () => {
    for (const quant of BELOW) expect(packedTooHard(2, quant), quant).toBe(true)
    for (const quant of FROM_THREE) expect(packedTooHard(2, quant), quant).toBe(false)
    expect(packedTooHard(8, 'IQ2_XXS')).toBe(false)
  })

  it('the card and the page of a model ask the same function, and no place has a pattern of its own', () => {
    const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8')
    expect(read('src/mobile/screens/models/ModelDetailPage.tsx')).toMatch(/const toolsMark = !!facts && toolsInPacking\(/)
    expect(read('src/mobile/screens/models/parts/catalog.ts')).toMatch(/tools: toolsInPacking\(/)
    for (const file of ['src/mobile/screens/models/ModelDetailPage.tsx', 'src/mobile/screens/models/parts/catalog.ts', 'src/mobile/lib/model-facts.ts', 'src/mobile/screens/agent/parts/tool-support.ts']) {
      expect(read(file), file).not.toMatch(/Q\[12\]|Q\[1-2\]/)
    }
  })
})
