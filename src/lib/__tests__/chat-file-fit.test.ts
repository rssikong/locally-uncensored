/**
 * GH #171: the pure half of fitting an attached text into a model's context.
 *
 * The sizes keep a wide margin to every limit, so these hold for any token
 * estimate that grows with the text (estimateTokens is about to become CJK
 * aware, GH #167).
 *
 * Run: npx vitest run src/lib/__tests__/chat-file-fit.test.ts
 */
import { describe, it, expect } from 'vitest'
import { chipCutLabel, fileCutNotice, fileRoom, fitFiles, prefixThatFits, tighterRoom } from '../chat-file-fit'
import { describeFileBytes, heldText } from '../chat-files'
import { estimateTokens } from '../context-compaction'
import type { FileAttachment } from '../../types/chat'

function textFile(name: string, text: string): FileAttachment {
  return { name, size: text.length, sha256: 'a'.repeat(64), ...describeFileBytes(new TextEncoder().encode(text), name) }
}

const STORY = '物語の一行です。'.repeat(5000) // 40,000 characters

describe('fileRoom', () => {
  it('is the send budget minus the rest of the request, named after the window', () => {
    const room = fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 9_715 })
    expect(room).toEqual({ tokens: 200_000, reason: 'context', window: 262_144 })
  })

  it('names a send limit when the budget sits below the plain share of the window', () => {
    const room = fileRoom({ window: 262_144, payloadBudget: 65_536, otherTokens: 536 })
    expect(room.reason).toBe('send-limit')
    expect(room.tokens).toBe(65_000)
  })

  it('the setting caps it, and is named, only when it is the tighter one', () => {
    expect(fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 0, limit: 4000 })).toMatchObject({ tokens: 4000, reason: 'setting' })
    expect(fileRoom({ window: 8192, payloadBudget: 6553, otherTokens: 6000, limit: 4000 })).toMatchObject({ tokens: 553, reason: 'context' })
  })

  it('never goes below zero', () => {
    expect(fileRoom({ window: 4096, payloadBudget: 3276, otherTokens: 90_000 }).tokens).toBe(0)
  })

  it('a group takes the smallest room at the table', () => {
    const big = fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 0 })
    const small = fileRoom({ window: 8192, payloadBudget: 6553, otherTokens: 0 })
    expect(tighterRoom(tighterRoom(null, big), small)).toBe(small)
  })
})

describe('prefixThatFits', () => {
  it('returns the longest start whose estimate stays within the tokens', () => {
    const n = prefixThatFits(STORY, 1000)
    expect(estimateTokens(STORY.slice(0, n))).toBeLessThanOrEqual(1000)
    expect(estimateTokens(STORY.slice(0, n + 1))).toBeGreaterThan(1000)
  })

  it('the whole text when it fits, nothing when there is no room', () => {
    expect(prefixThatFits('short', 1000)).toBe(5)
    expect(prefixThatFits(STORY, 0)).toBe(0)
  })

  it('never splits a surrogate pair', () => {
    const emoji = '😀'.repeat(400)
    expect(prefixThatFits(emoji, 51) % 2).toBe(0)
  })
})

describe('fitFiles', () => {
  it('leaves a file that fits exactly as it is', () => {
    const file = textFile('story.md', STORY)
    const out = fitFiles([file], fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 0 }))
    expect(out.files).toEqual([file])
    expect(out.cut).toEqual([])
  })

  it('cuts a file that does not fit, and keeps the count of the whole', () => {
    const file = textFile('story.md', STORY)
    const out = fitFiles([file], fileRoom({ window: 8192, payloadBudget: 6553, otherTokens: 3000 }))
    const [sent] = out.files!
    expect(out.cut).toEqual([sent])
    expect(sent.textChars).toBe(STORY.length)
    expect(sent.includedChars).toBeGreaterThan(0)
    expect(sent.includedChars!).toBeLessThan(STORY.length)
    expect(heldText(sent)).toBe(STORY.slice(0, sent.includedChars))
    expect(sent.summary).toContain("does not fit into your context window")
  })

  it('a resend of a file cut before cuts no further when it now fits, and keeps its mark', () => {
    const file = textFile('story.md', STORY)
    const once = fitFiles([file], fileRoom({ window: 8192, payloadBudget: 6553, otherTokens: 3000 })).files!
    const again = fitFiles(once, fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 0 }))
    expect(again.files).toEqual(once)
    expect(again.cut).toEqual([])
  })

  it('two files share the room in the order they were attached', () => {
    const first = textFile('a.md', STORY)
    const second = textFile('b.md', STORY)
    const out = fitFiles([first, second], fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 0, limit: Math.ceil(estimateTokens(STORY) * 1.5) }))
    expect(out.files![0]).toEqual(first)
    expect(out.cut.map((f) => f.name)).toEqual(['b.md'])
  })

  it('a binary or an old excerpt is passed through untouched', () => {
    const old: FileAttachment = { name: 'old.txt', size: 9000, kind: 'Text file (.txt)', sha256: 'b'.repeat(64), summary: 'The file is longer than this excerpt. The first 4000 characters:\nabc' }
    const bin: FileAttachment = { name: 'x.bin', size: 10, kind: 'Binary', sha256: 'c'.repeat(64), summary: 'This is a binary file.', binary: true }
    const out = fitFiles([old, bin], fileRoom({ window: 4096, payloadBudget: 3276, otherTokens: 3000 }))
    expect(out.files).toEqual([old, bin])
    expect(out.cut).toEqual([])
  })
})

describe('what the user reads', () => {
  it('the notice names the file, the share and the reason', () => {
    const file = textFile('story.md', STORY)
    const room = fileRoom({ window: 16_384, payloadBudget: 13_107, otherTokens: 3000 })
    const { cut } = fitFiles([file], room)
    const notice = fileCutNotice(cut, room)!
    expect(notice).toMatch(/^Only part of the attached text reached the model\. "story\.md": [\d,]+ of 40,000 characters, because the model's context window is 16K tokens/)
    expect(chipCutLabel(cut[0])).toMatch(/^\d+% sent \([\d,]+ of 40,000 characters\)$/)
  })

  it('the setting and the send limit are named as such', () => {
    const file = textFile('story.md', STORY)
    const set = fileRoom({ window: 262_144, payloadBudget: 209_715, otherTokens: 0, limit: 2000 })
    expect(fileCutNotice(fitFiles([file], set).cut, set)).toContain('the limit for attached files in Settings is 2,000 tokens')
    const capped = fileRoom({ window: 262_144, payloadBudget: 8192, otherTokens: 0 })
    expect(fileCutNotice(fitFiles([file], capped).cut, capped)).toContain('the send limit for this model is 8K tokens')
  })

  it('no cut, no notice, no mark', () => {
    expect(fileCutNotice([], fileRoom({ window: 8192, payloadBudget: 6553, otherTokens: 0 }))).toBeNull()
    expect(chipCutLabel(textFile('a.md', 'short'))).toBeNull()
  })
})
