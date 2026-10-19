// @vitest-environment jsdom
/**
 * 3.0.7, the owner's wish of 15.10.2026: where the local model picked in
 * Create does not fit this machine, or a local video run would take very
 * long, Create says that LU Cloud runs it, in one quiet line that can be
 * closed. The app has no runtime estimate for a PC video run, so there the
 * line rides on the card verdict (too big, or only partly on the card for a
 * video); on a Mac on its memory verdict and its measured run time.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { VramFit } from '../../../../lib/vram-fit'

const env = vi.hoisted(() => ({
  mac: false,
  fit: 'unknown' as VramFit,
  macFacts: { line: null as string | null, duration: null as string | null },
}))
vi.mock('../../../../api/mlx-image', async (orig) => ({
  ...(await orig<typeof import('../../../../api/mlx-image')>()),
  isMlxImageHost: () => env.mac,
}))
vi.mock('../../../../hooks/useLocalModelFit', () => ({
  useLocalModelFits: () => ({ cardGb: 12, fitOf: () => env.fit }),
}))
vi.mock('../MacVideoMemoryNotice', () => ({ useMacVideoFacts: () => env.macFacts }))

import { CreateCloudOffer } from '../CreateCloudOffer'
import { useCreateStore, type CreateIntent } from '../../../../stores/createStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { useUIStore } from '../../../../stores/uiStore'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { CLOUD_MODEL_SEED } from '../../../../lib/render/cloud-models'
import type { CloudQuota } from '../../../../lib/render/cloud-jobs'

const QUOTA: CloudQuota = {
  tier: 'hosted', period: '2026-10', limits: { credits: 100_000 }, costs: { image: 500, video: 9000 },
  used: { credits_used: 0 }, remaining: { credits: 100_000 },
}

function show(intent: CreateIntent, fit: VramFit) {
  useCreateStore.getState().setIntent(intent)
  env.fit = fit
  return render(<CreateCloudOffer />)
}
const line = () => screen.queryByTestId('cloud-offer-create')

beforeEach(() => {
  env.mac = false
  env.fit = 'unknown'
  env.macFacts = { line: null, duration: null }
  useSettingsStore.getState().updateSettings({ appMode: 'local', cloudTeasersEnabled: true })
  useCreateStore.setState({ backend: 'local', cloudVideoModel: 'ltx-2', cloudFrames: 97, cloudFps: 24 })
  useUIStore.setState({ cloudGateOpen: false, cloudOfferDismissed: false, currentView: 'create' })
  useCloudAuthStore.setState({ user: null, licenseActive: false, access: false, quota: null })
  useCloudCatalogStore.setState({ fetchedAt: null, models: CLOUD_MODEL_SEED })
})
afterEach(cleanup)

describe('a PC', () => {
  it('a video model too big for the card', () => {
    show('video', 'big')
    expect(line()?.textContent).toBe('Too big for this graphics card. Videos run on LU Cloud.')
    expect(line()?.getAttribute('data-reason')).toBe('too-big')
    expect(screen.getByTestId('cloud-offer-button').textContent).toBe('Try LU Cloud')
  })

  it('a video model only partly on the card: a run can take long', () => {
    show('animate', 'tight')
    expect(line()?.textContent).toBe('This model only partly fits this graphics card, so a run can take long. Videos also run on LU Cloud.')
  })

  it('an image model too big for the card, but not one that is merely tight', () => {
    show('image', 'big')
    expect(line()?.textContent).toBe('Too big for this graphics card. Images run on LU Cloud.')
    cleanup()
    show('image', 'tight')
    expect(line()).toBeNull()
  })

  it('nothing for a model that fits, or a card nobody measured', () => {
    show('video', 'fits')
    expect(line()).toBeNull()
    cleanup()
    show('video', 'unknown')
    expect(line()).toBeNull()
  })
})

describe('a Mac', () => {
  it('rides on the memory verdict and the measured run time, not on a card', () => {
    env.mac = true
    env.macFacts = { line: 'Wan is recommended for Macs with 32 GB', duration: null }
    show('video', 'big')
    expect(line()?.textContent).toBe("Too big for this Mac's memory. Videos run on LU Cloud.")
    cleanup()
    env.macFacts = { line: null, duration: 'A clip of 10 seconds takes about 40 minutes' }
    show('video', 'unknown')
    expect(line()?.textContent).toBe('This run takes long on this Mac. Videos also run on LU Cloud.')
    cleanup()
    env.macFacts = { line: null, duration: null }
    show('video', 'unknown')
    expect(line()).toBeNull()
  })
})

describe('when it stays away', () => {
  it('in cloud mode', () => {
    useSettingsStore.getState().updateSettings({ appMode: 'cloud' })
    show('video', 'big')
    expect(line()).toBeNull()
  })

  it('on the cloud lane of Create', () => {
    useCreateStore.setState({ backend: 'cloud' })
    show('video', 'big')
    expect(line()).toBeNull()
  })

  it('with "Show Cloud features in Local mode" off', () => {
    useSettingsStore.getState().updateSettings({ cloudTeasersEnabled: false })
    show('video', 'big')
    expect(line()).toBeNull()
  })

  it('once closed, for the rest of the session', () => {
    show('video', 'big')
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(useUIStore.getState().cloudOfferDismissed).toBe(true)
    expect(line()).toBeNull()
  })
})

describe('the price', () => {
  it('no number while the app does not know it', () => {
    show('video', 'big')
    expect(screen.queryByTestId('cloud-offer-credits')).toBeNull()
  })

  it('the catalogue figure for the model Create would run in the cloud', () => {
    useCloudAuthStore.setState({ quota: QUOTA })
    useCloudCatalogStore.setState({ fetchedAt: Date.now() })
    show('video', 'big')
    expect(screen.getByTestId('cloud-offer-credits').textContent).toBe(' About 8,000 credits per run.')
  })
})

describe('the click', () => {
  it('opens the cloud gate with Create on the same tab', () => {
    show('animate', 'big')
    fireEvent.click(screen.getByTestId('cloud-offer-button'))
    expect(useUIStore.getState().cloudGateOpen).toBe(true)
    expect(useCreateStore.getState().intent()).toBe('animate')
    expect(useUIStore.getState().currentView).toBe('create')
  })
})
