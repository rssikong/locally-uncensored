/**
 * The group multiplier is said out loud (2.6.6, plan A4).
 *
 * One Enter in a group chat buys N answers on the shared history, and nothing
 * on screen used to say so. The wording is the whole feature, so it is pinned
 * here rather than left to a refactor.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { groupCostHintText } from '../GroupCostHint'
import { GROUP_CHAT_MIN, GROUP_CHAT_MAX } from '../../../lib/group-chat'

describe('groupCostHintText', () => {
  it('names the round, the answers and the cost', () => {
    expect(groupCostHintText(3)).toBe('1 round = 3 answers = 3x the cost')
  })

  it('covers the whole supported line-up', () => {
    for (let n = GROUP_CHAT_MIN; n <= GROUP_CHAT_MAX; n++) {
      expect(groupCostHintText(n)).toBe(`1 round = ${n} answers = ${n}x the cost`)
    }
  })
})

describe('the hint only exists while a line-up is active', () => {
  const source = readFileSync(resolve(__dirname, '..', 'GroupCostHint.tsx'), 'utf8')

  it('renders nothing for a single-model chat', () => {
    // isGroupChat is false below GROUP_CHAT_MIN, so a normal chat gets no bar.
    expect(source).toMatch(/if \(!isGroupChat\(groupModels\)\) return null/)
  })

  it('negative control: the line-up comes from the conversation, the model list only narrows it', () => {
    // The line-up lives on the conversation. Reading the model store instead
    // would show the hint in every chat. Since GH #165 the model list is read
    // for one thing only: which members of THIS line-up are listed and answer.
    expect(source).toMatch(/s\.conversations\.find/)
    expect(source).toMatch(/availableGroupMembers\(groupModels, models, inventoryLoaded\)/)
  })

  it('GH #165: a member that sits out is not counted as an answer', () => {
    expect(groupCostHintText(2, 0, 1)).toBe('1 round = 2 answers = 2x the cost (1 unavailable model sits out)')
    expect(groupCostHintText(1, 0, 2)).toBe('1 round = 1 answer = 1x the cost (2 unavailable models sit out)')
  })
})
