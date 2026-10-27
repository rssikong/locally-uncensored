/**
 * One gate in front of every way content goes to LU Cloud outside the chat
 * send: dictation, read-aloud through the cloud voice, the memory sync
 * (durchsicht-mobile M1).
 *
 * The consent itself lives with the phone shell (src/mobile/policy/consent.ts,
 * a sheet, saved on the phone). The shared hooks and API files must not
 * import the shell, so the shell installs its consent here at boot and the
 * shared code asks this file. The desktop installs nothing: there the answer
 * is always yes and nothing changes.
 */
export interface CloudContentGate {
  /** Consent is given right now. Never shows anything. */
  has: () => boolean
  /** Resolve true when content may go. May show the consent sheet. */
  ensure: () => Promise<boolean>
}

let gate: CloudContentGate | null = null

/** The phone shell hands in its consent. Returns the uninstall. */
export function installCloudContentGate(next: CloudContentGate): () => void {
  gate = next
  return () => {
    if (gate === next) gate = null
  }
}

/** May content go to LU Cloud, without asking anybody. */
export function cloudContentConsented(): boolean {
  try {
    return gate ? gate.has() : true
  } catch {
    return false
  }
}

/** May content go to LU Cloud. Asks the user when the answer is still open. */
export async function cloudContentAllowed(): Promise<boolean> {
  if (!gate) return true
  try {
    return await gate.ensure()
  } catch {
    // A gate that broke is a no: nothing leaves without a yes.
    return false
  }
}

/** Thrown by a cloud call that was stopped because the user has not agreed. */
export class CloudConsentError extends Error {
  constructor(message = 'Nothing was sent. LU Cloud needs your consent first.') {
    super(message)
    this.name = 'CloudConsentError'
  }
}

/**
 * The backstop inside the API calls themselves: no consent, no request. It
 * never opens a sheet (the caller on screen asked before), it only refuses.
 */
export function assertCloudContentConsent(): void {
  if (!cloudContentConsented()) throw new CloudConsentError()
}
