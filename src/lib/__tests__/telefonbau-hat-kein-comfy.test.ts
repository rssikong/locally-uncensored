/**
 * A phone build never has a ComfyUI, also when it runs in a desktop browser.
 *
 * The Playwright project mobile serves the phone build to desktop Chrome at
 * phone size. On a Mac that browser said "Mac" and the ComfyUI probe stayed
 * off; on the Linux CI runner it said "Linux", the model list asked
 * /comfyui/system_stats, the proxy answered 502, and every mobile spec that
 * counts console errors went red (3.0.8 release run, 183 tests).
 *
 * Run: npx vitest run src/lib/__tests__/telefonbau-hat-kein-comfy.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.resetModules()
})

async function capabilities() {
  vi.resetModules()
  return import('../capabilities')
}

describe('hasComfy in a phone build', () => {
  it('a phone build in a Linux desktop browser asks no ComfyUI', async () => {
    vi.stubEnv('VITE_LU_BUILD_TARGET', 'mobile')
    standOn('linux')
    const { hasComfy } = await capabilities()
    expect(hasComfy()).toBe(false)
  })

  it('COUNTER-CHECK: the desktop build on Linux still has ComfyUI', async () => {
    standOn('linux')
    const { hasComfy } = await capabilities()
    expect(hasComfy()).toBe(true)
  })
})
