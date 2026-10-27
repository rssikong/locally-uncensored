/**
 * Extra sheets of the strand "settings".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Use the strand name as a
 * prefix so two strands never pick the same id:
 *
 *   'settings-example': { code: 'X1', title: 'Example', owner: 'settings' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   'settings-example': () => import('./ExampleSheet'),
 *
 * Then nav.openSheet('settings-example', props) is known to the compiler.
 */
import { defineSheets } from '../../nav/define'

export const SETTINGS_SHEETS = defineSheets({
  // E20.2. A sheet and not a page: an extra page trips the scaffold test
  // "a page file of a strand lies in the folder of that strand", which counts
  // only the loaders written in nav/loaders.ts (see geruest-wuensche/settings.md).
  'settings-licenses': { code: 'E20', title: 'Licenses', owner: 'settings' },
  // Store duty (account deletion inside the app). A sheet for the same reason as the one above.
  'settings-delete-account': { code: 'E2', title: 'Delete account', owner: 'settings' },
  // E2.7 "Forgot password?": the request for the reset mail, a step of its own inside the app.
  'settings-forgot-password': { code: 'E2', title: 'Reset password', owner: 'settings' },
  // Comes up when the link of that mail brought the user back into the app.
  'settings-new-password': { code: 'E2', title: 'Choose a new password', owner: 'settings' },
  // Round 17: credits as an in-app purchase of the system (store switch purchase 'in-app', iOS, in no preset).
  // A build that does not offer it shows "Not part of this version" here; no button leads to the sheet there.
  'settings-add-credits': { code: 'E2', title: 'Credits', owner: 'settings' },
  // Round 51, D4: "Get LU Cloud" on the page LU Cloud opens the three plans. Only a build with buy links has the button;
  // anywhere else the sheet says "Not part of this version".
  'settings-cloud-plans': { code: 'E3', title: 'Plans', owner: 'settings' },
})
