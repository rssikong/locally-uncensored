/**
 * durchsicht-mobile M2: the counter of the Cloud switch on the phone is
 * anonymous. The Privacy page says "No account, no content", so no press may
 * go out with the session of a signed-in user.
 *
 * Run: npx vitest run src/api/__tests__/mobile-switch-counter-anonymous.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const mocks = vi.hoisted(() => ({
  backendCall: vi.fn(async () => undefined),
  cloudFetch: vi.fn(async () => new Response('{}')),
}))
vi.mock('../backend', async (orig) => ({ ...((await orig()) as object), backendCall: mocks.backendCall }))
vi.mock('../cloud/client', async (orig) => ({ ...((await orig()) as object), cloudFetch: mocks.cloudFetch }))
vi.mock('../../lib/mobile-prefs', () => ({ cloudSwitchCounterAllowed: () => true }))

import { countCloudSwitch } from '../cloud/switch-counter'
import { reportCloudSwitch } from '../funnel'
import { SETTINGS_STRINGS } from '../../mobile/strings/settings'

beforeEach(() => {
  mocks.backendCall.mockClear()
  mocks.cloudFetch.mockClear()
})

describe('the counter of the Cloud switch', () => {
  it('phone: only the anonymous ping, never a request with the session', () => {
    for (const action of ['open-gate', 'arm', 'enter-cloud', 'leave-cloud'] as const) countCloudSwitch(action)
    expect(mocks.backendCall).toHaveBeenCalledTimes(4)
    expect(mocks.backendCall).toHaveBeenCalledWith('funnel_ping', { event: 'cloud_switch_enter' })
    for (const call of mocks.backendCall.mock.calls as unknown as [string, Record<string, unknown>][]) expect(Object.keys(call[1])).toEqual(['event'])
    expect(mocks.cloudFetch).not.toHaveBeenCalled()
  })

  it('DESKTOP UNCHANGED: reportCloudSwitch still counts per account as well', () => {
    reportCloudSwitch('enter-cloud')
    expect(mocks.backendCall).toHaveBeenCalledTimes(1)
    expect(mocks.cloudFetch).toHaveBeenCalledWith('/api/funnel/switch', expect.objectContaining({ method: 'POST' }))
  })

  it('nothing under src/mobile counts around the anonymous counter', () => {
    const counter = readFileSync(resolve(__dirname, '../cloud/switch-counter.ts'), 'utf8')
    expect(counter).not.toMatch(/reportCloudSwitch\(|reportCloudSwitchForAccount/)
    expect(SETTINGS_STRINGS.privacy.counter).toContain('No account, no content')
  })
})
