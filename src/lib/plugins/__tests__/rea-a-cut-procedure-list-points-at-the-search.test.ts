/**
 * A37, Discord "Ghidra and REA", xxcoder, 26.10.2026:
 *
 *   "sigh it wont read the full list from list_procedures lol"
 *
 * list_procedures of a Windows program came back at about 400,000 characters,
 * LU cut it at 40,000 and advised a reference, `detail "summary"`, source_paths
 * or a page. list_procedures takes none of those (REA 6.5.0: `document` only),
 * and the tools that find one function by name were never offered. The model
 * circled; main was never reached.
 *
 * Run: npx vitest run src/lib/plugins/__tests__/rea-a-cut-procedure-list-points-at-the-search.test.ts
 */
import { describe, it, expect } from 'vitest'
import { REA_RESULT_MAX, reaResultForModel } from '../rea-model'
import { reaToolsFor } from '../rea-tools'

const procedures = JSON.stringify({
  evidence_id: `ev_${'a'.repeat(64)}`,
  normalized_result: { procedures: Array.from({ length: 12000 }, (_, i) => ({ address: `0x${(0x401000 + i * 16).toString(16)}`, value: `FUN_${i}` })) },
})

describe('a cut list of procedures', () => {
  it('points at search_procedures and procedure_pseudo_code, not at a page it does not have', () => {
    const out = reaResultForModel(procedures, 'list_procedures')
    expect(out).toContain(`[LU cut this result at ${REA_RESULT_MAX} of`)
    expect(out).toMatch(/search_procedures \(a name such as main/)
    expect(out).toMatch(/procedure_pseudo_code/)
    expect(out).not.toMatch(/detail "summary"|source_paths|retained-evidence/)
  })

  it('other tools keep the general advice', () => {
    const out = reaResultForModel(procedures, 'analyze_javascript_application')
    expect(out).toMatch(/detail "summary"/)
  })

  it('a Ghidra turn is offered the tools that find one function by name', () => {
    const all = ['open_binary', 'binary_session', 'search_procedures', 'procedure_address', 'procedure_info', 'list_procedures', 'procedure_pseudo_code']
    const got = reaToolsFor('Use the Ghidra provider in REA to analyze GIFAnimator.exe and decompile main', all)
    expect(got).toEqual(expect.arrayContaining(['search_procedures', 'procedure_address', 'procedure_info', 'procedure_pseudo_code']))
  })
})
