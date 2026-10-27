/**
 * window.__LU_TEST__ belongs to the acceptance build and to nothing else.
 *
 * A store build must not carry the object. The source is read here: the hook
 * lives in one file, and the only way to that file is the dynamic import in
 * boot/index.tsx behind the build constant VITE_LU_ABNAHME. Vite replaces the
 * constant when it builds, the branch is dropped, and with it the file. The
 * built bundle is checked once more by the measuring run
 * (`npx vite build`, then a search for the name in dist/).
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOBILE_DIR, sourceFiles, stripComments } from './scan'

const files = sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])
  .filter((f) => !f.rel.includes('__tests__'))
  .map((f) => ({ rel: f.rel, code: stripComments(f.text) }))

describe('the hook of the acceptance build', () => {
  it('the name stands in dev/test-hook.ts and in no other source of the shell', () => {
    expect(files.filter((f) => f.code.includes('__LU_TEST__')).map((f) => f.rel)).toEqual(['mobile/dev/test-hook.ts'])
  })

  it('only the boot loads the file, lazily, and only behind the build constant', () => {
    const importers = files.filter((f) => /dev\/test-hook['"]/.test(f.code)).map((f) => f.rel)
    expect(importers).toEqual(['mobile/boot/index.tsx'])
    const boot = files.find((f) => f.rel === 'mobile/boot/index.tsx')!.code
    expect(boot).not.toMatch(/^import[^\n]*dev\/test-hook/m)
    const at = boot.indexOf("import('../dev/test-hook')")
    expect(at).toBeGreaterThan(0)
    const gate = boot.lastIndexOf("if (import.meta.env.VITE_LU_ABNAHME === '1') {", at)
    expect(gate).toBeGreaterThan(0)
    // Nothing closes the branch between the gate and the import.
    expect(boot.slice(gate, at)).not.toMatch(/^\s*\}/m)
  })

  it('the constant is read in three places only, so nothing else can depend on an acceptance build', () => {
    // boot/index.tsx installs the hook. platform/detect.ts closes the developer pages in a store
    // build (review N11): they open on the developer server and in an acceptance build, nowhere else.
    // policy/storePolicy.ts lets the hook show another store preset, in those two builds and in no other.
    expect(files.filter((f) => f.code.includes('VITE_LU_ABNAHME')).map((f) => f.rel).sort()).toEqual(['mobile/boot/index.tsx', 'mobile/platform/detect.ts', 'mobile/policy/storePolicy.ts'])
    const policy = files.find((f) => f.rel === 'mobile/policy/storePolicy.ts')!.code
    expect(policy.match(/VITE_LU_ABNAHME/g)?.length).toBe(1)
    expect(policy).toContain("return import.meta.env.DEV === true || import.meta.env.VITE_LU_ABNAHME === '1'")
    const detect = files.find((f) => f.rel === 'mobile/platform/detect.ts')!.code
    expect(detect.match(/VITE_LU_ABNAHME/g)?.length).toBe(1)
    expect(detect).toContain("return import.meta.env.DEV === true || import.meta.env.VITE_LU_ABNAHME === '1'")
  })

  it('no desktop source knows the hook', () => {
    const src = path.resolve(MOBILE_DIR, '..')
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (full === MOBILE_DIR || entry.name === '__tests__' || entry.name === 'node_modules') continue
          walk(full)
        } else if (/\.(ts|tsx)$/.test(entry.name) && fs.readFileSync(full, 'utf8').includes('__LU_TEST__')) {
          hits.push(path.relative(src, full))
        }
      }
    }
    walk(src)
    expect(hits).toEqual([])
  })
})
