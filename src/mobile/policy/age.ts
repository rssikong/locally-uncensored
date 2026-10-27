/**
 * The age declaration (switch ageGate: 'declare-18').
 *
 * One answer, saved on the phone: "adult" or "minor". No date of birth is
 * asked or kept. In a build without the gate everyone counts as let in.
 *
 * The answer lives in two places: the localStorage of the WebView, which is
 * there at once on the next start, and the secure storage of the native
 * layer (age-vault.ts), which is on the disk the moment the write returns.
 * The page only moves on after the native layer confirmed, and at the start
 * the native answer is asked whenever localStorage has none. "minor" in
 * either place blocks.
 *
 * "No" is for good (on iOS the secure storage outlives the app), so a slip of
 * the finger must not be saved: "No" only opens a second question, held in
 * memory and nowhere else. "Go back" returns to the first question, and only
 * "Yes, I am under 18" writes. The closed page has no way back.
 */
import { useSyncExternalStore } from 'react'
import { ageVaultAvailable, loadAgeFromDevice, saveAgeToDevice } from './age-vault'
import { onSavedChange, readSaved, writeSaved } from './saved'
import { storePolicy } from './storePolicy'

export const AGE_KEY = 'lu-mobile-age'

export type AgeAnswer = 'adult' | 'minor'
/**
 * open: let in. ask: show the question. confirm: "No" was tapped, the second
 * question shows and nothing is saved yet. blocked: the quiet page.
 * checking: the native layer is asked for an earlier answer, nothing is shown yet.
 */
export type AgeState = 'open' | 'ask' | 'confirm' | 'blocked' | 'checking'

type Listener = () => void
const listeners = new Set<Listener>()
function emit(): void {
  for (const fn of [...listeners]) fn()
}

/** What the native layer answered at this start. undefined: not asked yet. */
let deviceAnswer: AgeAnswer | null | undefined
let deviceRead: Promise<void> | null = null
/** The answer that is on its way to the disk. The question stays on screen until it is there. */
let saving: AgeAnswer | null = null
/** "No" was tapped and waits for the second answer. In memory only: a restart asks the first question again. */
let doubting = false

export function ageAnswer(): AgeAnswer | null {
  const raw = readSaved(AGE_KEY)
  return raw === 'adult' || raw === 'minor' ? raw : null
}

/** Ask the native layer once per start. Safe to call any number of times. */
export function readAgeFromDevice(): Promise<void> {
  if (deviceRead) return deviceRead
  if (!ageVaultAvailable()) {
    deviceAnswer = null
    return (deviceRead = Promise.resolve())
  }
  deviceRead = loadAgeFromDevice().then((answer) => {
    // An answer given while the read was on its way is the newer one.
    if (deviceAnswer === undefined) deviceAnswer = answer
    // Bring localStorage back in step, so the next start does not have to wait.
    if (deviceAnswer && ageAnswer() !== 'minor' && ageAnswer() !== deviceAnswer) writeSaved(AGE_KEY, deviceAnswer)
    emit()
  })
  return deviceRead
}

export function ageState(): AgeState {
  if (storePolicy().ageGate === 'none') return 'open'
  const local = ageAnswer()
  // The question stays until the answer is confirmed on the disk: the one the answer was given on.
  if (saving) return saving === 'minor' && doubting ? 'confirm' : 'ask'
  if (local === 'minor' || deviceAnswer === 'minor') return 'blocked'
  if (local === 'adult' || deviceAnswer === 'adult') return 'open'
  if (doubting) return 'confirm'
  if (deviceAnswer === undefined && ageVaultAvailable()) return 'checking'
  return 'ask'
}

/** The answer that is being written right now, or null. */
export function ageSaving(): AgeAnswer | null {
  return saving
}

/**
 * Save the answer. Without a native layer (a browser tab, a test) this is
 * done when it returns. With one, the state changes only after the native
 * layer confirmed the write, or gave up after a few seconds; the answer is
 * in localStorage from the first line either way.
 */
export function declareAge(answer: AgeAnswer): Promise<void> {
  if (saving) return Promise.resolve()
  if (!ageVaultAvailable()) {
    deviceAnswer = deviceAnswer === 'minor' ? 'minor' : null
    writeSaved(AGE_KEY, answer)
    emit()
    return Promise.resolve()
  }
  saving = answer
  writeSaved(AGE_KEY, answer)
  emit()
  return saveAgeToDevice(answer).then((confirmed) => {
    if (confirmed) deviceAnswer = answer
    else if (deviceAnswer === undefined) deviceAnswer = null
    saving = null
    emit()
  })
}

/** "No" on the first question. Saves nothing, shows the second question. */
export function answerNo(): void {
  if (saving || doubting) return
  if (ageState() !== 'ask') return
  doubting = true
  emit()
}

/** "Go back" on the second question. Nothing was saved, the first question shows again. */
export function takeBackNo(): void {
  if (saving || !doubting) return
  doubting = false
  emit()
}

/** "Yes, I am under 18" on the second question. Only this saves the "No". */
export function confirmMinor(): Promise<void> {
  if (saving || !doubting) return Promise.resolve()
  return declareAge('minor').then(() => {
    doubting = false
    emit()
  })
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn)
  const off = onSavedChange(fn)
  if (storePolicy().ageGate !== 'none') void readAgeFromDevice()
  return () => {
    listeners.delete(fn)
    off()
  }
}

export function useAgeState(): AgeState {
  return useSyncExternalStore(subscribe, ageState, ageState)
}

export function useAgeSaving(): AgeAnswer | null {
  return useSyncExternalStore(subscribe, ageSaving, ageSaving)
}

/** Only for tests. */
export function __resetAgeForTests(): void {
  deviceAnswer = undefined
  deviceRead = null
  saving = null
  doubting = false
  writeSaved(AGE_KEY, null)
}
