/**
 * What SignPath asked of the release build on 2026-10-14, held in place.
 *
 * - Production signing comes from a run on a release tag, and the signing
 *   policy names the pattern (refs/tags/v<major>.<minor>.<patch>). A run started
 *   by hand from a branch must stop before it builds, and never fall back to
 *   unsigned installers.
 * - A cache may restore dependencies, never a finished binary. The sidecar
 *   cache holds a built llama-server.exe, so the signed Windows leg runs
 *   without it.
 * - Build and signing are separate: the run on the tag submits the app
 *   binary and ends; every later stage (windows-signpath.yml) runs on the
 *   same tag and refuses any other ref before it checks anything out.
 *
 * Run: npx vitest run src/lib/__tests__/signpath-signs-a-release-tag-only.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const release = readFileSync(resolve(here, '../../../.github/workflows/release.yml'), 'utf8')
const stages = readFileSync(resolve(here, '../../../.github/workflows/windows-signpath.yml'), 'utf8')

/** The lines of one step, from its `- name:` to the next one. */
function step(name: string): string {
  const start = release.indexOf(`- name: ${name}\n`)
  expect(start, `step "${name}" in release.yml`).toBeGreaterThan(-1)
  const next = release.indexOf('\n      - name: ', start + 1)
  return release.slice(start, next === -1 ? undefined : next)
}

const TAG = /\^refs\/tags\/v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/

describe('SignPath in release.yml', () => {
  it('a run that is not on a release tag stops before the SignPath build', () => {
    const guard = step('SignPath signs a release tag only')
    expect(guard).toMatch(TAG)
    expect(guard).toContain('exit 1')
    expect(guard).toContain("steps.signcfg.outputs.signpath == 'true'")
    expect(release.indexOf('- name: SignPath signs a release tag only'))
      .toBeLessThan(release.indexOf('- name: Build the app and submit it to SignPath (stage 1)'))
  })

  it('the SignPath build itself also asks for a tag ref, and names the chain after the tag', () => {
    const stage1 = step('Build the app and submit it to SignPath (stage 1)')
    expect(stage1).toContain("startsWith(github.ref, 'refs/tags/v')")
    expect(stage1).toContain('label: ${{ github.ref_name }}')
  })

  it('every later stage refuses a run that is not on a release tag, as its first step', () => {
    for (const job of ['app', 'installers', 'publish']) {
      const block = stages.slice(stages.indexOf(`\n  ${job}:\n`) + 1)
      const body = block.slice(0, block.search(/\n {2}[a-z][a-z-]*:\n/) === -1 ? undefined : block.search(/\n {2}[a-z][a-z-]*:\n/))
      const first = body.split(/\n(?= {6}- name: )/)[1]
      expect(first, job).toContain('- name: SignPath signs a release tag only')
      expect(first, job).toMatch(TAG)
      expect(first, job).toContain('exit 1')
      expect(first, job).not.toMatch(/uses:|secrets\./)
    }
  })

  it('the watcher starts stages on release tags only', () => {
    const script = readFileSync(resolve(here, '../../../scripts/signpath-stages.mjs'), 'utf8')
    expect(script).toContain('if (!releaseTagOf(`refs/tags/${label}`)) fail(')
    expect(script).toContain('await gh.dispatch(workflow, `refs/tags/${label}`, { stage: next.stage })')
  })

  it('the tag pattern matches release tags and nothing else', () => {
    const pattern = new RegExp(String.raw`^refs/tags/v[0-9]+\.[0-9]+\.[0-9]+$`)
    for (const ok of ['refs/tags/v3.0.7', 'refs/tags/v10.12.0']) expect(pattern.test(ok)).toBe(true)
    for (const no of ['refs/heads/master', 'refs/tags/v3.0.7-rc1', 'refs/tags/detail/3.0.6', 'refs/tags/v3.0', 'refs/pull/1/merge']) {
      expect(pattern.test(no), no).toBe(false)
    }
  })

  it('the signed Windows leg restores no built sidecar from the cache', () => {
    const cache = step('Sidecar build cache')
    expect(cache).toContain("if: ${{ !(matrix.platform == 'windows-latest' && vars.SIGNPATH_SIGNING_POLICY_SLUG != '' && !inputs.dry_run) }}")
  })

  it('without SignPath every leg keeps its cache, and the unsigned lane is unchanged', () => {
    expect(step('Build and release Tauri app')).toContain("steps.signcfg.outputs.signpath != 'true'")
  })
})
