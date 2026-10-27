import { useEffect, useState } from 'react'
import { qrScanSupport, type QrScanSupport } from '../../../platform/camera'
import { mobileOS, type MobileOS } from '../../../platform/detect'
import { hasNativeBridge } from '../../../platform/native'

let known: QrScanSupport | null = null

/**
 * Pure: what the answer of the platform means for this app.
 *
 * Inside the Android app the camera picture inside the page is never used:
 * it needs the CAMERA permission, which the app does not declare on purpose
 * (AndroidManifest.xml). The WebView still says it can read codes, and that
 * button led to "This phone cannot scan codes inside LU" (acceptance
 * android-knoepfe, M11). Since round 57 the native layer scans there too,
 * with one photo of the system camera app (David: Android gets "Scan QR code
 * instead" like iOS). So in the app only 'native' counts, anything else is
 * 'none'. A browser tab on Android keeps its answer, it can ask for the camera.
 */
export function scanSupportFor(answer: QrScanSupport, os: MobileOS, inApp: boolean): QrScanSupport {
  if (os === 'android' && inApp) return answer === 'native' ? 'native' : 'none'
  return answer
}

/**
 * How this phone can read a QR code: 'native', 'web' or 'none'. Null until
 * the answer is in; a button that depends on it is not shown before.
 */
export function useScanSupport(): QrScanSupport | null {
  const [support, setSupport] = useState<QrScanSupport | null>(known)
  useEffect(() => {
    if (known) return
    let alive = true
    void qrScanSupport()
      .catch(() => 'none' as const)
      .then((answer) => {
        known = scanSupportFor(answer, mobileOS(), hasNativeBridge())
        if (alive) setSupport(known)
      })
    return () => {
      alive = false
    }
  }, [])
  return support
}

/** True where the app has no camera to ask for: the sentence on the scan page says so instead of pointing at the settings. */
export function appHasNoCamera(): boolean {
  return mobileOS() === 'android' && hasNativeBridge()
}

/** Only for tests. */
export function __resetScanSupportForTests(): void {
  known = null
}
