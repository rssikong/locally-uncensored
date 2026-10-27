/**
 * The Playwright project `mobile` picks its files by their own name, not by
 * the folder the repository happens to lie in. Found in the worktree
 * `s-agent`, where the filter "agent" ran every strand.
 */
import { describe, expect, it } from 'vitest'
import { mobileTestMatch } from '../../../e2e/mobile/filter'

const IN_AGENT_WORKTREE = [
  '/Users/dev/lu-mobile-wt/s-agent/e2e/mobile/agent.mobile.ts',
  '/Users/dev/lu-mobile-wt/s-agent/e2e/mobile/chat.mobile.ts',
  '/Users/dev/lu-mobile-wt/s-agent/e2e/mobile/create.mobile.ts',
  '/Users/dev/lu-mobile-wt/s-agent/e2e/mobile/shell.mobile.ts',
  '/Users/dev/lu-mobile-wt/s-agent/e2e/mobile/support.ts',
  '/Users/dev/lu-mobile-wt/s-agent/e2e/onboarding.spec.ts',
]

const picked = (only: string | undefined) => IN_AGENT_WORKTREE.filter((file) => mobileTestMatch(only).test(file)).map((file) => file.split('/').pop())

describe('mobileTestMatch', () => {
  it('without a wish it takes every mobile spec and nothing else', () => {
    expect(picked(undefined)).toEqual(['agent.mobile.ts', 'chat.mobile.ts', 'create.mobile.ts', 'shell.mobile.ts'])
    expect(picked('')).toEqual(['agent.mobile.ts', 'chat.mobile.ts', 'create.mobile.ts', 'shell.mobile.ts'])
  })

  it('one strand is one file, also in a worktree that carries the name of the strand', () => {
    expect(picked('agent')).toEqual(['agent.mobile.ts'])
    expect(picked('chat')).toEqual(['chat.mobile.ts'])
  })

  it('several strands, with spaces and with the ending written out', () => {
    expect(picked('agent, shell')).toEqual(['agent.mobile.ts', 'shell.mobile.ts'])
    expect(picked('chat.mobile.ts')).toEqual(['chat.mobile.ts'])
  })

  it('a name is the whole name of the file, not a part of it', () => {
    expect(picked('hat')).toEqual([])
    expect(picked('age')).toEqual([])
  })

  it('works with the path separators of Windows', () => {
    expect(mobileTestMatch('agent').test('C:\\wt\\s-agent\\e2e\\mobile\\agent.mobile.ts')).toBe(true)
    expect(mobileTestMatch('agent').test('C:\\wt\\s-agent\\e2e\\mobile\\chat.mobile.ts')).toBe(false)
  })

  it('something that is no name of a file is dropped, it never becomes part of the pattern', () => {
    expect(picked('.*')).toEqual(['agent.mobile.ts', 'chat.mobile.ts', 'create.mobile.ts', 'shell.mobile.ts'])
    expect(picked('agent|chat')).toEqual(['agent.mobile.ts', 'chat.mobile.ts', 'create.mobile.ts', 'shell.mobile.ts'])
  })
})
