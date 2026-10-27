/**
 * Review N9: the clock of a Create run ticks only while a run has a start
 * time. Its neighbours (useClock, TasksPage, CharactersPage) had the
 * condition, CreatePage set an interval without one and drew itself again
 * every second.
 *
 * Run: npx vitest run src/mobile/screens/create/__tests__/run-clock.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../CreatePage.tsx'), 'utf8')

describe('the clock of a Create run', () => {
  it('every interval of the page sits behind a condition and is cleared', () => {
    const intervals = [...page.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n {2}\}, \[([^\]]*)\]\)/g)].filter((m) => m[1].includes('setInterval'))
    expect(intervals.length).toBeGreaterThan(0)
    for (const [, body, deps] of intervals) {
      const before = body.slice(0, body.indexOf('setInterval'))
      expect(before, body).toMatch(/if \(![a-zA-Z.]+\) return/)
      expect(body).toMatch(/return \(\) => window\.clearInterval\(timer\)/)
      expect(deps.trim(), 'an effect with a condition depends on it').not.toBe('')
    }
  })

  it('the clock depends on the start time of the run', () => {
    expect(page).toMatch(/const startedAt = run\.startedAt\s+useEffect\(\(\) => \{\s+if \(!startedAt\) return/)
    expect(page).toMatch(/\}, \[startedAt\]\)/)
  })
})
