/**
 * Show the page of Google or GitHub on a phone, for the sign-in.
 *
 * Two ways, both through the plugin lu-native and nothing else:
 *
 * - iPhone and iPad: the sign-in sheet of the system
 *   (ASWebAuthenticationSession, command `web_auth`). The user never leaves
 *   the app, and the sheet itself hands back the link the provider ended on,
 *   `lu://oauth/callback?code=...`. No deep link follows.
 * - Android, and an iOS app older than the command: the browser of the
 *   system (command `open_external`, the opener every other link of the
 *   phone shell takes). The link comes back through the system as a deep
 *   link (lib/incoming-url.ts).
 *
 * Never `plugin:shell|open`: that command starts a program, and an iPhone
 * has none to start. It answered "No such file or directory" there, the
 * page went on saying "Waiting for your browser", and no browser came
 * (check on the iPhone, round 22, N5).
 *
 * A leaf on purpose: the native bridge is loaded at the call, so the desktop
 * pays nothing for importing this file.
 */
import { commandIsUnavailable } from './engine-command-availability'
import { MOBILE_OAUTH_REDIRECT } from './oauth-callback-url'

/** The scheme of MOBILE_OAUTH_REDIRECT, which the sheet of the system watches for. */
export const OAUTH_CALLBACK_SCHEME = MOBILE_OAUTH_REDIRECT.slice(0, MOBILE_OAUTH_REDIRECT.indexOf(':'))

export type PhoneOAuthPage =
  /** A browser is in front. The link comes back through the system. */
  | { kind: 'opened' }
  /** The sheet of the system closed with this link. */
  | { kind: 'returned'; url: string }
  /** The user closed the sheet. Not an error. */
  | { kind: 'cancelled' }

/** The two doors of the native bridge this file uses (src/lib/lu-native.ts). */
export interface PhoneOAuthDoors {
  webAuth?: (url: string, callbackScheme: string) => Promise<string | null>
  openExternal: (url: string) => Promise<void>
}

/**
 * Resolves with what is on screen now. Rejects when nothing could be shown:
 * the caller must then not wait for a link.
 */
export async function showPhoneOAuthPage(url: string, doors?: PhoneOAuthDoors): Promise<PhoneOAuthPage> {
  const native: PhoneOAuthDoors = doors ?? (await import('./lu-native'))
  if (typeof native.webAuth === 'function') {
    try {
      const back = await native.webAuth(url, OAUTH_CALLBACK_SCHEME)
      return back === null ? { kind: 'cancelled' } : { kind: 'returned', url: back }
    } catch (err) {
      // Only an app that does not have the command yet takes the browser.
      // A sheet that failed has failed: a second page on top would hide why.
      if (!commandIsUnavailable(err)) throw err
    }
  }
  await native.openExternal(url)
  return { kind: 'opened' }
}
