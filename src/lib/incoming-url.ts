// The door for links the system hands to the app.
//
// On a phone the native side learns about a link in two ways: the app was
// started by it (cold start), or it arrived while the app was running. The
// mobile shell reports both here, with the same call:
//
//     await reportIncomingUrl(url)
//
// The sign-in callback is taken care of in here, so the shell does not have
// to know what a PKCE code is. Anything else goes to the listeners (a later
// deep link into a chat, a shared file).

import { isOAuthCallbackUrl } from './oauth-callback-url'
import { log } from './logger'

type UrlHandler = (url: string) => boolean | Promise<boolean>

const handlers = new Set<UrlHandler>()

/** Register a handler for links that are not the sign-in callback. Return
 *  true from it when the link was yours. */
export function onIncomingUrl(handler: UrlHandler): () => void {
  handlers.add(handler)
  return () => { handlers.delete(handler) }
}

/**
 * Report a link the system handed to the app. Call it for the launch link at
 * start and for every link that arrives later. Returns true when something
 * took it. Never throws.
 */
export async function reportIncomingUrl(url: string | null | undefined): Promise<boolean> {
  if (typeof url !== 'string' || !url.trim()) return false
  if (isOAuthCallbackUrl(url)) {
    try {
      // Loaded on demand: the door must be open before the account code is.
      const { handleOAuthCallbackUrl } = await import('../api/cloud/supabase')
      return (await handleOAuthCallbackUrl(url)).handled
    } catch (err) {
      log.warn('[incoming-url] the sign-in link could not be handled', { err: String(err) })
      return false
    }
  }
  for (const handler of [...handlers]) {
    try {
      if (await handler(url)) return true
    } catch (err) {
      log.warn('[incoming-url] a link handler failed', { err: String(err) })
    }
  }
  return false
}
