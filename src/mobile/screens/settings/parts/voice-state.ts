/**
 * Whether dictation works right now, and if not, the one reason (E11).
 *
 * Dictation has no switch of its own. The microphone button in the message
 * box shows whenever it can work, so the settings page states that condition
 * instead of offering a switch that would switch nothing. Pure.
 */
export type DictationState = 'ready' | 'checking' | 'blocked' | 'signed-out' | 'no-plan' | 'offline'

export interface DictationInput {
  /** The account is still being read. */
  probing: boolean
  signedIn: boolean
  /** Signed in with a plan that can use LU Cloud. */
  cloudUsable: boolean
  /** The system refused the microphone for LU. */
  micDenied: boolean
  online: boolean
}

/** The first thing that stands in the way, in the order the user can fix it. */
export function dictationState(input: DictationInput): DictationState {
  if (input.probing) return 'checking'
  if (!input.signedIn) return 'signed-out'
  if (!input.cloudUsable) return 'no-plan'
  if (input.micDenied) return 'blocked'
  if (!input.online) return 'offline'
  return 'ready'
}
