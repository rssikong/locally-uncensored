/**
 * The upper limit a BUILD puts on the content policy of an account
 * (durchsicht-mobile M6).
 *
 * The content policy (Strict, Standard, Off) belongs to the LU Cloud account
 * and is set on the website. A store build of the phone app must not offer
 * "Off" (store presets `no-off` and `fixed-filter`, src/mobile/policy). Hiding
 * the choice is not enough: an account that was set to Off on the website
 * would still be unfiltered in such a build. So the build carries a cap, and
 * what the app works with is the stricter of the two:
 *
 *   effectiveContentPolicy(account) = the stricter of account and cap
 *
 * Where it bites:
 *   - the check of a Create prompt before anything is uploaded
 *     (hooks/useCloudCreate.ts clientSafety) runs with the capped level, so
 *     a stored "Off" has no effect in such a build;
 *   - every cloud job carries the cap as `params.content_policy_cap`, a
 *     number (0 strict, 1 soft; api/cloud/jobs.ts), for the server to take the stricter of the two.
 *     The server does not read it yet (wish in
 *     mobile-docs/geruest-wuensche/server.md); until it does, the check in
 *     the app is the one that holds.
 *
 * The phone shell installs the cap at boot. The desktop installs nothing and
 * every function here answers as if this file did not exist.
 */
/** The three levels of the account. Defined here, api/cloud/jobs.ts hands it on, so the two files do not import each other. */
export type ContentPolicy = 'strict' | 'soft' | 'off'

/** Strictest first. */
const ORDER: readonly ContentPolicy[] = ['strict', 'soft', 'off']

/** The level as the number a cloud job carries: 0 strict, 1 soft, 2 off. */
export const CONTENT_POLICY_RANK: Readonly<Record<ContentPolicy, number>> = { strict: 0, soft: 1, off: 2 }

let source: (() => ContentPolicy | null) | null = null

/** Hand in where the cap of this build comes from. Returns the uninstall. */
export function installContentPolicyCap(next: () => ContentPolicy | null): () => void {
  source = next
  return () => {
    if (source === next) source = null
  }
}

/** The cap of this build, or null when the build has none. */
export function contentPolicyCap(): ContentPolicy | null {
  try {
    const cap = source ? source() : null
    return cap && ORDER.includes(cap) ? cap : null
  } catch {
    return null
  }
}

/** Pure: the stricter of two levels. */
export function stricterPolicy(a: ContentPolicy, b: ContentPolicy): ContentPolicy {
  return ORDER.indexOf(a) <= ORDER.indexOf(b) ? a : b
}

/**
 * The level the app works with. With a cap the answer is never looser than
 * the cap, also while the account's own level is still unknown (null). Without
 * a cap the account's level comes back unchanged, null included.
 */
export function effectiveContentPolicy(account: ContentPolicy | null): ContentPolicy | null {
  const cap = contentPolicyCap()
  if (!cap) return account
  return account ? stricterPolicy(account, cap) : cap
}
