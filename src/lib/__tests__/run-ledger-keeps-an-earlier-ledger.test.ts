// Release gate 19.10.2026: a run whose persisted chain carried the ledger of
// its cut on the first kept message lost those lines when "continue" trimmed
// that message away. The new ledger takes them over, oldest first.
import { describe, expect, it } from 'vitest'
import { runLedger, splitLedger } from '../context-decay'

const call = (path: string) => ({
  role: 'assistant' as const,
  content: '',
  tool_calls: [{ id: path, type: 'function', function: { name: 'file_read', arguments: JSON.stringify({ path }) } }],
})

describe('runLedger with an earlier ledger', () => {
  it('a dropped message that carries a ledger hands its lines on', () => {
    const earlier = runLedger([call('src/a.ts'), call('src/b.ts')])!
    const first = { ...call('src/c.ts'), content: `${earlier}\n\nstep` }
    const ledger = runLedger([first, call('src/d.ts')])!
    const lines = splitLedger(ledger).lines
    expect(lines).toEqual(['file_read: src/a.ts', 'file_read: src/b.ts', 'file_read: src/c.ts', 'file_read: src/d.ts'])
  })

  it('a ledger on the pinned task is merged, not repeated', () => {
    const earlier = runLedger([call('src/a.ts')])!
    const split = splitLedger(`walk the tree\n\n${earlier}`)
    expect(split.task).toBe('walk the tree')
    const ledger = runLedger([call('src/b.ts')], split)!
    expect(ledger.match(/\[Run ledger\]/g)).toHaveLength(1)
    expect(splitLedger(ledger).lines).toEqual(['file_read: src/a.ts', 'file_read: src/b.ts'])
  })

  it('the count of older steps adds up across ledgers', () => {
    const many = Array.from({ length: 45 }, (_, i) => call(`src/f${i}.ts`))
    const earlier = runLedger(many)!
    expect(earlier).toContain('- (5 older steps)')
    const next = runLedger([{ ...call('src/x.ts'), content: earlier }])!
    expect(next).toContain('- (6 older steps)')
  })
})
