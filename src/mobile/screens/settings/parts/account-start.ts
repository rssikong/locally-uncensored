/**
 * Which segment the page Account (E2) opens on, asked once.
 *
 * Always "Sign in" (E2.1), except right after the button "Create account" of
 * the page LU Cloud (round 51, decision D3): that button asks for the other
 * segment, and the page takes the wish when it draws its form and forgets it
 * at once. The route stays without parameters (nav/routes.ts belongs to the
 * scaffold).
 */
let wanted: 'signup' | null = null

/** The next form of the page Account starts on "Create account". */
export function startAccountOnSignUp(): void {
  wanted = 'signup'
}

/** The segment the form starts on, and the wish is gone. */
export function takeAccountStart(): 'signin' | 'signup' {
  const mode = wanted ?? 'signin'
  wanted = null
  return mode
}
