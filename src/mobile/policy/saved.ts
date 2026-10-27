/**
 * The few answers of the store building blocks that outlive the session:
 * the age declaration, the consent to LU Cloud, the reports that wait.
 * One value per key in localStorage, and a way to hear a change.
 * Never throws: a blocked or full storage counts as "nothing saved".
 */
type Listener = () => void
const listeners = new Set<Listener>()

export function readSaved(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key)
  } catch {
    return null
  }
}

/** Returns false when the value could not be written. */
export function writeSaved(key: string, value: string | null): boolean {
  let ok = true
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    ok = false
  }
  for (const fn of [...listeners]) fn()
  return ok
}

export function onSavedChange(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
