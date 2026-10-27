/**
 * One way into src/mobile: the dynamic import in src/main.tsx.
 *
 * The desktop bundle must not grow by the mobile shell. That holds only while
 * no desktop file imports from src/mobile, neither statically nor lazily.
 * A second door would also mean a second place that decides "this is a phone".
 */
import { describe, expect, it } from 'vitest'
import { SRC_DIR, importsOf, sourceFiles } from './scan'

describe('one way into src/mobile', () => {
  const desktop = sourceFiles(SRC_DIR, ['.ts', '.tsx']).filter((f) => !f.rel.startsWith('mobile/'))

  it('finds the desktop sources', () => {
    expect(desktop.length).toBeGreaterThan(200)
    expect(desktop.some((f) => f.rel === 'main.tsx')).toBe(true)
  })

  it('only main.tsx imports from src/mobile, once and dynamically', () => {
    const hits: string[] = []
    for (const file of desktop) {
      for (const hit of importsOf(file)) {
        const target = hit.target
        const intoMobile = (target !== null && (target === 'mobile' || target.startsWith('mobile/'))) || /^@\/mobile(\/|$)/.test(hit.spec) || /^src\/mobile(\/|$)/.test(hit.spec)
        if (intoMobile) hits.push(`${file.rel} ${hit.dynamic ? 'dynamic' : 'static'} ${hit.spec}`)
      }
    }
    expect(hits).toEqual(['main.tsx dynamic ./mobile/boot'])
  })
})
