/**
 * R3 Scan code. Route /remote/scan, full screen, strand 6 (Remote and resilience).
 *
 * From mobile-docs/design/DESIGN.md (German, element texts in English):
 *
 *   **R3 Scan code** (Vollbild)
 *   Elemente: R3.1 "Close", R3.2 "Enter address instead", R3.3 Taschenlampe.
 *   Zustaende: Kamera nicht erlaubt: "LU needs the camera to scan the code." mit "Open system settings" und R3.2.
 *   Code erkannt: Adresse wird gezeigt, Passcode wird in R2 abgefragt.
 *
 * Three ways, asked from platform/camera.ts: the scanner of the system, the
 * camera picture inside the page, or none. Without a scanner the page says
 * so and leads to typing the address, which works the same way. The Android
 * app scans natively since round 57: the camera app of the system takes one
 * photo and the native layer reads the code in it; a photo without a code
 * gets its own sentence. Whatever happens, the page ends in the connect page
 * or in a sentence with a button.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CameraOff, Flashlight, FlashlightOff, QrCode, ScanLine, X } from 'lucide-react'
import { nav, useIsTop } from '../../nav'
import { detectQr, isScannerMissing, scanQr } from '../../platform/camera'
import { useAppLifecycle } from '../../platform/lifecycle'
import { openSystemSettings } from '../../platform/open-external'
import { REMOTE_STRINGS as S } from '../../strings/remote'
import { Button, EmptyState, ErrorState, IconButton, Page, Progress, toast } from '../../ui'
import { cameraFailure, hasTorch, interpretScan, openCamera, setTorch, stopCamera } from './parts/scan'
import { markHandedByScan, remote, setConnectDraft } from './parts/session'
import { appHasNoCamera, useScanSupport } from './parts/useScanSupport'
import './parts/remote.css'

type Phase =
  | 'asking'
  /** The system scanner is open, or the camera is starting. */
  | 'starting'
  /** The camera picture is on screen and being read. */
  | 'live'
  | 'denied'
  | 'failed'
  | 'none'
  /** The scanner was closed without a code. */
  | 'closed'
  /** A photo of the system camera without a QR code in it (Android). */
  | 'nocode'
  /** A code, but not one of LU. */
  | 'foreign'
  | 'found'

/** How often the camera picture is read, in ms. */
const READ_EVERY_MS = 250
/** A code that is not ours is mentioned at most this often while the camera keeps looking. */
const FOREIGN_NOTE_EVERY_MS = 4000

