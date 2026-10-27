/**
 * The time a download still takes is said once it is known (acceptance iPhone, second part, P6).
 *
 * Seen on the phone: "4% Downloading, 249.4 KB/s, about 25 min left" six seconds into a download of 397 MB that
 * was done after 32 seconds, and "about 0s left" at 94 percent.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { ETA_AFTER_MS, ETA_FROM_SECONDS, __resetPaceForTests, measuredPace, remainingSeconds } from '../parts/pace'
import { paceText } from '../parts/download-state'
import type { DownloadProgress } from '../../../../types/downloads'

const MB = 1024 * 1024
const TOTAL = 397 * MB
const row = (over: Partial<DownloadProgress>): DownloadProgress => ({ progress: 0, total: TOTAL, speed: 0, filename: 'Qwen3-0.6B-Q4_K_M.gguf', status: 'downloading', ...over })

beforeEach(() => __resetPaceForTests())

describe('remainingSeconds', () => {
  it('says nothing in the first five seconds, however far the bar is', () => {
    expect(remainingSeconds({ at: 0, bytes: 0 }, { at: ETA_AFTER_MS - 1, bytes: 100 * MB }, TOTAL)).toBeNull()
  })

  it('says nothing before two percent of the file arrived while it was watched', () => {
    expect(remainingSeconds({ at: 0, bytes: 0 }, { at: 8000, bytes: 5 * MB }, TOTAL)).toBeNull()
  })

  it('counts from what arrived since the row was first seen', () => {
    // 14 MB in 6 s: 2.33 MB/s, 383 MB to go, about 164 s. The phone said 25 minutes.
    const left = remainingSeconds({ at: 0, bytes: 0 }, { at: 6000, bytes: 14 * MB }, TOTAL)
    expect(left).not.toBeNull()
    expect(left!).toBeGreaterThan(150)
    expect(left!).toBeLessThan(180)
  })

  it('a download that was going on when the page opened is measured from there, not from zero', () => {
    const left = remainingSeconds({ at: 0, bytes: 200 * MB }, { at: 10000, bytes: 220 * MB }, TOTAL)
    // 2 MB/s, 177 MB to go.
    expect(Math.round(left!)).toBe(89)
  })

  it('says nothing for the last seconds, and nothing without a total or when nothing moved', () => {
    expect(remainingSeconds({ at: 0, bytes: 0 }, { at: 30000, bytes: TOTAL - 2 * MB }, TOTAL)).toBeNull()
    expect(ETA_FROM_SECONDS).toBe(5)
    expect(remainingSeconds({ at: 0, bytes: 0 }, { at: 30000, bytes: 100 * MB }, 0)).toBeNull()
    expect(remainingSeconds({ at: 0, bytes: 50 * MB }, { at: 30000, bytes: 50 * MB }, TOTAL)).toBeNull()
    expect(remainingSeconds({ at: 0, bytes: 0 }, { at: 30000, bytes: TOTAL }, TOTAL)).toBeNull()
  })
})

describe('the line of a download, with the sequence from the phone', () => {
  const line = (bytes: number, at: number, speed: number) => {
    const r = row({ progress: bytes, speed })
    return paceText(r, undefined, measuredPace(r.filename, true, bytes, TOTAL, at))
  }

  it('names the rate alone at first, then a time that fits how the download ends', () => {
    expect(line(1 * MB, 0, 249.4 * 1024)).toBe('249.4 KB/s')
    expect(line(8 * MB, 3000, 249.4 * 1024)).toBe('249.4 KB/s')
    // Six seconds in, 14 MB: the old line said "about 25 min left" here.
    const six = line(14 * MB, 6000, 249.4 * 1024)
    expect(six).not.toContain('25 min')
    expect(six).toMatch(/^249\.4 KB\/s, about [23] min left$/)
    const later = line(200 * MB, 16000, 12 * MB)
    expect(later).toMatch(/, about \d+s left$/)
    // 94 percent: the bar says it, the line does not say "about 0s left".
    expect(line(TOTAL - 4 * MB, 31000, 12 * MB)).not.toContain('left')
  })

  it('a paused download measures anew when it goes on', () => {
    line(0, 0, MB)
    expect(line(100 * MB, 20000, MB)).toContain('left')
    expect(measuredPace('Qwen3-0.6B-Q4_K_M.gguf', false, 100 * MB, TOTAL, 21000)).toBeNull()
    expect(line(100 * MB, 600000, MB)).toBe('1.0 MB/s')
    expect(line(101 * MB, 602000, MB)).toBe('1.0 MB/s')
  })

  it('a row that is not moving has no line, and without a measurement the line has no time', () => {
    expect(paceText(row({ status: 'paused', speed: MB, progress: 10 * MB }), undefined, 120)).toBe('')
    expect(paceText(row({ speed: MB, progress: 10 * MB }))).toBe('1.0 MB/s')
    expect(paceText(row({ speed: MB, progress: 10 * MB }), undefined, null)).toBe('1.0 MB/s')
  })
})
