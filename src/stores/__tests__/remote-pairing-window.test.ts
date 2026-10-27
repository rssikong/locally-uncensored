import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBackendCall = vi.fn()
vi.mock('../../api/backend', () => ({
  backendCall: (...args: unknown[]) => mockBackendCall(...args),
  isTauri: () => true,
}))

import { useRemoteStore, normalizeLegacyAccess } from '../remoteStore'

describe('pairing window (a code only while the QR panel shows)', () => {
  beforeEach(() => {
    mockBackendCall.mockReset()
    useRemoteStore.setState({ passcode: '', passcodeExpiresAt: 0, appQrPngBase64: '', appQrExpiresAt: 0 })
  })

  it('opening asks the server for a code and shows it', async () => {
    mockBackendCall.mockImplementation(async (cmd: string) => {
      if (cmd === 'remote_pairing_window') return { passcode: '123456', passcodeExpiresAt: 99 }
      if (cmd === 'remote_pairing_qr') return { qr_png_base64: 'APPQR', expiresAt: 50 }
      return { qr_png_base64: 'QR', url: '', passcode: '' }
    })
    await useRemoteStore.getState().setPairingWindow(true)
    expect(mockBackendCall).toHaveBeenCalledWith('remote_pairing_window', { open: true })
    const s = useRemoteStore.getState()
    expect(s.passcode).toBe('123456')
    expect(s.passcodeExpiresAt).toBe(99)
    expect(s.appQrPngBase64).toBe('APPQR')
  })

  it('closing drops the code and the ticket QR', async () => {
    useRemoteStore.setState({ passcode: '123456', passcodeExpiresAt: 99, appQrPngBase64: 'APPQR', appQrExpiresAt: 50 })
    mockBackendCall.mockResolvedValue({ passcode: '', passcodeExpiresAt: 0 })
    await useRemoteStore.getState().setPairingWindow(false)
    expect(mockBackendCall).toHaveBeenCalledWith('remote_pairing_window', { open: false })
    const s = useRemoteStore.getState()
    expect(s.passcode).toBe('')
    expect(s.appQrPngBase64).toBe('')
  })

  it('the old way in reads as closed unless the server names an end', () => {
    expect(normalizeLegacyAccess(null)).toEqual({ needsConsent: false, until: null })
    expect(normalizeLegacyAccess({ needsConsent: true, until: 0 })).toEqual({ needsConsent: true, until: null })
    expect(normalizeLegacyAccess({ needsConsent: true, until: 1790000000 })).toEqual({ needsConsent: true, until: 1790000000 })
  })
})
