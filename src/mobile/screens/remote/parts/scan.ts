/**
 * What a scan means, and the camera of the WebView as a small machine.
 *
 * Two ways to a code (platform/camera.ts decides which one this phone has):
 *   native  the scanner of the system, one call, one answer
 *   web     the camera picture in the page, read frame by frame
 * Both end in a text, and interpretScan says what that text is.
 */
import { displayAddress, parsePairingInput, type PairingTarget } from '../../../remote/pairingLink'

export type ScanReading =
  /** The text is an address of LU Remote Access. */
  | { kind: 'desktop'; target: PairingTarget; address: string; text: string }
  /** A code, but not one of ours (a web address of something else is caught by the probe later, a plain text here). */
  | { kind: 'foreign' }

/** Pure: read what the scanner returned. */
export function interpretScan(text: string | null | undefined): ScanReading {
  const clean = (text ?? '').trim()
  const target = clean ? parsePairingInput(clean) : null
  if (!target) return { kind: 'foreign' }
  return { kind: 'desktop', target, address: displayAddress(target.baseUrl), text: clean }
}

export type CameraFailure = 'denied' | 'failed'

/** Pure: why getUserMedia refused. A missing permission has its own screen with the way into the settings. */
export function cameraFailure(err: unknown): CameraFailure {
  const name = (err as { name?: string } | null)?.name ?? ''
  return name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError' ? 'denied' : 'failed'
}

interface TorchTrack {
  getCapabilities?: () => { torch?: boolean }
  applyConstraints: (constraints: { advanced: Array<{ torch: boolean }> }) => Promise<void>
}

/** True when the camera behind this track has a light the page can switch. */
export function hasTorch(track: MediaStreamTrack | undefined): boolean {
  try {
    return !!(track as unknown as TorchTrack | undefined)?.getCapabilities?.().torch
  } catch {
    return false
  }
}

/** Switch the light. Resolves false when the camera refused, so the button never shows a state that is not real. */
export async function setTorch(track: MediaStreamTrack | undefined, on: boolean): Promise<boolean> {
  if (!track) return false
  try {
    await (track as unknown as TorchTrack).applyConstraints({ advanced: [{ torch: on }] })
    return true
  } catch {
    return false
  }
}

/** Open the back camera. Throws what getUserMedia throws; a WebView without it counts as failed. */
export async function openCamera(): Promise<MediaStream> {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!media || typeof media.getUserMedia !== 'function') throw new Error('no camera api')
  return media.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
}

export function stopCamera(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) {
    try {
      track.stop()
    } catch {
      /* already stopped */
    }
  }
}
