/**
 * Things of this strand that have to run while the app runs, not only while
 * a settings page is open:
 *
 *  - G6: the account went from signed in to signed out without the user
 *    asking for it. The logic layer tries to renew the token first; when the
 *    server then says no, the store flips, and the sheet "Please sign in
 *    again" comes up. A start without network does not flip it (the logic
 *    layer keeps the session as "offline"), so one dead zone never costs the
 *    session.
 *  - E21: the notes of a new version open once.
 *  - E2.7: the link of a reset mail came back; "Choose a new password" opens.
 *
 * MobileRoot mounts the hook once (AppServices), so both run from the start
 * of the app, whatever page is open. No screen calls it; a guard in
 * src/mobile/__tests__/geruest-verdrahtung.test.ts watches that.
 */
import { useEffect } from 'react'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useReleaseNotesStore } from '../../../../stores/releaseNotesStore'
import { useSettingsStore } from '../../../../stores/settingsStore'
import { nav } from '../../../nav'
import { APP_VERSION } from './app-info'
import { isSigningOutOnPurpose } from './auth'
import { armPasswordRecovery } from './password-reset'
import { armSessionLog } from './session-log'
import { shouldShowMobileNotes } from './whats-new'

let armed = false

/** Pure: did the session end without the user ending it. */
export function sessionEndedUnasked(
  prev: { status: string; offline?: boolean },
  next: { status: string },
  onPurpose: boolean,
): boolean {
  return prev.status === 'signed-in' && next.status === 'signed-out' && !onPurpose
}

function sheetIsOpen(id: string): boolean {
  return nav.getState().overlays.some((o) => o.kind === 'sheet' && o.sheet === id)
}

function arm(): void {
  if (armed) return
  armed = true
  armSessionLog()
  // "Forgot password?": the link of the reset mail leads back into the app, and then the new password is asked for.
  armPasswordRecovery()

  useCloudAuthStore.subscribe((state, prev) => {
    if (!sessionEndedUnasked(prev, state, isSigningOutOnPurpose())) return
    if (nav.getState().flow) return
    if (sheetIsOpen('session')) return
    nav.openSheet('session')
  })

  // The notes of this version, once. Asked a moment after start so the first page is up.
  window.setTimeout(() => {
    const seen = useReleaseNotesStore.getState().lastNotesVersion
    const done = useSettingsStore.getState().settings.onboardingDone
    if (nav.getState().flow) return
    if (!shouldShowMobileNotes(APP_VERSION, seen, done)) return
    if (seen === null) {
      // A first install has nothing "new" to be told: remember the version quietly.
      useReleaseNotesStore.getState().markNotesSeen(APP_VERSION)
      return
    }
    nav.push('/whats-new')
  }, 800)
}

export function useSettingsServices(): void {
  useEffect(() => {
    arm()
  }, [])
}

/** Only for tests. */
export function __resetSettingsServicesForTests(): void {
  armed = false
}
