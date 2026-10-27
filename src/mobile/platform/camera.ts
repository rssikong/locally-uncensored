/**
 * Camera: take a photo, scan a QR code.
 *
 * takePhoto uses the file input with `capture`, which opens the camera on
 * both platforms. scanQr has no web fallback worth shipping; until the native
 * command exists it fails with NativeUnavailableError and the screen offers
 * typing the address instead (DESIGN.md R3.2).
 */
import { tryBridge } from './bridge'
import { callNative, isNativeUnavailable } from './native'
import type { PickedFile } from './files'
import { pickFiles } from './files'

export async function takePhoto(): Promise<PickedFile | null> {
  const picked = await pickFiles({ accept: 'image/*', capture: 'environment' })
  return picked[0] ?? null
}

/**
 * Text of the scanned code, or null when the user closed the scanner.
 * Throws NativeUnavailableError when this build has no scanner; ask
 * qrScanSupport() first to decide whether to show the button at all.
 */
export async function scanQr(): Promise<string | null> {
  const viaBridge = await tryBridge((bridge) => bridge.scanQr?.())
  if (viaBridge.ok) {
    const value = viaBridge.value
    if (typeof value === 'string') return value || null
    return value?.text ?? null
  }
  const result = await callNative<{ text: string } | null>('scan_qr')
  return result?.text ?? null
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<Array<{ rawValue?: string }>>
}
type BarcodeDetectorCtor = new (options?: { formats?: string[] }) => BarcodeDetectorLike

function barcodeDetector(): BarcodeDetectorCtor | null {
  const ctor = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor }).BarcodeDetector
  return typeof ctor === 'function' ? ctor : null
}

export type QrScanSupport = 'native' | 'web' | 'none'

/**
 * How a QR code can be read on this device.
 *   native  scanQr() opens the scanner of the system
 *   web     no native scanner, but the WebView can read codes from a picture
 *           or a camera frame: use detectQr(source). Android has this, iOS not.
 *   none    offer typing the address (DESIGN.md R3.2)
 */
export async function qrScanSupport(): Promise<QrScanSupport> {
  try {
    const viaBridge = await tryBridge(async (bridge) => (typeof bridge.scanQr === 'function' ? true : undefined))
    if (viaBridge.ok) return 'native'
  } catch {
    /* fall through */
  }
  return barcodeDetector() ? 'web' : 'none'
}

/**
 * Read a QR code from a video frame, a picture or a canvas. Resolves null
 * when there is none in it or the WebView cannot detect codes. Never throws.
 */
export async function detectQr(source: CanvasImageSource): Promise<string | null> {
  const Detector = barcodeDetector()
  if (!Detector) return null
  try {
    const hits = await new Detector({ formats: ['qr_code'] }).detect(source)
    return hits.find((hit) => typeof hit.rawValue === 'string' && hit.rawValue)?.rawValue ?? null
  } catch {
    return null
  }
}

/** True when scanQr failed only because this build has no scanner. */
export function isScannerMissing(err: unknown): boolean {
  return isNativeUnavailable(err)
}
