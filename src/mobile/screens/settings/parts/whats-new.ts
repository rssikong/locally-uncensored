/**
 * When "What is new" (E21) opens by itself: once per version, never during
 * the onboarding, never for a version without notes. Pure, so the rule is a
 * unit test. The seen version lives in the shared releaseNotesStore, the
 * texts are the phone's own (strings/release-notes.ts).
 */
import { mobileReleaseNoteFor } from '../../../strings/release-notes'

export function shouldShowMobileNotes(currentVersion: string, lastSeen: string | null, onboardingDone: boolean): boolean {
  if (!onboardingDone) return false
  if (!mobileReleaseNoteFor(currentVersion)) return false
  return lastSeen !== currentVersion
}
