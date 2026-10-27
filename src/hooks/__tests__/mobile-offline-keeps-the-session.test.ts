/**
 * Point 5 of the mobile groundwork: a phone that starts in a dead zone keeps
 * its account and its mode.
 *
 * The audit (section 6, item 5): the first probe after start has 15 seconds.
 * When it fails for any reason the user counts as signed out, and syncAppMode
 * then writes appMode 'local' into the PERSISTED settings. One start without
 * network threw a Cloud user into Local mode for good, and the next probe
 * came five minutes later.
 *
 * Run: npx vitest run src/hooks/__tests__/mobile-offline-keeps-the-session.test.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { standOn } from '../../test-support/devices'

const saved = vi.hoisted(() => ({ user: null as { id: string; email?: string } | null }))
vi.mock('../../api/cloud/supabase', () => ({
  supabaseCloud: () => ({ auth: {} }),
  savedSessionUser: async () => saved.user,
  onOAuthSignedIn: () => () => {},
}))
const jobs = vi.hoisted(() => ({ getMe: vi.fn(), getQuota: vi.fn() }))
vi.mock('../../api/cloud/jobs', () => jobs)
vi.mock('../../stores/cloudCatalogStore', () => ({ refreshCatalog: vi.fn() }))
const setProviderConfig = vi.hoisted(() => vi.fn())
vi.mock('../../stores/providerStore', () => ({
  useProviderStore: { getState: () => ({ providers: { 'lu-cloud': { enabled: true } }, setProviderConfig }) },
}))
const settings = vi.hoisted(() => ({ appMode: 'cloud', updateSettings: vi.fn() }))
vi.mock('../../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ settings: { appMode: settings.appMode }, updateSettings: settings.updateSettings }) },
}))

import { probeAccount } from '../useCloudAuth'
import { useCloudAuthStore } from '../../stores/cloudAuthStore'
import { CloudJobError } from '../../api/cloud/client'

const QUOTA = { limits: { credits: 100 } } as never

beforeEach(() => {
  saved.user = { id: 'user-1', email: 'a@b.test' }
  jobs.getMe.mockReset()
  jobs.getQuota.mockReset()
  setProviderConfig.mockClear()
  settings.appMode = 'cloud'
  settings.updateSettings.mockClear()
  useCloudAuthStore.setState({
    status: 'probing', user: null, offline: false, licenseActive: false, tier: null, access: true, quota: null,
  })
  vi.stubGlobal('window', { dispatchEvent: () => true })
})
afterEach(() => { vi.unstubAllGlobals() })

describe('the first probe fails because there is no network', () => {
  for (const device of ['android', 'iphone'] as const) {
    it(`${device}: the session is kept, the mode is not touched`, async () => {
      standOn(device)
      jobs.getMe.mockRejectedValue(new TypeError('Failed to fetch'))

      await probeAccount()

      const s = useCloudAuthStore.getState()
      expect(s.status).toBe('signed-in')
      expect(s.offline).toBe(true)
      expect(s.user).toEqual({ id: 'user-1', email: 'a@b.test' })
      expect(settings.updateSettings).not.toHaveBeenCalled()
      // The cloud provider is not switched off either: its saved state stands
      // until a probe gets an answer.
      expect(setProviderConfig).not.toHaveBeenCalled()
    })
  }

  it('phone: the next probe that gets through clears the offline state', async () => {
    standOn('android')
    jobs.getMe.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    await probeAccount()
    expect(useCloudAuthStore.getState().offline).toBe(true)

    jobs.getMe.mockResolvedValue({ user: { id: 'user-1', email: 'a@b.test' }, license: { status: 'active', tier: 'pro' } })
    jobs.getQuota.mockResolvedValue(QUOTA)
    await probeAccount()

    const s = useCloudAuthStore.getState()
    expect(s.offline).toBe(false)
    expect(s.status).toBe('signed-in')
    expect(s.licenseActive).toBe(true)
    expect(settings.updateSettings).not.toHaveBeenCalled()
  })

  it('phone: without a saved session there is nobody to keep, signed out as before', async () => {
    standOn('android')
    saved.user = null
    jobs.getMe.mockRejectedValue(new TypeError('Failed to fetch'))
    await probeAccount()
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
    expect(useCloudAuthStore.getState().offline).toBe(false)
  })

  it('phone: a real refusal from the server still signs out and leaves Cloud mode', async () => {
    standOn('iphone')
    jobs.getMe.mockRejectedValue(new CloudJobError('unauthorized', 401))
    await probeAccount()
    expect(useCloudAuthStore.getState().status).toBe('signed-out')
    expect(settings.updateSettings).toHaveBeenCalledWith({ appMode: 'local' })
  })

  for (const device of ['windows', 'mac', 'linux'] as const) {
    it(`${device}: unchanged, the boot probe resolves to signed out and the mode goes to local`, async () => {
      standOn(device)
      jobs.getMe.mockRejectedValue(new TypeError('Failed to fetch'))
      await probeAccount()
      const s = useCloudAuthStore.getState()
      expect(s.status).toBe('signed-out')
      expect(s.offline).toBe(false)
      expect(settings.updateSettings).toHaveBeenCalledWith({ appMode: 'local' })
    })
  }
})
