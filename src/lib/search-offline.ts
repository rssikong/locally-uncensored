/**
 * A search that did not run because the device has no network.
 *
 * Second check on Android, F7. In flight mode "Test search" read
 *   "... could not connect (failed to lookup address information: No address
 *    associated with hostname). The free search is not dependable. Add a
 *    Brave or Tavily key ..."
 * which is the text of the system, followed by advice that does not fit: a
 * key reaches nothing without a network either. In the chat the model got
 * the same text as the result of its tool and wrote "the search function is
 * not working properly, try again later".
 *
 * Here the two signs of "no network" are read, and there is one sentence for
 * the model. The one for the person is a text of the phone app
 * (mobile/strings/agent.ts, search.testOffline). Used on a phone only (the callers ask
 * isMobile): the desktop keeps the text of the search command.
 *
 * Pure apart from `deviceSaysOffline`, which reads the navigator.
 */

/**
 * What the model reads as the result of its tool. It says what happened and
 * what to tell the user, so a small model does not report a broken search
 * or answer from memory as if it had looked something up.
 */
export const SEARCH_OFFLINE_TOOL_RESULT =
  'Error: The web search did not run because this device has no internet connection right now. Nothing was looked up. Tell the user that there is no internet connection and that the search can be tried again once the device is online. Do not present anything as a search result.'

/** The same for reading one page. */
export const FETCH_OFFLINE_TOOL_RESULT =
  'Error: The page was not read because this device has no internet connection right now. Tell the user that there is no internet connection and that it can be tried again once the device is online.'

/**
 * How a request that never left the device reads, in the words of the
 * systems the app runs on: the name of the host could not be looked up, or
 * there is no route at all. A server that refuses, a timeout, a bot check or
 * an HTTP status are answers from somewhere and not meant here.
 */
const NO_NETWORK =
  /failed to lookup address|no address associated with hostname|nodename nor servname|name or service not known|temporary failure in name resolution|dns error|name resolution|network is unreachable|network unreachable|no route to host|network is down|internet connection appears to be offline|not connected to the internet|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/i

/** Pure: does this reason say that the request never left the device. */
export function reasonSaysNoNetwork(reason: unknown): boolean {
  return typeof reason === 'string' && NO_NETWORK.test(reason)
}

interface AnswerLike {
  results?: unknown
  error?: unknown
  providerError?: unknown
  tiers?: Array<{ tier?: unknown; error?: unknown }> | unknown
}

/**
 * Pure: did this search fail because there is no network. True only when it
 * found nothing and EVERY search that was asked failed that way: one that got
 * a bot check or an HTTP error reached the internet, and then the reasons of
 * the command are the honest text.
 */
export function searchFailedOffline(answer: AnswerLike | null | undefined): boolean {
  if (!answer || typeof answer !== 'object') return false
  if (Array.isArray(answer.results) && answer.results.length > 0) return false
  const tiers = Array.isArray(answer.tiers) ? answer.tiers : []
  const reasons: unknown[] = tiers.map((t) => (t && typeof t === 'object' ? (t as { error?: unknown }).error : undefined))
  if (typeof answer.providerError === 'string' && answer.providerError) reasons.push(answer.providerError)
  // An answer without the list of tiers (an older command, a thrown error) has only its one text.
  if (reasons.length === 0) return reasonSaysNoNetwork(answer.error)
  return reasons.every(reasonSaysNoNetwork)
}

/** Does the device itself say it has no network. False where nobody can say (no navigator). */
export function deviceSaysOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}
