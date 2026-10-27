/**
 * Acceptance row L2.4: a speed or a fit that LU did not measure on this phone
 * is an estimate, and the text says so.
 *
 * Two kinds of statement are shown:
 *
 *   worked out   how well a model fits, how much memory it needs, how long
 *                something still takes. From sizes and a pace, not measured
 *                with this model on this phone. Carries a word that marks it:
 *                about, should, may, likely, usually, can, estimate.
 *   measured     tokens per second of an answer that was just written here,
 *                of the benchmark and of the self test, the rate of a
 *                download. A number from this phone, shown as it is.
 *
 * This test holds the first kind over the texts themselves, and holds that
 * "tokens per second" appears only where a measurement is shown.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENT_STRINGS } from '../strings/agent'
import { CREATE_STRINGS } from '../strings/create'
import { MODELS_STRINGS } from '../strings/models'
import { FIT_TEXT } from '../ui/FitBadge'

/** A word that tells the reader this is worked out, not measured. */
const MARK = /\b(about|should|may|likely|usually|can|estimate|estimated)\b/i
const DASH = /[–—]/

const fit = MODELS_STRINGS.fit as Record<string, unknown>

/**
 * Entries of the group `fit` that say nothing about pace or need, each with the reason.
 * Anything else in the group has to carry a mark, also an entry that is added later.
 */
const NO_ESTIMATE: Record<string, string> = {
  tooLarge: 'the rule LU acts on: it does not download such a file. The sentence next to it gives the numbers with "about"',
  unknown: 'says that nothing is known',
  unknownDevice: 'says that nothing is known',
  unknownLong: 'says that nothing is known yet',
  unknownDeviceLong: 'says that LU cannot say how well the model runs',
  tooSmallDevice: 'a fact about the phone, no model is judged',
  tightTitle: 'a heading, the text under it carries the mark',
  coarseTitle: 'carries "may"; listed so the reason is written down',
  tightConfirm: 'the label of the download button',
}

const said = (value: unknown): string => (typeof value === 'function' ? String((value as (...a: string[]) => unknown)('1.9 GB', '3.2 GB', '6 GB', '1.1 GB')) : String(value))

describe('L2.4: what is worked out says so', () => {
  it('every sentence about the fit of a model carries a mark, also one that is added later', () => {
    const unmarked: string[] = []
    for (const [key, value] of Object.entries(fit)) {
      if (key in NO_ESTIMATE && key !== 'coarseTitle') continue
      const text = said(value)
      if (!MARK.test(text)) unmarked.push(`${key}: ${text}`)
      expect(text, key).not.toMatch(DASH)
    }
    expect(unmarked).toEqual([])
  })

  it('the exceptions exist and are not stale', () => {
    for (const key of Object.keys(NO_ESTIMATE)) expect(fit, key).toHaveProperty(key)
  })

  it('"runs well" is never said as a fact', () => {
    expect(MODELS_STRINGS.fit.fits).toBe('Should run well on this phone')
    // The kit carries its own copy of the four words. It must not fall behind.
    expect(FIT_TEXT.fits).toBe(MODELS_STRINGS.fit.fits)
    expect(FIT_TEXT.tight).toBe(MODELS_STRINGS.fit.tight)
    expect(FIT_TEXT['too-large']).toBe(MODELS_STRINGS.fit.tooLarge)
    expect(MODELS_STRINGS.fit.fitsLong('1 GB', '3 GB')).toMatch(/estimate/)
    expect(MODELS_STRINGS.fit.fitsLong('1 GB', '3 GB')).toMatch(/not a measurement on this phone/)
    for (const value of Object.values(fit)) expect(said(value)).not.toMatch(/\bruns well\b/i)
  })

  it('memory a model needs and memory the phone can give are "about"', () => {
    const M = MODELS_STRINGS as unknown as Record<string, Record<string, (...a: string[]) => string>>
    expect(MODELS_STRINGS.device.line('6 GB', '3.2 GB', '20 GB')).toMatch(/about 3\.2 GB usable/)
    expect(MODELS_STRINGS.device.lineNoStorage('6 GB', '3.2 GB')).toMatch(/about 3\.2 GB usable/)
    const memoryValue = Object.values(M).map((group) => group.memoryValue).find((fn) => typeof fn === 'function')
    expect(memoryValue?.('1.9 GB')).toBe('About 1.9 GB')
  })

  it('time that is left is "about": a download, the reading of a document, a render in the cloud', () => {
    const M = MODELS_STRINGS as unknown as Record<string, Record<string, (...a: string[]) => string>>
    const eta = Object.values(M).map((group) => group.eta).find((fn) => typeof fn === 'function')
    expect(eta?.('4 min')).toBe('about 4 min left')
    const A = AGENT_STRINGS as unknown as Record<string, Record<string, (n: number) => string>>
    const timeLeft = Object.values(A).map((group) => group.timeLeft).find((fn) => typeof fn === 'function')
    expect(timeLeft).toBeTypeOf('function')
    for (const seconds of [1, 30, 59, 60, 61, 600, 7200]) expect(timeLeft!(seconds), String(seconds)).toMatch(MARK)
    expect(CREATE_STRINGS.usually(CREATE_STRINGS.usuallyTime(40))).toMatch(MARK)
  })
})

describe('L2.4: a speed is shown only where it was measured', () => {
  // Every key that says "tokens per second", with where its number comes from.
  const MEASURED: Record<string, string> = {
    'models.ts speed': 'result of the benchmark on this phone',
    'models.ts testLine': 'one question of the benchmark on this phone',
    'models.ts selfTestOk': 'the self test that just ran',
    'settings.ts speedValue': 'the last self test, on the diagnostics page',
    'settings.ts selfTestPassedGpu': 'the self test that just ran',
    'settings.ts selfTestPassedCpu': 'the self test that just ran',
    'settings.ts selfTestPassedCpuFallback': 'the self test that just ran',
    'chat.ts speed': 'the answer that was just written',
  }

  it('no text promises tokens per second outside the measured places', () => {
    const dir = resolve(__dirname, '../strings')
    const found: string[] = []
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts'))) {
      const lines = readFileSync(resolve(dir, file), 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!/tokens? per second|tok\/s|tokens\/s/i.test(line) || /^\s*(\/\/|\*|\/\*)/.test(line)) return
        // The key is on the line itself, or on the line above when the value wraps.
        const key = (line.match(/^\s*([A-Za-z0-9_]+)\s*:/) ?? lines[i - 1]?.match(/^\s*([A-Za-z0-9_]+)\s*:/))?.[1] ?? `line ${i + 1}`
        found.push(`${file} ${key}`)
      })
    }
    expect(found.length).toBeGreaterThan(0)
    expect(found.filter((entry) => !(entry in MEASURED))).toEqual([])
  })
})