export default function ScanPage() {
  const support = useScanSupport()
  const isTop = useIsTop()
  const [step, setPhase] = useState<Phase>('asking')
  // A phone without any scanner has one state only, whatever was tried.
  const phase: Phase = support === 'none' ? 'none' : step
  const [found, setFound] = useState('')
  const [torch, setTorchState] = useState<'none' | 'off' | 'on'>('none')
  const [round, setRound] = useState(0)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const done = useRef(false)

  const toConnect = useCallback(() => nav.replace('/remote/connect'), [])

  const supportRef = useRef(support)
  useEffect(() => {
    supportRef.current = support
  }, [support])
  const saidForeignAt = useRef(0)

  const take = useCallback((text: string | null) => {
    if (done.current) return
    const reading = interpretScan(text)
    if (reading.kind === 'foreign') {
      if (supportRef.current === 'web') {
        // The camera keeps looking: say it, at most every few seconds, and go on.
        if (Date.now() - saidForeignAt.current > FOREIGN_NOTE_EVERY_MS) {
          saidForeignAt.current = Date.now()
          toast(S.scan.wrongTitle, { testid: 'remote-scan-foreign' })
        }
        return
      }
      setPhase('foreign')
      return
    }
    done.current = true
    stopCamera(streamRef.current)
    streamRef.current = null
    setFound(reading.address)
    setPhase('found')
    // A QR code of LU 3.0.7 (sealed) is handed over the same way: R2 names the computer and "Pair" decides.
    if (reading.target.code || reading.target.sealed) {
      // The picture carries a code. The desktop of LU never puts one into its QR code, so this picture was
      // made by somebody: a sticker with a tunnel address and a code would pair the phone with a stranger's
      // machine and end the session it has (review N4). It is handed over like a link: the Connect page
      // shows address and code, and nothing is sent before "Connect" there.
      markHandedByScan(true)
      remote().offerLink(reading.text)
      nav.replace('/remote/connect')
      return
    }
    // Aiming the camera at the desktop is the user's own step, so the check of the address may start.
    // Nothing is paired by it: the code is asked for in R2.
    setConnectDraft(reading.address)
    void remote().connect(reading.text)
    nav.replace('/remote/connect')
  }, [])

  // The scanner of the system.
  useEffect(() => {
    if (support !== 'native' || !isTop) return
    let alive = true
    done.current = false
    scanQr().then(
      (text) => {
        if (!alive) return
        if (text === null) setPhase('closed')
        else take(text)
      },
      (err) => {
        if (!alive) return
        if (isScannerMissing(err)) setPhase('none')
        else if (/no QR code/i.test(String(err))) setPhase('nocode')
        else setPhase(cameraFailure(err) === 'denied' || /denied|permission/i.test(String(err)) ? 'denied' : 'failed')
      },
    )
    return () => {
      alive = false
      // Whatever comes next (another round, the return from a dialog) begins as a start.
      setPhase('starting')
    }
  }, [support, isTop, round, take])

  // The camera picture inside the page.
  useEffect(() => {
    if (support !== 'web' || !isTop) return
    let alive = true
    let timer: number | undefined
    done.current = false
    openCamera().then(
      async (stream) => {
        if (!alive) {
          stopCamera(stream)
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        if (!alive) return
        setTorchState(hasTorch(stream.getVideoTracks()[0]) ? 'off' : 'none')
        setPhase('live')
        let reading = false
        timer = window.setInterval(() => {
          const el = videoRef.current
          if (reading || done.current || !el || el.readyState < 2) return
          reading = true
          void detectQr(el).then((text) => {
            reading = false
            if (alive && text) take(text)
          })
        }, READ_EVERY_MS)
      },
      (err) => {
        // Where the app cannot have the camera at all, the settings would not help: the page says so and leads to typing.
        if (alive) setPhase(appHasNoCamera() ? 'none' : cameraFailure(err))
      },
    )
    return () => {
      alive = false
      window.clearInterval(timer)
      stopCamera(streamRef.current)
      streamRef.current = null
      setTorchState('none')
      setPhase('starting')
    }
  }, [support, isTop, round, take])

  // A camera that stays on in the background drains the battery and keeps the light on.
  useAppLifecycle({
    onBackground: () => {
      stopCamera(streamRef.current)
      streamRef.current = null
    },
    onForeground: () => {
      if (support === 'web' && !done.current) setRound((n) => n + 1)
    },
  })

  const again = () => {
    done.current = false
    setRound((n) => n + 1)
  }

  const toggleTorch = async () => {
    const next = torch !== 'on'
    const ok = await setTorch(streamRef.current?.getVideoTracks()[0], next)
    if (ok) setTorchState(next ? 'on' : 'off')
  }

  const openSettings = async () => {
    const result = await openSystemSettings()
    if (!result.opened) toast(S.scan.settingsFailed, { testid: 'remote-scan-settings' })
  }

  const enterInstead = (
    <Button block onPress={toConnect} testid="m-remote-scan-enter" el="R3.2">
      {S.scan.enterInstead}
    </Button>
  )

  let body
  if (phase === 'denied') {
    body = (
      <ErrorState
        icon={CameraOff}
        title={S.scan.deniedTitle}
        testid="m-remote-scan-denied"
        actions={
          <>
            <Button variant="primary" block onPress={() => void openSettings()} risk="leaves-app" testid="m-remote-scan-settings">
              {S.scan.openSettings}
            </Button>
            {enterInstead}
          </>
        }
      >
        {S.scan.deniedText}
      </ErrorState>
    )
  } else if (phase === 'failed') {
    body = (
      <ErrorState
        icon={CameraOff}
        title={S.scan.cameraFailedTitle}
        testid="m-remote-scan-failed"
        actions={
          <>
            <Button variant="primary" block onPress={again} risk="sensor" testid="m-remote-scan-again">
              {S.scan.again}
            </Button>
            {enterInstead}
          </>
        }
      >
        {S.scan.cameraFailedText}
      </ErrorState>
    )
  } else if (phase === 'none') {
    body = (
      <EmptyState
        icon={QrCode}
        title={S.scan.noScannerTitle}
        testid="m-remote-scan-none"
        actions={
          <Button variant="primary" block onPress={toConnect} testid="m-remote-scan-enter" el="R3.2">
            {S.scan.enterInstead}
          </Button>
        }
      >
        {appHasNoCamera() ? S.scan.noCameraText : S.scan.noScannerText}
      </EmptyState>
    )
  } else if (phase === 'closed' || phase === 'foreign' || phase === 'nocode') {
    body = (
      <EmptyState
        icon={ScanLine}
        title={phase === 'closed' ? S.scan.closedTitle : phase === 'nocode' ? S.scan.noCodeTitle : S.scan.wrongTitle}
        testid={phase === 'closed' ? 'm-remote-scan-closed' : phase === 'nocode' ? 'm-remote-scan-nocode' : 'm-remote-scan-foreign'}
        actions={
          <>
            <Button variant="primary" block onPress={again} risk="sensor" testid="m-remote-scan-again">
              {S.scan.again}
            </Button>
            {enterInstead}
          </>
        }
      >
        {phase === 'closed' ? S.scan.closedText : phase === 'nocode' ? S.scan.noCodeText : S.scan.wrongText}
      </EmptyState>
    )
  } else if (phase === 'found') {
    body = (
      <EmptyState icon={QrCode} title={S.scan.found(found)} testid="m-remote-scan-found" />
    )
  } else {
    // asking, starting, live
    body = (
      <>
        <div className="m-remote-scan-stage" data-testid="m-remote-scan-stage">
          {support === 'web' ? <video ref={videoRef} playsInline muted aria-label={S.scan.aim} /> : null}
          {phase === 'live' ? <span className="m-remote-scan-frame" aria-hidden="true" /> : <Progress label={S.scan.starting} testid="m-remote-scan-starting" />}
        </div>
        <p className="m-remote-scan-hint">{S.scan.aim}</p>
      </>
    )
  }

  const live = phase === 'asking' || phase === 'starting' || phase === 'live'
  return (
    <Page
      title={S.scan.title}
      screen="remote-scan"
      flush
      noBack
      actions={
        <>
          {torch !== 'none' && phase === 'live' ? (
            <IconButton
              icon={torch === 'on' ? FlashlightOff : Flashlight}
              label={torch === 'on' ? S.scan.torchOff : S.scan.torchOn}
              pressed={torch === 'on'}
              onPress={() => void toggleTorch()}
              testid="m-remote-scan-torch"
              el="R3.3"
            />
          ) : null}
          <IconButton icon={X} label={S.scan.close} onPress={() => void nav.back()} testid="m-remote-scan-close" el="R3.1" />
        </>
      }
      footer={live ? enterInstead : undefined}
    >
      <div className="m-remote-scan" data-testid="m-remote-scan-phase" data-m-phase={phase}>
        {body}
      </div>
    </Page>
  )
}
