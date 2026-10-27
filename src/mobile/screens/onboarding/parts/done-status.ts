/**
 * The sentence of the last onboarding step (A4): which model, and how far it
 * is. Pure, so it can be tested without the stores.
 */
export type DoneKind = 'ready' | 'downloading' | 'paused' | 'cloud' | 'none'

export interface DoneInput {
  /** Bare names of the chat models on this phone. */
  installed: readonly string[]
  /** Bare name of the model picked in A2, or null. */
  picked: string | null
  /** Open downloads of chat models: bare name and whether the transfer is moving. */
  open: ReadonlyArray<{ name: string; moving: boolean }>
  signedIn: boolean
}

export interface DoneStatus {
  kind: DoneKind
  /** Bare name of the model the sentence talks about, or null. */
  model: string | null
}

/** The sentence of A4: which model, and how far it is. Pure. */
export function doneStatus(input: DoneInput): DoneStatus {
  const { installed, picked, open, signedIn } = input
  if (picked && installed.includes(picked)) return { kind: 'ready', model: picked }
  const mine = open.find((row) => row.name === picked) ?? open[0]
  if (mine) return { kind: mine.moving ? 'downloading' : 'paused', model: mine.name }
  if (installed.length > 0) return { kind: 'ready', model: installed[0] }
  return { kind: signedIn ? 'cloud' : 'none', model: null }
}
