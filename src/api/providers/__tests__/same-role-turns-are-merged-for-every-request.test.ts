/**
 * Discord (3.0.7): a Mistral or Devstral template raises on two consecutive
 * turns of the same role. LU merged them only where strict alternation was
 * on, which is a request without tools, and since Chat Tools are always on
 * most requests carry tools. Now two plain turns of one role become one on
 * every request, both texts kept in order with their speaker tags; tool
 * turns keep their own pairing.
 *
 * Run: npx vitest run src/api/providers/__tests__/same-role-turns-are-merged-for-every-request.test.ts
 */
import { describe, it, expect } from 'vitest'
import { applyTemplateContract, mergeSameRoleTurns, type ContractMessage } from '../normalize-system'

const native = { toolRole: 'native', alternate: false } as const

describe('two turns of one role in a row', () => {
  it('become one on a request with tools, both texts in order', () => {
    const out = applyTemplateContract<ContractMessage>([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'answer' },
    ], native)
    expect(out.map((m) => m.role)).toEqual(['system', 'user', 'assistant'])
    expect(out[1].content).toBe('first\n\nsecond')
  })

  it('keep the speaker tags of a group turn', () => {
    const out = mergeSameRoleTurns<ContractMessage>([
      { role: 'user', content: 'Where now?' },
      { role: 'user', content: '[Walt] The bridge.' },
      { role: 'assistant', content: 'I follow.' },
    ])
    expect(out[0].content).toBe('Where now?\n\n[Walt] The bridge.')
  })

  it('carry the images of both', () => {
    const img = (d: string) => ({ data: d, mimeType: 'image/png' })
    const out = mergeSameRoleTurns<ContractMessage>([
      { role: 'user', content: 'a', images: [img('1')] },
      { role: 'user', content: 'b', images: [img('2')] },
    ])
    expect(out).toHaveLength(1)
    expect(out[0].images?.map((i) => i.data)).toEqual(['1', '2'])
  })

  it('leave tool calls and tool results apart', () => {
    const turns: ContractMessage[] = [
      { role: 'user', content: 'look it up' },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'web_search', arguments: {} } }] },
      { role: 'tool', content: 'r1', tool_call_id: 'c1' },
      { role: 'tool', content: 'r2', tool_call_id: 'c2' },
      { role: 'assistant', content: 'here' },
      { role: 'assistant', content: 'and more' },
    ]
    const out = mergeSameRoleTurns(turns)
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool', 'assistant'])
    expect(out.at(-1)?.content).toBe('here\n\nand more')
  })

  it('give back the same array when nothing repeats', () => {
    const turns: ContractMessage[] = [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]
    expect(mergeSameRoleTurns(turns)).toBe(turns)
  })
})
