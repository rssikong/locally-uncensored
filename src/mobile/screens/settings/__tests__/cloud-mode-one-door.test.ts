/**
 * One door into and out of Cloud.
 *
 * The anonymous counter (and its opt out), the question "Switch to Cloud?"
 * and the consent to send content all hang on `enterCloud` and `leaveCloud`
 * in parts/cloud-mode.ts. A screen that writes `appMode` itself skips all
 * three. This test reads the phone shell and names every file that does.
 *
 * KNOWN lists the ones that still do, each owned by another strand. It may
 * only shrink: a new file fails at once, and a file that was fixed should be
 * taken off the list by whoever fixed it (the test does not insist, so the
 * strands can land in any order).
 *
 * Run: npx vitest run src/mobile/screens/settings/__tests__/cloud-mode-one-door.test.ts
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const MOBILE = join(HERE, '../../..')

const THE_DOOR = 'screens/settings/parts/cloud-mode.ts'

/** Files of other strands that still switch the mode themselves. See mobile-docs/r2/settings.md, "Cloud mode". */
const KNOWN: string[] = []

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      sources(full, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const WRITES_MODE = /appMode\s*:\s*['"](cloud|local)['"]/
const COUNTS_ITSELF = /\breportCloudSwitch(Anonymous|ForAccount)?\s*\(/

function filesMatching(pattern: RegExp): string[] {
  return sources(MOBILE)
    .filter((file) => pattern.test(readFileSync(file, 'utf8')))
    .map((file) => relative(MOBILE, file).split('\\').join('/'))
    .sort()
}

describe('one door into and out of Cloud', () => {
  it('no screen writes the mode itself, apart from the known ones', () => {
    const found = filesMatching(WRITES_MODE).filter((file) => file !== THE_DOOR)
    const fresh = found.filter((file) => !KNOWN.includes(file))
    expect(fresh, 'call enterCloud or leaveCloud from screens/settings/parts/cloud-mode.ts instead').toEqual([])
  })

  it('the sheets of this strand go through the door', () => {
    const found = filesMatching(WRITES_MODE)
    expect(found).toContain(THE_DOOR)
    expect(found).not.toContain('resilience/SessionSheet.tsx')
    expect(found).not.toContain('resilience/CreditsSheet.tsx')
  })

  it('nothing in the phone shell calls the counter past its opt out', () => {
    expect(filesMatching(COUNTS_ITSELF)).toEqual([])
  })
})
