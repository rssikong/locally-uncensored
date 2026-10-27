/**
 * SLOT in C1 and K1, filled by strand 5 (Account, cloud, settings).
 *
 * G11, the Cloud switch at the top right of the roots Chat and Create. Off to
 * on asks "Switch to Cloud?" in a dialog, on to off switches at once with the
 * toast "Back on device", and an account without a plan lands on the gate
 * /cloud (E3). The rules live in parts/cloud-mode.ts, which follows
 * src/lib/cloud-switch-guard.ts.
 *
 * Hidden while the user switched "Show Cloud features while on device" off
 * (E4.3) and Cloud is off: that switch exists to take Cloud out of sight.
 */
import { useSettingsStore } from '../../../../stores/settingsStore'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Switch } from '../../../ui'
import { toggleCloud } from '../parts/cloud-mode'

const T = SETTINGS_STRINGS.cloudSwitch

export function CloudSwitch() {
  const on = useSettingsStore((s) => s.settings.appMode === 'cloud')
  const teasers = useSettingsStore((s) => s.settings.cloudTeasersEnabled !== false)
  if (!on && !teasers) return null
  return (
    <Switch pill tone="cloud" checked={on} onChange={toggleCloud} label={on ? T.nameOn : T.nameOff} testid="m-cloud-switch" el="G11">
      {T.label}
    </Switch>
  )
}
