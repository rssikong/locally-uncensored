// @vitest-environment jsdom
/**
 * Discord 2026-09-23: "is there a way to limit download speed
 * that this app does whenever it downloads anything?" Settings, Storage
 * now holds a limit in MB/s, and the downloader in Rust gets it at boot and on
 * every change (the shared throttle itself is tested in download.rs).
 *
 * Run: npx vitest run src/lib/__tests__/the-download-speed-can-be-limited.test.tsx
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const backendCall = vi.fn(async () => null)
vi.mock('../../api/backend', async (o) => ({
  ...(await o<typeof import('../../api/backend')>()),
  isTauri: () => true,
  backendCall: (...a: unknown[]) => backendCall(...(a as [])),
}))

import { parseDownloadLimit, startDownloadLimitSync } from '../download-limit'
import { DownloadLimitSetting } from '../../components/settings/DownloadLimitSetting'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../constants'

const limitCalls = () => backendCall.mock.calls.filter((c) => (c as unknown[])[0] === 'set_download_limit').map((c) => (c as unknown[])[1])

beforeEach(() => {
  cleanup()
  backendCall.mockClear()
  useSettingsStore.getState().updateSettings({ downloadLimitMBps: 0 })
})

describe('the download speed limit', () => {
  it('is off by default', () => {
    expect(DEFAULT_SETTINGS.downloadLimitMBps).toBe(0)
  })

  it('reads what people type, and anything unusable means no limit', () => {
    expect(parseDownloadLimit('10')).toBe(10)
    expect(parseDownloadLimit('2,5')).toBe(2.5)
    expect(parseDownloadLimit('')).toBe(0)
    expect(parseDownloadLimit('-3')).toBe(0)
    expect(parseDownloadLimit('fast')).toBe(0)
  })

  it('typed in Settings, it reaches the downloader at boot and on every change', async () => {
    useSettingsStore.getState().updateSettings({ downloadLimitMBps: 4 })
    await startDownloadLimitSync()
    expect(limitCalls()).toEqual([{ mbPerSec: 4 }])

    render(<DownloadLimitSetting />)
    const box = screen.getByLabelText('Download speed limit in MB/s')
    fireEvent.change(box, { target: { value: '12.5' } })
    fireEvent.blur(box)
    expect(useSettingsStore.getState().settings.downloadLimitMBps).toBe(12.5)
    await vi.waitFor(() => expect(limitCalls()).toContainEqual({ mbPerSec: 12.5 }))
    expect(screen.getByText('Model downloads share 12.5 MB/s between them. 0 removes the limit.')).toBeTruthy()
  })

  // Negative control: a store write that leaves the limit alone sends nothing.
  it('other settings changes do not touch the downloader', async () => {
    await startDownloadLimitSync()
    backendCall.mockClear()
    useSettingsStore.getState().updateSettings({ loopMaxPasses: 3 })
    expect(limitCalls()).toEqual([])
  })
})
