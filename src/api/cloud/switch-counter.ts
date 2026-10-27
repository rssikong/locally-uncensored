/**
 * The anonymous counter of the Cloud switch, with its opt out.
 *
 * `reportCloudSwitch` (api/funnel.ts) counts a press and knows nothing about
 * a preference. It also counts the press a second time per account when
 * somebody is signed in. The phone promises an anonymous counter ("No
 * account, no content"), so it sends the anonymous half only
 * (`reportCloudSwitchAnonymous`): no session, no token, whoever is signed in.
 *
 * On the phone the user can switch the counter off (Settings, Privacy), and the place that obeys that switch has to be the counter
 * itself: a screen that changes the mode on its own must not have to remember
 * it. So everything on the phone that enters or leaves Cloud counts through
 * `countCloudSwitch`, never through `reportCloudSwitch`; a guard test in
 * src/mobile/screens/settings/__tests__ keeps it that way.
 *
 * On the desktop the preference does not exist, the answer is "count", and
 * the desktop keeps calling `reportCloudSwitch` as before.
 */
import { reportCloudSwitchAnonymous } from '../funnel'
import type { CloudSwitchAction } from '../../lib/cloud-switch-guard'
import { cloudSwitchCounterAllowed } from '../../lib/mobile-prefs'

/** Count one press, unless the user opted out. Fire and forget, never throws. Returns whether it was counted. */
export function countCloudSwitch(action: CloudSwitchAction): boolean {
  if (!cloudSwitchCounterAllowed()) return false
  try {
    reportCloudSwitchAnonymous(action)
  } catch {
    /* the switch never waits on the counter and never hears from it */
  }
  return true
}
