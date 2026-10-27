/**
 * R2 Connect to desktop. Route /remote/connect, page, strand 6 (Remote and resilience).
 *
 * From mobile-docs/design/DESIGN.md (German, element texts in English):
 *
 *   **R2 Connect to desktop** (`/remote/connect`)
 *   Elemente: R2.1 Feld "Address" (Tastatur fuer Adressen), R2.2 Feld "Passcode" (Ziffern), R2.3 "Connect", R2.4
 *   "Scan QR code instead".
 *   Zustaende: Pruefung laeuft (Knopf zeigt Fortschritt). Fehlertexte unter dem jeweiligen Feld.
 *
 * One page for both steps. The address may be sent alone: the desktop is
 * checked first, and only then the page asks for the code. A wrong address
 * therefore never costs one of the three tries the desktop allows for a code.
 * What was typed stays in the fields through every error. The code is never
 * kept anywhere but in this page while it is open.
 *
 * A pairing link (lu://remote?url=...&code=...) that the user confirmed in
 * the sheet G14 arrives here through the store (`pendingLink`). It fills the
 * address, and the code when the link carried one. It never connects by
 * itself: any app on the phone can send such a link, so "Connect" stays a
 * tap of the user.
 */
import { useEffect, useRef, useState } from 'react'
import { CircleHelp, Lock, MonitorSmartphone, QrCode, ShieldAlert } from 'lucide-react'
import { currentLinkOffer, nav, useIsTop } from '../../nav'
import { mobileOS } from '../../platform/detect'
import { isOnline } from '../../platform/network'
import { isNotWifiAddress, normalizePasscode } from '../../remote/pairingLink'
import { NOT_WIFI_TEXT, RemoteInvalidAddressError } from '../../remote/remoteErrors'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, Field, Notice, Page, Sparse, Spinner } from '../../ui'
import { leaveConnectPageConnected } from './parts/actions'
import { ChecksList } from './parts/ConnectionNotice'
import { connectDraft, markHandedByScan, remote, setConnectDraft, useRemote, wasHandedByScan } from './parts/session'
import { useScanSupport } from './parts/useScanSupport'
import { cleanPasscodeInput, connectStart, errorField, readConnectInput, secondsLeft, shownError, unreachableChecks, type ConnectStart } from './parts/view'
import './parts/remote.css'

interface LocalError {
  field: 'address' | 'passcode'
  text: string
}

function initialStart(): ConnectStart {
  const offer = currentLinkOffer()
  return connectStart({
    // A link the user said "Continue" to (G14) was handed to the store. It only fills the fields.
    handed: remote().pendingLink,
    draft: connectDraft(),
    connectionAddress: remote().connection?.address ?? null,
    offeredAddress: offer?.kind === 'remote' ? offer.address : null,
  })
}

