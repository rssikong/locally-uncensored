/**
 * The three checks of "Troubleshooting" (E19): engine, internet, LU Cloud.
 * Each one ends in a light and one sentence that says what to do.
 */
import { CLOUD_BASE } from '../../../../api/cloud/config'
import { bundledEngineStatus } from '../../../../api/engine'
import { hasNativeBridge, isOnline } from '../../../platform'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { modelNameFromPath, shownModelName } from './diagnostics'

const T = SETTINGS_STRINGS.troubleshooting

export type Light = 'ok' | 'warn' | 'bad' | 'busy'

export interface CheckResult {
  light: Light
  text: string
}

export function lightWord(light: Light): string {
  if (light === 'ok') return T.stateOk
  if (light === 'warn') return T.stateWarn
  if (light === 'bad') return T.stateBad
  return T.stateBusy
}

/** Pure: the engine line from what the engine said. `undefined` means it could not be asked at all. */
export function engineCheck(native: boolean, status: { running: boolean; healthy: boolean; model_path: string | null } | null | undefined): CheckResult {
  if (!native) return { light: 'warn', text: T.engineUnavailable }
  if (!status) return { light: 'bad', text: T.engineDown }
  if (!status.running) return { light: 'ok', text: T.engineIdle }
  if (!status.healthy) return { light: 'bad', text: T.engineDown }
  const model = modelNameFromPath(status.model_path)
  return { light: 'ok', text: model ? T.engineReady(shownModelName(model)) : T.engineIdle }
}

export function internetCheck(online: boolean): CheckResult {
  return online ? { light: 'ok', text: T.internetOk } : { light: 'warn', text: T.internetOff }
}

/** Pure: the cloud line. `status` is the HTTP status of the answer, null when there was none. */
export function cloudCheck(online: boolean, status: number | null, signedIn: boolean): CheckResult {
  if (!online) return { light: 'warn', text: T.cloudOffline }
  if (status === null || status >= 500) return { light: 'bad', text: T.cloudDown }
  return { light: 'ok', text: signedIn ? T.cloudSignedIn : T.cloudOk }
}

export async function runEngineCheck(): Promise<CheckResult> {
  const native = hasNativeBridge()
  if (!native) return engineCheck(false, null)
  try {
    return engineCheck(true, await bundledEngineStatus())
  } catch {
    return engineCheck(true, null)
  }
}

/**
 * Is LU Cloud there at all. Asked without the account, so it also answers
 * for a signed out user, and as an opaque request: any answer of the server
 * counts, only a request that reaches nothing fails.
 */
export async function runCloudCheck(signedIn: boolean): Promise<CheckResult> {
  const online = isOnline()
  if (!online) return cloudCheck(false, null, signedIn)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(`${CLOUD_BASE}/api/me`, { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    // An opaque answer has status 0: the server spoke, which is all that is asked here.
    return cloudCheck(true, res.type === 'opaque' ? 200 : res.status, signedIn)
  } catch {
    return cloudCheck(true, null, signedIn)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Pure: what "Reset all settings" asks. "You stay signed in" is only said to
 * someone who is signed in (second check on Android, F13).
 */
export function resetAllText(signedIn: boolean): string {
  return signedIn ? T.resetTextSignedIn : T.resetText
}
