/**
 * Two locks of the build lanes, held as text.
 *
 * 1. The signing probe is started by hand and takes the name of the signing
 *    policy as free input. A policy other than the test policy asks for a
 *    certificate Windows trusts, which SignPath issues for release tags only,
 *    so the probe refuses it outright, before anything is checked out or
 *    built.
 * 2. The Windows lanes download an SDK installer and run it. Every lane that
 *    does checks the file against one pinned sha256 first.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const read = (file: string) => readFileSync(resolve(root, file), 'utf8')

/** The steps of a workflow, each from its `- name:` line to the next. */
function steps(text: string): string[] {
  return text.split(/\n(?= {6}- name: )/).slice(1)
}

describe('signpath-probe.yml', () => {
  const probe = read('.github/workflows/signpath-probe.yml')
  const all = steps(probe)

  it('refuses every policy but the test policy, as its first step', () => {
    const first = all[0]
    expect(first).toContain("if: ${{ inputs.signing-policy-slug != 'test-signing' }}")
    expect(first).toMatch(/^\s*exit 1\s*$/m)
    expect(first).not.toMatch(/continue-on-error/)
    // Nothing runs before it: no checkout, no secret.
    expect(first).not.toMatch(/uses:|secrets\./)
    // Its job is the one every other job waits for.
    const jobs = probe.slice(probe.indexOf('\njobs:\n'))
    expect(jobs).toMatch(/^jobs:\n {2}[^\n]*\n {2}lock:\n/m)
    for (const job of ['build', 'installers', 'finish']) {
      expect(jobs, job).toMatch(new RegExp(`^ {2}${job}:\\n {4}needs: lock$`, 'm'))
    }
  })

  it('keeps the test policy as the default input', () => {
    expect(probe).toMatch(/signing-policy-slug:\n(?: {8}.*\n)*? {8}default: 'test-signing'/)
  })
})

describe('the Vulkan SDK installer of the Windows lanes', () => {
  const lanes = ['.github/workflows/release.yml', '.github/workflows/sidecar-windows.yml', '.github/workflows/signpath-probe.yml']
  const pinOf = (text: string) => text.match(/^ {2}VULKAN_SDK_SHA256: '([0-9a-f]{64})'$/m)?.[1]
  const versionOf = (text: string) => text.match(/^ {2}VULKAN_SDK_VERSION: '([\d.]+)'$/m)?.[1]

  it('has one version and one sha256 in all three lanes', () => {
    const pins = lanes.map((lane) => pinOf(read(lane)))
    const versions = lanes.map((lane) => versionOf(read(lane)))
    expect(pins[0]).toMatch(/^[0-9a-f]{64}$/)
    expect(new Set(pins).size).toBe(1)
    expect(versions[0]).toBeTruthy()
    expect(new Set(versions).size).toBe(1)
  })

  it.each(lanes)('%s checks the file before it runs it', (lane) => {
    const install = steps(read(lane)).filter((step) => step.includes('VulkanSDK-Installer.exe'))
    expect(install).toHaveLength(1)
    const step = install[0]
    const download = step.indexOf('curl.exe')
    const hash = step.indexOf('Get-FileHash -Algorithm SHA256')
    const compare = step.indexOf('if ($got -ne $env:VULKAN_SDK_SHA256) { throw')
    const run = step.indexOf('& "$env:RUNNER_TEMP\\VulkanSDK-Installer.exe"')
    expect(download).toBeGreaterThan(0)
    expect(hash).toBeGreaterThan(download)
    expect(compare).toBeGreaterThan(hash)
    expect(run).toBeGreaterThan(compare)
  })
})
