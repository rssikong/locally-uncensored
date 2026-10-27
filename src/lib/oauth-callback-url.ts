// The address a phone comes back to after signing in with Google or GitHub,
// and how to read it.
//
// The desktop listens on a 127.0.0.1 port while the browser is in front. A
// phone cannot: the system freezes the app the moment the browser opens, and
// nothing leads back into it. So the provider redirects to a link the system
// hands to this app, `lu://oauth/callback?code=...`, and the app reads the
// PKCE code from it. That works on a running app and on a cold start alike,
// because the verifier for the code lives in the session store, not in memory.
//
// This file is the pure half: constants and parsing, no network, no store.
// The exchange is api/cloud/supabase.ts (handleOAuthCallbackUrl), the door for
// incoming links is lib/incoming-url.ts.

/** Registered in the Supabase redirect allow list (work for David, see
 *  MOBILE-ZIEL.md section 4) and as the app's URL scheme on both platforms. */
export const MOBILE_OAUTH_REDIRECT = 'lu://oauth/callback'

export type OAuthCallback =
  /** Not ours: some other link, or no link at all. */
  | { kind: 'not-oauth' }
  /** The provider sent a code to exchange. */
  | { kind: 'code'; code: string }
  /** The provider (or the user) ended the sign-in. `params` carries what the
   *  redirect said, for the caller to turn into a sentence. */
  | { kind: 'error'; params: URLSearchParams }

const CALLBACK_RE = /^lu:\/\/oauth\/callback\/?(?=[?#]|$)/i

/** Is this the sign-in link, whatever it carries? */
export function isOAuthCallbackUrl(url: unknown): url is string {
  return typeof url === 'string' && CALLBACK_RE.test(url.trim())
}

/**
 * Read a link the system handed to the app. Pure: no network, no state.
 *
 * Parsed by hand instead of with `new URL`: `lu:` is not a scheme the URL
 * parser knows, and what it makes of host and path for an unknown scheme
 * differs between WebKit, the Android WebView and Node.
 *
 * The parameters may sit behind `?` or behind `#`; both are read, and the
 * query wins when both carry a value.
 */
export function parseOAuthCallbackUrl(url: unknown): OAuthCallback {
  if (!isOAuthCallbackUrl(url)) return { kind: 'not-oauth' }
  const rest = url.trim().replace(CALLBACK_RE, '')
  const hashAt = rest.indexOf('#')
  const query = (hashAt >= 0 ? rest.slice(0, hashAt) : rest).replace(/^\?/, '')
  const fragment = hashAt >= 0 ? rest.slice(hashAt + 1) : ''
  const params = new URLSearchParams(fragment)
  for (const [key, value] of new URLSearchParams(query)) params.set(key, value)
  const code = params.get('code')
  if (code) return { kind: 'code', code }
  return { kind: 'error', params }
}
