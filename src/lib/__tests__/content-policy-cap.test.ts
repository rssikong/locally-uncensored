/**
 * durchsicht-mobile M6: a build that must not offer "Off" does not only hide
 * the choice. An account set to Off on the website is still filtered in such
 * a build: the Create check runs with the capped level, and every cloud job
 * carries the cap.
 *
 * Run: npx vitest run src/lib/__tests__/content-policy-cap.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const client = vi.hoisted(() => ({ cloudFetch: vi.fn() }))
vi.mock('../../api/cloud/client', async (orig) => ({ ...((await orig()) as object), cloudFetch: client.cloudFetch }))

import { submitCloudJob } from '../../api/cloud/jobs'
import { contentPolicyCap, effectiveContentPolicy, installContentPolicyCap, stricterPolicy } from '../content-policy-cap'
import { checkPromptSafety } from '../render/safety'
import { STORE_PRESETS, contentPolicyCapFor } from '../../mobile/policy/storePolicy'

const read = (path: string) => readFileSync(resolve(__dirname, '../..', path), 'utf8')
let uninstall: (() => void) | null = null

beforeEach(() => {
  client.cloudFetch.mockReset()
  client.cloudFetch.mockResolvedValue(new Response(JSON.stringify({ id: 'job-1', quota: { cost: 1 } }), { status: 200 }))
})
afterEach(() => {
  uninstall?.()
  uninstall = null
})

describe('the cap of a build', () => {
  it('the open build has none, a build without "Off" and one with a fixed filter stop at Standard', () => {
    expect(contentPolicyCapFor(STORE_PRESETS.open.contentLevels)).toBeNull()
    expect(contentPolicyCapFor(STORE_PRESETS.play.contentLevels)).toBe('soft')
    expect(contentPolicyCapFor(STORE_PRESETS.appstore.contentLevels)).toBe('soft')
  })

  it('the stricter of account and cap wins, and an unknown account level is the cap, never Off', () => {
    expect(stricterPolicy('off', 'soft')).toBe('soft')
    expect(stricterPolicy('strict', 'soft')).toBe('strict')
    uninstall = installContentPolicyCap(() => 'soft')
    expect(effectiveContentPolicy('off')).toBe('soft')
    expect(effectiveContentPolicy('soft')).toBe('soft')
    expect(effectiveContentPolicy('strict')).toBe('strict')
    expect(effectiveContentPolicy(null)).toBe('soft')
  })

  it('DESKTOP UNCHANGED: without a cap the account level comes back as it is, null included', () => {
    expect(contentPolicyCap()).toBeNull()
    expect(effectiveContentPolicy('off')).toBe('off')
    expect(effectiveContentPolicy(null)).toBeNull()
  })

  it('a stored Off has no effect: the prompt an Off account could send is refused under the cap', () => {
    uninstall = installContentPolicyCap(() => 'soft')
    const prompt = 'hardcore porn scene'
    expect(checkPromptSafety(prompt, { tier: 'cloud', policy: 'off' }).blocked).toBe(false)
    expect(checkPromptSafety(prompt, { tier: 'cloud', policy: effectiveContentPolicy('off') ?? 'off' }).blocked).toBe(true)
    // The Create hook asks exactly this.
    const hook = read('hooks/useCloudCreate.ts')
    expect(hook).toMatch(/const policy = effectiveContentPolicy\(account\)/)
    expect(hook).not.toMatch(/policy: contentPolicySnapshot\(\) \?\? 'off'/)
  })

  it('the phone shell installs the cap of its preset at boot', () => {
    expect(read('mobile/boot/index.tsx')).toMatch(/installContentPolicyCap\(\(\) => contentPolicyCapFor\(storePolicy\(\)\.contentLevels\)\)/)
  })
})

describe('every cloud job carries the cap', () => {
  const sent = () => JSON.parse(String((client.cloudFetch.mock.calls[0][1] as { body: string }).body)) as { params: Record<string, unknown> }

  it('as a number, so it is never part of the text the server judges, and a caller cannot loosen it', async () => {
    uninstall = installContentPolicyCap(() => 'soft')
    await submitCloudJob({ kind: 'image', model: 'm', prompt: 'a lighthouse', params: { op: 'generate', content_policy_cap: 2 } as never })
    expect(sent().params.content_policy_cap).toBe(1)
    expect(typeof sent().params.content_policy_cap).toBe('number')
  })

  it('DESKTOP UNCHANGED: without a cap the field is not sent', async () => {
    await submitCloudJob({ kind: 'image', model: 'm', prompt: 'a lighthouse', params: { op: 'generate' } })
    expect('content_policy_cap' in sent().params).toBe(false)
  })
})
