// @vitest-environment jsdom
/**
 * R2 with the sealed channel (3.0.7): a QR code v2 is paired with one tap
 * and no fields, the page says "Confirm on your computer" while the desktop
 * asks its user, and on the Wi-Fi code way it shows the comparison code.
 *
 * Run: npx vitest run src/mobile/screens/remote/__tests__/sealed-pairing.dom.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { parsePairingInput } from '../../../remote/pairingLink'
import { REMOTE_STRINGS as S } from '../../../strings/remote'
import ConnectPage from '../ConnectPage'
import { __resetRemoteSessionForTests, remoteSession } from '../parts/session'

const LINK =
  'lu://remote?v=2&id=or24zD2Qk4Z7byxTVSh6WQ&k=BfxuiDY3CQ1PxDDevIm115xptCqC1tiwC6DVMShSvy4&t=MzMzMzMzMzMzMzMzMzMzMw&n=Studio+PC&net=https%3A%2F%2Fquiet-river-lamp.trycloudflare.com'

beforeEach(() => {
  __resetRemoteSessionForTests()
})
afterEach(cleanup)

function setState(patch: Record<string, unknown>): void {
  act(() => {
    remoteSession().useStore.setState({ hydrated: true, ...patch } as never)
  })
}

describe('pairing with the QR code of LU 3.0.7', () => {
  it('shows who it pairs with, no address or code field, and pairs on "Pair"', async () => {
    const connect = vi.fn(async () => {})
    setState({ status: 'unpaired', pendingLink: parsePairingInput(LINK), connect })
    render(<ConnectPage />)
    const box = screen.getByTestId('m-remote-connect-sealed')
    expect(box.textContent).toContain(S.connect.sealedTitle('Studio PC'))
    expect(box.textContent).toContain('encrypted end to end')
    expect(screen.queryByTestId('m-remote-connect-address')).toBeNull()
    expect(screen.queryByTestId('m-remote-connect-passcode')).toBeNull()
    // The note about plain text on Wi-Fi does not belong to a sealed pairing.
    expect(screen.queryByTestId('m-remote-connect-insecure')).toBeNull()
    const button = screen.getByTestId('m-remote-connect-submit')
    expect(button.textContent).toContain(S.connect.sealedSubmit)
    await act(async () => {
      fireEvent.click(button)
    })
    expect(connect).toHaveBeenCalledWith(LINK)
  })

  it('says "Confirm on your computer" while the desktop asks; without a code from Rust no code is shown', () => {
    setState({ status: 'pairing', confirmOnDesktop: { name: 'Studio PC', sas: null, fingerprint: '' } })
    render(<ConnectPage />)
    const box = screen.getByTestId('m-remote-connect-confirm')
    expect(box.textContent).toContain(S.connect.confirmTitle)
    expect(box.textContent).toContain('Allow this phone in LU on Studio PC')
    expect(screen.queryByTestId('m-remote-connect-sas')).toBeNull()
  })

  it('shows the comparison code and the device ID the computer shows (QR and Wi-Fi code way)', () => {
    setState({ status: 'pairing', confirmOnDesktop: { name: 'Studio PC', sas: '432554', fingerprint: 'E7CA CC8D' } })
    render(<ConnectPage />)
    const sas = screen.getByTestId('m-remote-connect-sas')
    expect(sas.getAttribute('data-sas')).toBe('432554')
    expect(sas.textContent).toContain('432 554')
    expect(sas.textContent).not.toContain(String.fromCharCode(0x2014))
    expect(sas.textContent).not.toContain(String.fromCharCode(0x2013))
    const fp = screen.getByTestId('m-remote-connect-fingerprint')
    expect(fp.getAttribute('data-fingerprint')).toBe('E7CA CC8D')
    expect(fp.textContent).toContain('device ID E7CA CC8D')
  })

  it('H1: pairing closed on the computer, the page says so and offers Try again, which reads the status anew', async () => {
    const connect = vi.fn(async () => {})
    setState({
      status: 'needs-code',
      error: { code: 'open-pairing', message: 'Open pairing on your computer: in LU, go to Remote Access and show the QR code or the 6 digit code. Then tap Try again.' },
      connection: null,
      connect,
    })
    render(<ConnectPage />)
    expect(screen.getByTestId('m-remote-connect-error').textContent).toContain('Open pairing on your computer')
    fireEvent.change(screen.getByTestId('m-remote-connect-address').querySelector('input') ?? screen.getByTestId('m-remote-connect-address'), { target: { value: '192.168.1.20:11435' } })
    await act(async () => {
      fireEvent.click(screen.getByTestId('m-remote-connect-retry'))
    })
    expect(connect).toHaveBeenCalled()
  })

  const NEW_DESKTOP = {
    baseUrl: 'http://192.168.1.20:11435',
    address: '192.168.1.20:11435',
    route: 'lan',
    secure: false,
    pairedAt: null,
    lastOkAt: null,
    serverVersion: '',
    hostName: '',
    pin: null,
    via: null,
  }

  it('np20 Fund 2: under "Open pairing" the passcode never says "Your desktop answered"', () => {
    setState({
      status: 'needs-code',
      error: { code: 'open-pairing', message: 'Open pairing on your computer: in LU, go to Remote Access and show the QR code or the 6 digit code. Then tap Try again.' },
      connection: NEW_DESKTOP,
    })
    render(<ConnectPage />)
    expect(screen.getByTestId('m-remote-connect-error').textContent).toContain('Open pairing on your computer')
    expect(document.body.textContent).not.toContain(S.connect.passcodeMissing)
    expect(document.body.textContent).toContain(S.connect.passcodeHint)
  })

  it('without an open panel the desktop answers nothing: round 57 shows "Open pairing", not "Cannot reach"', () => {
    setState({
      status: 'offline',
      error: { code: 'unreachable', message: 'Cannot reach your desktop. Check that LU is open there with Remote Access turned on and that this phone is on the same Wi-Fi.' },
      connection: NEW_DESKTOP,
    })
    render(<ConnectPage />)
    expect(screen.getByTestId('m-remote-connect-error').textContent).toContain('Open pairing on your computer')
    expect(screen.getByTestId('m-remote-connect-retry')).toBeTruthy()
    expect(document.body.textContent).not.toContain('Cannot reach')
    // What to check stays below, for the case that the panel is open and the phone still gets no answer.
    expect(screen.getByTestId('m-remote-connect-checks')).toBeTruthy()
  })

  it('a desktop that worked before keeps "Cannot reach"', () => {
    setState({
      status: 'offline',
      error: { code: 'unreachable', message: 'Cannot reach your desktop. Check that LU is open there with Remote Access turned on and that this phone is on the same Wi-Fi.' },
      connection: { ...NEW_DESKTOP, lastOkAt: 1_700_000_000_000 },
    })
    render(<ConnectPage />)
    expect(document.body.textContent).toContain('Cannot reach your desktop')
    expect(screen.queryByTestId('m-remote-connect-error')).toBeNull()
  })

  it('a refusal of the channel is shown as a sentence, with the fields of the old way', () => {
    setState({
      status: 'needs-code',
      error: { code: 'scan-needed', message: 'Over the internet this phone pairs with the QR code only.' },
      connection: null,
    })
    render(<ConnectPage />)
    expect(screen.getByTestId('m-remote-connect-error').textContent).toContain('QR code only')
    expect(screen.getByTestId('m-remote-connect-address')).toBeTruthy()
  })
})