export default function ConnectPage() {
  const status = useRemote((s) => s.status)
  const error = useRemote((s) => s.error)
  const retryAt = useRemote((s) => s.retryAt)
  const connection = useRemote((s) => s.connection)
  const hydrated = useRemote((s) => s.hydrated)
  const isTop = useIsTop()
  const scan = useScanSupport()

  const [start] = useState(initialStart)
  // Address and code came out of the scanner (review N4): same rule as a link, its own sentence.
  const [scanned] = useState(() => wasHandedByScan() && !!remote().pendingLink)
  // A QR code of LU 3.0.7 (lu://remote?v=2): pairing over the sealed channel, no code to type.
  const [sealedLink] = useState(() => remote().pendingLink?.sealed ?? null)
  const confirm = useRemote((s) => s.confirmOnDesktop)
  const [address, setAddress] = useState(start.address)
  const [passcode, setPasscode] = useState(start.passcode)
  const [local, setLocal] = useState<LocalError | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Leaving for the chat happens once, and only for a pairing this page saw happen.
  const armed = useRef(status !== 'connected')
  const left = useRef(false)

  // The handed link is taken once: it is in the fields now. The address is kept like a typed one
  // (it survives a trip to the scanner or the help page), the code only in this page.
  useEffect(() => {
    if (!remote().pendingLink) return
    setConnectDraft(start.address, true)
    remote().dismissLink()
    markHandedByScan(false)
  }, [start])

  const waiting = secondsLeft(retryAt, now)
  useEffect(() => {
    if (!retryAt) return
    // The first reading comes at once (the clock of this page may be minutes old), then twice a second.
    const tick = () => setNow(Date.now())
    const first = window.setTimeout(tick, 0)
    const timer = window.setInterval(tick, 500)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [retryAt])

  useEffect(() => {
    if (status !== 'connected') {
      armed.current = true
      return
    }
    if (!armed.current || left.current || !isTop) return
    left.current = true
    setConnectDraft('')
    leaveConnectPageConnected()
  }, [status, isTop])

  const busy = status === 'connecting' || status === 'pairing'
  const input = readConnectInput(address, passcode)
  const sameDesktop = !!input.target && input.target.baseUrl === connection?.baseUrl

  const submit = async (addressValue: string, passcodeValue: string) => {
    if (busy || !hydrated) return
    const read = readConnectInput(addressValue, passcodeValue)
    if (!read.target) {
      setLocal({ field: 'address', text: new RemoteInvalidAddressError().userMessage })
      return
    }
    if (read.codeIncomplete) {
      setLocal({ field: 'passcode', text: S.connect.passcodeShort })
      return
    }
    setLocal(null)
    setConnectDraft(addressValue)
    armed.current = true
    await remote().connect(read.target.baseUrl, read.code)
  }

  const onAddress = (value: string) => {
    setAddress(value)
    setConnectDraft(value)
    if (local?.field === 'address') setLocal(null)
    if (error && errorField(error) === 'address') remote().clearError()
  }

  const onPasscode = (value: string) => {
    const clean = cleanPasscodeInput(value)
    setPasscode(clean)
    if (local?.field === 'passcode') setLocal(null)
    // Six digits for a desktop that already answered: nothing is left to type.
    if (normalizePasscode(clean) && status === 'needs-code' && sameDesktop && waiting === 0) void submit(address, clean)
  }

  // An error of the store belongs to the address it was made for.
  const storeError = error && (sameDesktop || !connection) ? shownError(error, connection) : null
  const where = errorField(storeError)
  const addressError = local?.field === 'address' ? local.text : where === 'address' ? storeError?.message : undefined
  const passcodeError = local?.field === 'passcode' ? local.text : where === 'passcode' ? storeError?.message : undefined
  // np20 Fund 2: "Your desktop answered" never stands under a notice that says the opposite.
  const askCode = status === 'needs-code' && sameDesktop && !passcodeError && !input.code && where !== 'notice'
  const target = input.target
  const shownAddress = target ? target.baseUrl.replace(/^https?:\/\//, '') : address
  const sealedMode = !!sealedLink && status !== 'connected'
  const pairSealed = async () => {
    if (busy || !hydrated || !sealedLink) return
    armed.current = true
    await remote().connect(sealedLink.uri)
  }

  return (
    <Page
      title={S.connect.title}
      screen="remote-connect"
      footer={
        <>
          <Button
            variant="primary"
            block
            busy={busy}
            disabled={waiting > 0 || !hydrated}
            disabledReason={waiting > 0 ? S.connect.submitWait(waiting) : undefined}
            onPress={() => void (sealedMode ? pairSealed() : submit(address, passcode))}
            testid="m-remote-connect-submit"
            el="R2.3"
          >
            {sealedMode ? S.connect.sealedSubmit : S.connect.submit}
          </Button>
          <div className="m-remote-status" role="status" data-testid="m-remote-connect-status" data-m-status={status}>
            {busy ? (
              <>
                <Spinner label={status === 'pairing' ? S.connect.pairing : S.connect.checking(shownAddress)} />
                <span>{status === 'pairing' ? S.connect.pairing : S.connect.checking(shownAddress)}</span>
              </>
            ) : null}
          </div>
        </>
      }
    >
      <Sparse className="m-remote-form">
        {status === 'blocked' && storeError ? (
          <Notice variant="error" icon={ShieldAlert} title={S.connect.blockedTitle} testid="m-remote-connect-blocked">
            {storeError.message}
          </Notice>
        ) : where === 'notice' && storeError ? (
          <Notice
            variant="error"
            testid="m-remote-connect-error"
            actions={
              storeError.code === 'open-pairing' ? (
                <Button
                  compact
                  variant="primary"
                  busy={busy}
                  onPress={() => void submit(address, passcode)}
                  testid="m-remote-connect-retry"
                >
                  {S.connect.openPairingRetry}
                </Button>
              ) : undefined
            }
          >
            {storeError.message}
          </Notice>
        ) : null}
        {confirm && status === 'pairing' ? (
          <Notice icon={MonitorSmartphone} title={S.connect.confirmTitle} testid="m-remote-connect-confirm">
            {S.connect.confirmText(confirm.name)}
            {confirm.sas ? (
              <strong className="m-remote-sas" data-testid="m-remote-connect-sas" data-sas={confirm.sas}>
                {' '}
                {S.connect.confirmCode(confirm.sas)}
              </strong>
            ) : null}
            {confirm.fingerprint ? (
              <span className="m-remote-fingerprint" data-testid="m-remote-connect-fingerprint" data-fingerprint={confirm.fingerprint}>
                {' '}
                {S.connect.confirmDevice(confirm.fingerprint)}
              </span>
            ) : null}
          </Notice>
        ) : null}
        {sealedMode && sealedLink ? (
          <Notice icon={Lock} title={S.connect.sealedTitle(sealedLink.name)} testid="m-remote-connect-sealed">
            {S.connect.sealedText}
          </Notice>
        ) : null}
        {sealedMode && sealedLink && isNotWifiAddress(sealedLink.lan) && !sealedLink.tunnel ? (
          <Notice variant="warn" testid="m-remote-connect-not-wifi">
            {NOT_WIFI_TEXT}
          </Notice>
        ) : null}
        {!sealedMode && start.fromLink && address === start.address ? (
          <Notice testid="m-remote-connect-from-link">
            {scanned ? S.connect.fromScanWithCode : start.passcode && passcode === start.passcode ? S.connect.fromLinkWithCode : S.connect.fromLink}
          </Notice>
        ) : null}
        {sealedMode ? null : (
          <>
        <Field
          label={S.connect.address}
          value={address}
          onChange={onAddress}
          placeholder={S.connect.addressPlaceholder}
          hint={S.connect.addressHint}
          error={addressError}
          type="url"
          inputMode="url"
          clearable
          pasteable
          autoFocus={!address}
          onSubmit={() => void submit(address, passcode)}
          testid="m-remote-connect-address"
          el="R2.1"
        />
        {isNotWifiAddress(address) ? (
          <Notice variant="warn" testid="m-remote-connect-not-wifi">
            {NOT_WIFI_TEXT}
          </Notice>
        ) : null}
        <Field
          label={S.connect.passcode}
          value={passcode}
          onChange={onPasscode}
          placeholder={S.connect.passcodePlaceholder}
          hint={askCode ? S.connect.passcodeMissing : S.connect.passcodeHint}
          error={passcodeError}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={8}
          disabled={waiting > 0}
          autoFocus={!!address}
          onSubmit={() => void submit(address, passcode)}
          testid="m-remote-connect-passcode"
          el="R2.2"
        />
          </>
        )}
        {status === 'offline' && storeError ? (
          <Notice variant="warn" testid="m-remote-connect-checks-box">
            <ChecksList
              items={unreachableChecks({ route: connection?.route ?? target?.route ?? null, os: mobileOS(), deviceOnline: isOnline() })}
              testid="m-remote-connect-checks"
            />
          </Notice>
        ) : null}
        {/* Shown before an address is typed as well: pairing on Wi-Fi is the usual way, and it is plain text (review M11). */}
        {!sealedMode && (!target || (!target.secure && target.route !== 'loopback')) ? (
          <p className="m-cap" data-testid="m-remote-connect-insecure">
            {S.connect.insecureNote}
          </p>
        ) : null}
        <div className="m-stackv">
          {scan === 'native' || scan === 'web' ? (
            <Button block icon={QrCode} onPress={() => nav.replace('/remote/scan')} risk="sensor" testid="m-remote-connect-scan" el="R2.4">
              {S.connect.scanInstead}
            </Button>
          ) : null}
          <Button variant="quiet" block icon={CircleHelp} onPress={() => nav.push('/remote/help')} testid="m-remote-connect-help">
            {S.connect.help}
          </Button>
        </div>
      </Sparse>
    </Page>
  )
}
