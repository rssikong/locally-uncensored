/**
 * The desktop's half of the sealed channel in the store: paired phones,
 * their rights, the pairing question and the app's QR. The Rust side is in
 * src-tauri/src/commands/remote_sealed.rs and its tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRemoteStore, normalizeDeviceRights, normalizePairedDevices, normalizeNewDeviceRights, FIRST_PAIRING_RIGHTS } from '../remoteStore'
import { spacedCode } from '../../components/remote/RemotePairPrompt'
import { lastSeenLabel, deviceDetails } from '../../components/settings/RemoteAccessSettings'

vi.mock('../../api/backend', () => ({
  backendCall: vi.fn().mockResolvedValue({}),
  isTauri: vi.fn(() => true),
}))
import { backendCall } from '../../api/backend'
const mockBackend = backendCall as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockBackend.mockReset()
  mockBackend.mockResolvedValue({})
  useRemoteStore.setState({
    enabled: false,
    pairedDevices: [],
    pairRequests: [],
    sealedInfo: { available: false, storage: '', anywhere: false },
    appQrPngBase64: '',
    appQrExpiresAt: 0,
    error: null,
  })
})

describe('rights and devices are read field by field', () => {
  it('anything not exactly true is off', () => {
    expect(normalizeDeviceRights({ chat: true, agent: 'yes', files: 1 })).toEqual({
      chat: true, agent: false, files: false, terminal: false, create: false,
    })
    expect(normalizeDeviceRights(null)).toEqual({ chat: false, agent: false, files: false, terminal: false, create: false })
  })

  it('a device without an id is dropped, the rest keeps its shape', () => {
    const { info, devices } = normalizePairedDevices({
      available: true, storage: 'file', anywhere: true,
      devices: [
        { device_id: 'abc', name: 'Pixel 8', platform: 'android', app_version: '3.0.7', rights: { chat: true }, paired_at: 1, last_seen: 2 },
        { name: 'no id' },
        'junk',
      ],
    })
    expect(info).toEqual({ available: true, storage: 'file', anywhere: true })
    expect(devices).toHaveLength(1)
    expect(devices[0].rights.chat).toBe(true)
    expect(devices[0].rights.files).toBe(false)
  })
})

describe('Remote settings: rights for new phones, fingerprint and last seen', () => {
  it('new phones start with chat and agent unless the desktop names other rights', () => {
    expect(FIRST_PAIRING_RIGHTS).toEqual({ chat: true, agent: true, files: false, terminal: false, create: false })
    expect(normalizeNewDeviceRights({})).toEqual(FIRST_PAIRING_RIGHTS)
    expect(normalizeNewDeviceRights(null)).toEqual(FIRST_PAIRING_RIGHTS)
    expect(normalizeNewDeviceRights({ newDeviceRights: { chat: true, create: true } })).toEqual({ chat: true, agent: false, files: false, terminal: false, create: true })
  })

  it('setNewDeviceRights sends every right and keeps what was sent', async () => {
    const rights = { chat: true, agent: false, files: true, terminal: false, create: true }
    await useRemoteStore.getState().setNewDeviceRights(rights)
    expect(mockBackend).toHaveBeenCalledWith('remote_set_new_device_rights', { rights })
    expect(useRemoteStore.getState().newDeviceRights).toEqual(rights)
  })

  it('refreshing reads the rights for new phones and each fingerprint', async () => {
    mockBackend.mockResolvedValueOnce({
      available: true, storage: 'file', anywhere: false,
      newDeviceRights: { chat: true, agent: true, files: true, terminal: false, create: false },
      devices: [{ device_id: 'abc', name: 'Pixel 8', fingerprint: '3F2A 9C01', last_seen: 5 }],
    })
    await useRemoteStore.getState().refreshPairedDevices()
    expect(useRemoteStore.getState().newDeviceRights.files).toBe(true)
    expect(useRemoteStore.getState().pairedDevices[0].fingerprint).toBe('3F2A 9C01')
  })

  it('the list line names platform, version, fingerprint and last seen', () => {
    const now = 1_000_000_000_000
    expect(deviceDetails({ platform: 'android', app_version: '3.0.8', fingerprint: '3F2A 9C01', last_seen: now / 1000 - 120 }, now))
      .toBe('android, LU 3.0.8, ID 3F2A 9C01, last seen 2 min ago')
    expect(deviceDetails({ platform: '', app_version: '', fingerprint: '', last_seen: 0 }, now)).toBe('last seen never')
  })
})

describe('store actions', () => {
  it('setDeviceRights sends every right, exactly as shown', async () => {
    useRemoteStore.setState({
      pairedDevices: [{ device_id: 'abc', name: 'P', platform: '', app_version: '', rights: normalizeDeviceRights({ chat: true }), paired_at: 0, last_seen: 0, fingerprint: '' }],
    })
    await useRemoteStore.getState().setDeviceRights('abc', { chat: true, agent: false, files: true, terminal: false, create: false })
    expect(mockBackend).toHaveBeenCalledWith('remote_set_device_rights', {
      deviceId: 'abc',
      rights: { chat: true, agent: false, files: true, terminal: false, create: false },
    })
    expect(useRemoteStore.getState().pairedDevices[0].rights.files).toBe(true)
  })

  it('decidePairing answers the desktop question and drops the request', async () => {
    useRemoteStore.setState({ pairRequests: [{ requestId: 'r1', name: 'Pixel 8', platform: 'android', comparisonCode: null }] })
    await useRemoteStore.getState().decidePairing('r1', true)
    expect(mockBackend).toHaveBeenCalledWith('remote_pair_decide', { requestId: 'r1', allow: true })
    expect(useRemoteStore.getState().pairRequests).toEqual([])
  })

  it('a missing sealed channel leaves only the browser QR', async () => {
    mockBackend.mockRejectedValueOnce(new Error('Remote server not running'))
    useRemoteStore.setState({ appQrPngBase64: 'old' })
    await useRemoteStore.getState().fetchAppQr()
    expect(useRemoteStore.getState().appQrPngBase64).toBe('')
  })

  it('the app QR and its end are taken from the answer', async () => {
    mockBackend.mockResolvedValueOnce({ qr_png_base64: 'png', expiresAt: 123 })
    await useRemoteStore.getState().fetchAppQr()
    expect(useRemoteStore.getState().appQrPngBase64).toBe('png')
    expect(useRemoteStore.getState().appQrExpiresAt).toBe(123)
  })

  it('a pairing request comes once even when announced twice', () => {
    const req = { requestId: 'r2', name: 'A', platform: 'android', comparisonCode: '432554' }
    useRemoteStore.getState().addPairRequest(req)
    useRemoteStore.getState().addPairRequest(req)
    expect(useRemoteStore.getState().pairRequests).toHaveLength(1)
  })
})

describe('texts', () => {
  it('the comparison code reads in two groups of three', () => {
    expect(spacedCode('432554')).toBe('432 554')
    expect(spacedCode('12')).toBe('12')
  })

  it('last seen reads in words', () => {
    const now = 1_790_000_000_000
    expect(lastSeenLabel(0, now)).toBe('never')
    expect(lastSeenLabel(now / 1000 - 10, now)).toBe('just now')
    expect(lastSeenLabel(now / 1000 - 600, now)).toBe('10 min ago')
    expect(lastSeenLabel(now / 1000 - 7200, now)).toBe('2 h ago')
  })
})
