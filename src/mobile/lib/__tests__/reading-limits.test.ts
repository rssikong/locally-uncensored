// @vitest-environment jsdom
/**
 * Round 10, N14 of the check on Android: a text file of 373 KB was turned
 * away, "1674 passages, the limit is 1500". The limit was one number for
 * every phone. It now follows the memory of the device, and the page shows
 * how long the reading still takes.
 *
 * Run: npx vitest run src/mobile/lib/__tests__/reading-limits.test.ts
 */
import { afterEach, describe, expect, it } from 'vitest'
import { chunkText, DEFAULT_MOBILE_RAG_LIMITS, getMobileRagLimits, setMobileRagLimits } from '../../../api/rag'
import { setDeviceOverride } from '../device-fit'
import { __setBridgeForTests } from '../../platform/bridge'
import { refreshModelSlotLimits } from '../../boot/wiring'
import { AGENT_STRINGS } from '../../strings/agent'
import { DOCUMENT_RAM_SHARE, MAX_PASSAGES, MIN_PASSAGES, PACE_MIN_MS, PACE_MIN_PASSAGES, PASSAGE_BYTES, maxPassagesFor, secondsLeft } from '../reading-limits'

const S = AGENT_STRINGS.documents

/** A log of short lines, the kind of file the report names: 373 KB make more than 1500 passages. */
function logbook(bytes: number): string {
  const lines: string[] = []
  let size = 0
  for (let i = 0; size < bytes; i++) {
    const line = `Entry ${i}: the tide gauge at pier ${i % 9} read ${(i * 37) % 500} cm at ${String(i % 24).padStart(2, '0')}:00, wind from the north west at ${i % 12} knots, the harbour master noted nothing unusual on the quay and signed and stamped the page of the day before the next watch came on duty at the lower gate.`
    lines.push(line)
    size += line.length + 1
  }
  return lines.join('\n')
}

afterEach(() => {
  setMobileRagLimits(null)
  setDeviceOverride(null)
  __setBridgeForTests(undefined)
})

describe('how long one document may be', () => {
  it('follows the memory of the phone, in whole hundreds', () => {
    expect([2, 3, 4, 6, 8].map((ramGb) => maxPassagesFor({ ramGb }))).toEqual([2300, 3500, 4600, 7000, 9300])
  })

  it('never under the limit every phone had, never over what nobody has tried', () => {
    expect(maxPassagesFor({ ramGb: 1 })).toBe(MIN_PASSAGES)
    expect(maxPassagesFor({ ramGb: 16 })).toBe(MAX_PASSAGES)
    expect(maxPassagesFor({ ramGb: 24 })).toBe(MAX_PASSAGES)
    expect(MIN_PASSAGES).toBe(DEFAULT_MOBILE_RAG_LIMITS.maxChunks)
  })

  it('a device nobody could measure keeps the old limit', () => {
    expect(maxPassagesFor({ ramGb: 0 })).toBe(MIN_PASSAGES)
    expect(maxPassagesFor(null)).toBe(MIN_PASSAGES)
    expect(maxPassagesFor({ ramGb: Number.NaN })).toBe(MIN_PASSAGES)
  })

  it('what the limit lets in stays within the share of the memory', () => {
    for (const ramGb of [2, 3, 4, 6, 8, 12]) {
      const bytes = maxPassagesFor({ ramGb }) * PASSAGE_BYTES
      expect(bytes).toBeLessThanOrEqual(ramGb * 1024 ** 3 * DOCUMENT_RAM_SHARE)
    }
  })

  it('the file of the report: over the old limit, inside the limit of every phone from 2 GB up', () => {
    // The figure of the report, and a file of that size and kind cut by the real cutter.
    for (const passages of [1674, chunkText(logbook(373 * 1024)).length]) {
      expect(passages).toBeGreaterThan(DEFAULT_MOBILE_RAG_LIMITS.maxChunks)
      for (const ramGb of [2, 3, 4, 6, 8]) expect(passages).toBeLessThanOrEqual(maxPassagesFor({ ramGb }))
    }
  })

  it('the start hands the limit of this phone to the reading', async () => {
    expect(getMobileRagLimits().maxChunks).toBe(1500)
    setDeviceOverride({ platform: 'android', ramGb: 8 })
    await refreshModelSlotLimits()
    expect(getMobileRagLimits().maxChunks).toBe(9300)
    // The size limit of a file and the batches stay as they were.
    expect(getMobileRagLimits()).toMatchObject({ maxFileBytes: DEFAULT_MOBILE_RAG_LIMITS.maxFileBytes, batchSize: DEFAULT_MOBILE_RAG_LIMITS.batchSize })
    setDeviceOverride({ platform: 'android', ramGb: 3 })
    await refreshModelSlotLimits()
    expect(getMobileRagLimits().maxChunks).toBe(3500)
  })
})

describe('how long the reading still takes', () => {
  const first = { done: 16, at: 10_000 }

  it('says nothing before there is enough to go by', () => {
    expect(secondsLeft(null, { done: 16, at: 10_000 }, 1674)).toBeNull()
    expect(secondsLeft(first, first, 1674)).toBeNull()
    // Passages enough, time too short. Time enough, passages too few.
    expect(secondsLeft(first, { done: 16 + PACE_MIN_PASSAGES, at: 10_000 + PACE_MIN_MS - 1 }, 1674)).toBeNull()
    expect(secondsLeft(first, { done: 16 + PACE_MIN_PASSAGES - 1, at: 10_000 + PACE_MIN_MS }, 1674)).toBeNull()
  })

  it('then counts with the pace of this reading: 44 passages a second leave 30 seconds for 1320', () => {
    // 440 passages in 10 seconds after the first report.
    expect(secondsLeft(first, { done: 456, at: 20_000 }, 1776)).toBe(30)
  })

  it('a slow phone gets a long figure and not a short one: 4 a second leave 6 minutes for 1440', () => {
    const left = secondsLeft(first, { done: 56, at: 20_000 }, 1496)!
    expect(left).toBe(360)
    expect(S.timeLeft(left)).toBe('about 6 min left')
  })

  it('the wait before the first passage is not counted as reading', () => {
    // The first report came after 90 seconds of loading. Only what followed is the pace.
    const late = { done: 16, at: 90_000 }
    expect(secondsLeft(late, { done: 456, at: 100_000 }, 1776)).toBe(30)
  })

  it('nothing is left when it is done, and the words are plain', () => {
    expect(secondsLeft(first, { done: 1674, at: 60_000 }, 1674)).toBeNull()
    expect(secondsLeft(first, { done: 100, at: 60_000 }, 0)).toBeNull()
    expect(S.timeLeft(1)).toBe('about a minute or less left')
    expect(S.timeLeft(59)).toBe('about a minute or less left')
    expect(S.timeLeft(60)).toBe('about 1 min left')
    expect(S.timeLeft(61)).toBe('about 2 min left')
    expect(S.timeLeft(600)).not.toMatch(/[\u2013\u2014]/)
  })
})
