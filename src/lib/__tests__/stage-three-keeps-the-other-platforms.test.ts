/**
 * The Mac lane, 14.10.2026: stage 3 of the SignPath release merges the Windows
 * entries into latest.json hours after the Mac and Linux legs wrote theirs.
 * A merge that lost one of them would go unnoticed, so stage 3 checks that
 * every platform whose update files hang on the release is still named.
 *
 * Run: npx vitest run src/lib/__tests__/stage-three-keeps-the-other-platforms.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { missingOtherPlatforms } from '../../../scripts/windows-signpath.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const workflow = readFileSync(resolve(here, '../../../.github/workflows/windows-signpath.yml'), 'utf8')

const ASSETS_306 = [
  'LU_aarch64.app.tar.gz', 'LU_aarch64.app.tar.gz.sig', 'LU_3.0.6_aarch64.dmg',
  'Locally.Uncensored_3.0.6_amd64.AppImage', 'Locally.Uncensored_3.0.6_amd64.AppImage.sig',
  'Locally.Uncensored_3.0.6_x64-setup.exe', 'Locally.Uncensored_3.0.6_x64-setup.exe.sig', 'latest.json',
]
const entry = { signature: 's', url: 'u' }

describe('stage 3 and the entries of the other legs', () => {
  it('a latest.json that names Mac and Linux passes', () => {
    expect(missingOtherPlatforms({ platforms: { 'darwin-aarch64': entry, 'linux-x86_64': entry, 'windows-x86_64': entry } }, ASSETS_306)).toEqual([])
  })

  it('a lost Mac entry is named while its archive hangs on the release', () => {
    expect(missingOtherPlatforms({ platforms: { 'linux-x86_64': entry, 'windows-x86_64': entry } }, ASSETS_306)).toEqual(['darwin-aarch64'])
  })

  it('a platform without files on the release is not asked for', () => {
    const windowsOnly = ASSETS_306.filter((n) => n.includes('x64-setup'))
    expect(missingOtherPlatforms({ platforms: { 'windows-x86_64': entry } }, windowsOnly)).toEqual([])
  })

  it('the workflow runs the check after the merge and merges again when it fails', () => {
    const check = workflow.indexOf('check-other-platforms')
    expect(check).toBeGreaterThan(workflow.indexOf('merge-latest-json'))
    expect(workflow.slice(check, check + 400)).toContain('continue')
    expect(workflow).toContain("--json assets --jq '.assets[].name'")
  })
})
