/**
 * The Cloud switch (G11): off to on asks, on to off never asks, an account
 * that cannot use Cloud lands on the gate, and the anonymous counter obeys
 * the switch under Privacy.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The opt out is read from storage by the counter itself. Give the test a storage, so the switch under Privacy
// travels the same way as on a phone: store, storage, counter.
vi.hoisted(() => {
  const mem = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  }
})

const h = vi.hoisted(() => ({
  confirm: vi.fn(async (_spec: unknown) => true),
  push: vi.fn((_route: string) => {}),
  toast: vi.fn((_text: string, _options?: unknown) => {}),
  report: vi.fn((_action: string) => {}),
  haptic: vi.fn((_kind: string) => {}),
  consent: vi.fn(async () => true),
}))

vi.mock('../../../nav', () => ({ nav: { confirm: h.confirm, push: h.push } }))
vi.mock('../../../ui', () => ({ toast: h.toast }))
vi.mock('../../../platform', () => ({ haptic: h.haptic }))
vi.mock('../parts/policy', () => ({ ensureAiConsent: h.consent }))
vi.mock('../../../../api/funnel', () => ({ reportCloudSwitchAnonymous: h.report }))

import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { cloudIsOn, enterCloud, leaveCloud, toggleCloud } from '../parts/cloud-mode'
import { useMobilePrefs } from '../parts/prefs'

const QUOTA = { tier: 'hosted', period: '2026-10', limits: { credits: 1000 }, costs: { image: 1, video: 10 }, used: { credits_used: 0 }, remaining: { credits: 1000 } }

function account(usable: boolean): void {
  useCloudAuthStore.setState(
    usable
      ? { status: 'signed-in', user: { id: 'u', email: 'a@b.co' }, licenseActive: true, access: true, quota: QUOTA }
      : { status: 'signed-out', user: null, licenseActive: false, access: false, quota: null },
  )
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockClear()
  h.confirm.mockImplementation(async () => true)
  h.consent.mockImplementation(async () => true)
  useSettingsStore.getState().updateSettings({ appMode: 'local' })
  useMobilePrefs.getState().setPref('switchCounter', true)
  account(true)
})

describe('enterCloud', () => {
  it('asks "Switch to Cloud?" and switches on yes', async () => {
    expect(await enterCloud()).toBe(true)
    expect(h.confirm).toHaveBeenCalledTimes(1)
    expect(h.confirm.mock.calls[0][0]).toMatchObject({ title: 'Switch to Cloud?', confirmLabel: 'Switch to Cloud', cancelLabel: 'Stay on device', tone: 'cloud' })
    expect(cloudIsOn()).toBe(true)
    expect(h.report.mock.calls.map((c) => c[0])).toEqual(['arm', 'enter-cloud'])
  })

  it('stays on device on no', async () => {
    h.confirm.mockImplementation(async () => false)
    expect(await enterCloud()).toBe(false)
    expect(cloudIsOn()).toBe(false)
    expect(h.report.mock.calls.map((c) => c[0])).toEqual(['arm'])
  })

  it('stays on device when the consent to send content to LU Cloud is declined', async () => {
    h.consent.mockImplementation(async () => false)
    expect(await enterCloud()).toBe(false)
    expect(h.consent).toHaveBeenCalledTimes(1)
    expect(cloudIsOn()).toBe(false)
    expect(h.report.mock.calls.map((c) => c[0])).toEqual(['arm'])
  })

  it('does not ask for the consent when the user stays on device', async () => {
    h.confirm.mockImplementation(async () => false)
    await enterCloud()
    expect(h.consent).not.toHaveBeenCalled()
  })

  it('opens the gate without a usable account, and asks nothing', async () => {
    account(false)
    expect(await enterCloud()).toBe(false)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.push).toHaveBeenCalledWith('/cloud')
    expect(cloudIsOn()).toBe(false)
  })

  it('does not switch when the account went away while the dialog was open', async () => {
    h.confirm.mockImplementation(async () => {
      account(false)
      return true
    })
    expect(await enterCloud()).toBe(false)
    expect(cloudIsOn()).toBe(false)
    expect(h.push).toHaveBeenCalledWith('/cloud')
  })
})

describe('leaveCloud', () => {
  it('goes back on device at once, with the toast, and never asks', () => {
    useSettingsStore.getState().updateSettings({ appMode: 'cloud' })
    leaveCloud()
    expect(cloudIsOn()).toBe(false)
    expect(h.confirm).not.toHaveBeenCalled()
    expect(h.toast).toHaveBeenCalledWith('Back on device', expect.anything())
    expect(h.report).toHaveBeenCalledWith('leave-cloud')
  })

  it('does nothing when Cloud is already off', () => {
    leaveCloud()
    expect(h.toast).not.toHaveBeenCalled()
    expect(h.report).not.toHaveBeenCalled()
  })
})

describe('the anonymous counter', () => {
  it('N15: with the default setting nothing is counted until the Cloud switch is tapped', async () => {
    // What a phone does that never touches the switch: it reads the mode, and the account settles.
    expect(useMobilePrefs.getState().switchCounter).toBe(true)
    cloudIsOn()
    account(false)
    account(true)
    await Promise.resolve()
    expect(h.report).not.toHaveBeenCalled()
  })

  it('N15: a tap without an account is counted as one "open-gate", the only thing sent before Cloud was ever on', async () => {
    account(false)
    expect(await enterCloud()).toBe(false)
    expect(h.report.mock.calls.map((c) => c[0])).toEqual(['open-gate'])
    expect(cloudIsOn()).toBe(false)
  })

  it('stays silent when the user switched it off under Privacy', async () => {
    useMobilePrefs.getState().setPref('switchCounter', false)
    await enterCloud()
    leaveCloud()
    expect(h.report).not.toHaveBeenCalled()
    expect(cloudIsOn()).toBe(false)
  })
})

describe('for the screens of other strands', () => {
  it('enterCloud runs beforeSwitch after the yes and before the mode changes', async () => {
    const seen: string[] = []
    const ok = await enterCloud({ beforeSwitch: () => seen.push(cloudIsOn() ? 'cloud' : 'device') })
    expect(ok).toBe(true)
    expect(seen).toEqual(['device'])
    expect(cloudIsOn()).toBe(true)
  })

  it('enterCloud does not run beforeSwitch when the user stays on device', async () => {
    h.confirm.mockImplementation(async () => false)
    const before = vi.fn()
    expect(await enterCloud({ beforeSwitch: before })).toBe(false)
    expect(before).not.toHaveBeenCalled()
  })

  it('quiet leaves the words to the caller, and still counts', async () => {
    await enterCloud({ quiet: true })
    expect(h.toast).not.toHaveBeenCalled()
    expect(leaveCloud({ quiet: true })).toBe(true)
    expect(h.toast).not.toHaveBeenCalled()
    expect(h.report.mock.calls.map((c) => c[0])).toEqual(['arm', 'enter-cloud', 'leave-cloud'])
  })

  it('leaveCloud says whether anything changed', () => {
    expect(leaveCloud()).toBe(false)
    useSettingsStore.getState().updateSettings({ appMode: 'cloud' })
    expect(leaveCloud()).toBe(true)
  })

  it('the counter follows the switch under Privacy both ways, without a restart', async () => {
    useMobilePrefs.getState().setPref('switchCounter', false)
    await enterCloud()
    expect(h.report).not.toHaveBeenCalled()
    useMobilePrefs.getState().setPref('switchCounter', true)
    leaveCloud()
    expect(h.report.mock.calls.map((c) => c[0])).toEqual(['leave-cloud'])
  })
})

describe('toggleCloud', () => {
  it('maps the switch to the two ways', async () => {
    toggleCloud(true)
    await vi.waitFor(() => expect(cloudIsOn()).toBe(true))
    toggleCloud(false)
    expect(cloudIsOn()).toBe(false)
  })
})
