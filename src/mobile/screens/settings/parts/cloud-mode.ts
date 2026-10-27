/**
 * Turning Cloud on and off, the one way for the whole phone app.
 *
 * The rule comes from the desktop (lib/cloud-switch-guard.ts): leaving Cloud
 * is one tap and never asks, entering needs a deliberate second step, and an
 * account that cannot use Cloud is sent to the gate. On the phone the second
 * step is the dialog G11, which stays under the finger, instead of a second
 * tap on the same spot. So the guard is always asked with `armed: false` for
 * the first tap and `armed: true` once the dialog was answered with yes.
 *
 * The first time, the consent sheet of the scaffold follows the dialog
 * (policy/consent.ts); declining it leaves the app on device.
 *
 * Each press is counted once, anonymously, unless the user switched the
 * counter off under Privacy (E17.1). The counter reads that switch itself
 * (api/cloud/switch-counter.ts), so no caller has to remember it.
 *
 * FOR OTHER STRANDS. Whoever moves the app into or out of Cloud calls
 * `enterCloud` or `leaveCloud` from this file and never writes `appMode`
 * itself: the model sheet, the voice gate, a sheet that offers "use an on
 * device model". Both take options for the cases those screens have
 * (mobile-docs/r2/settings.md has the examples). A guard test
 * (__tests__/cloud-mode-one-door.test.ts) lists the files that still write
 * `appMode` on their own and fails when a new one appears.
 */
import { countCloudSwitch } from '../../../../api/cloud/switch-counter'
import { cloudSwitchClick, type CloudSwitchAction } from '../../../../lib/cloud-switch-guard'
import { deriveCloudAvailable, useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { nav } from '../../../nav'
import { haptic } from '../../../platform'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { toast } from '../../../ui'
import { ensureAiConsent } from './policy'

const T = SETTINGS_STRINGS.cloudSwitch

function count(action: CloudSwitchAction): void {
  countCloudSwitch(action)
}

export interface LeaveCloudOptions {
  /** No toast "Back on device": the caller says it in its own words. */
  quiet?: boolean
}

export interface EnterCloudOptions {
  /** No toast "Cloud is on": the caller shows the result itself. */
  quiet?: boolean
  /**
   * Runs after the user agreed and right before the mode changes, for what
   * has to be in place by then (the model sheet remembers the Cloud model
   * that was tapped, so the switch does not pick another one).
   */
  beforeSwitch?: () => void
}

export function cloudIsOn(): boolean {
  return useSettingsStore.getState().settings.appMode === 'cloud'
}

export function cloudIsAvailable(): boolean {
  return deriveCloudAvailable(useCloudAuthStore.getState())
}

/** One tap goes back on device. Never asks. Returns whether the mode changed. */
export function leaveCloud(options: LeaveCloudOptions = {}): boolean {
  if (!cloudIsOn()) return false
  count('leave-cloud')
  useSettingsStore.getState().updateSettings({ appMode: 'local' })
  if (!options.quiet) toast(T.backOnDevice, { testid: 'cloud-off' })
  return true
}

/**
 * Ask "Switch to Cloud?" (G11) and switch on yes. Without a usable account
 * it opens the gate E3 instead. Resolves true when the app is in Cloud after.
 */
export async function enterCloud(options: EnterCloudOptions = {}): Promise<boolean> {
  if (cloudIsOn()) return true
  const first = cloudSwitchClick({ on: false, available: cloudIsAvailable(), armed: false })
  if (first === 'open-gate') {
    count('open-gate')
    nav.push('/cloud')
    return false
  }
  count('arm')
  const yes = await nav.confirm({
    title: T.question,
    text: T.text,
    confirmLabel: T.confirm,
    cancelLabel: T.stay,
    tone: 'cloud',
    // Turning the mode on costs nothing; each paid send carries its own mark.
    risk: 'none',
    testid: 'cloud-switch',
  })
  if (!yes) return false
  // Store duty (STORE-BAUSTEINE.md 3.2): nothing goes to LU Cloud before the user agreed, once.
  if (!(await ensureAiConsent())) return false
  // The account may have changed while the dialog was open.
  const second = cloudSwitchClick({ on: cloudIsOn(), available: cloudIsAvailable(), armed: true })
  if (second !== 'enter-cloud') {
    if (second === 'open-gate') nav.push('/cloud')
    return cloudIsOn()
  }
  count('enter-cloud')
  options.beforeSwitch?.()
  useSettingsStore.getState().updateSettings({ appMode: 'cloud' })
  haptic('success')
  if (!options.quiet) toast(T.nowCloud, { testid: 'cloud-on' })
  return true
}

export function toggleCloud(next: boolean): void {
  if (next) void enterCloud()
  else leaveCloud()
}
