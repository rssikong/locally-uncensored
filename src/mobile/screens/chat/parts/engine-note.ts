import { displayModelName } from '../../../../api/providers/model-name'
import { deviceFileLabel } from '../../../lib/model-facts'
import { modelNameOfPath, withoutPaths } from '../../../lib/no-paths'

/**
 * What the engine says about a model file it cannot read, in the words of this phone.
 *
 * The sentence comes from the native side and names the way of the desktop:
 * "Open Models, Get new and download it again". On a phone that way does not
 * exist: the card of a file that is on the phone says "Installed", and a new
 * download is only offered once the file is deleted (acceptance on Android,
 * buttons, M6). So the phone names the way that works here.
 */
const DESKTOP_WAY = /Open Models, Get new and download it again/g
export const PHONE_WAY = 'Open Models, delete this model there and download it again'

/**
 * The note of a model file that is not on the phone, as the start announces it:
 * the prefix with the name of the model, the model file with its name again,
 * the two guesses and the way out. Four sentences in a box that sits above the
 * text field, and with the keyboard open there is a strip of it to read (check
 * on Android, package 9: the box ended in the middle of the second sentence).
 * The name is said once, the guesses go.
 */
const FILE_MISSING = /^Couldn't start the LU Engine with "[^"]*": The model file "([^"]*)" is not on this device\. It may have been deleted, or the download did not finish\. Open Models and download it again(?:, then pick it in the chat)?\.?$/

/**
 * The start of a file the engine cannot find, as the native side words it: "Model file not found: <path>". The path
 * runs to the end of the text and may hold spaces (the folder of the app does). The phone shows the name only
 * (short check of package 10, iOS, F2).
 */
const FILE_MISSING_RAW = /(?:Couldn't start the LU Engine with "([^"]*)": )?(?:Embedding model|Model) file not found: (.+)$/s
const FILE_MISSING_RAW_ALONE = new RegExp(`^${FILE_MISSING_RAW.source}`, 's')
const FILE_MISSING_PHONE = 'is not on this device. Open Models and download it again.'

/**
 * The name of a model in these sentences: the name the user chose it by where the catalogue of the phone knows the
 * file ("SmolLM2 360M", as in the chip under the note), otherwise the file name without folder and ending (check iOS
 * package 11, N1: the note said "SmolLM2-360M-Instruct-Q4_K_M").
 */
export function phoneModelName(nameOrPath: string): string {
  const file = modelNameOfPath(displayModelName(nameOrPath.trim()))
  return deviceFileLabel(file) ?? file
}

/** Pure: the note with the way out a phone really has. Any other text passes unchanged. */
export function phoneEngineNote(note: string): string
export function phoneEngineNote(note: string | null | undefined): string | null
export function phoneEngineNote(note: string | null | undefined): string | null {
  if (!note) return note ?? null
  const missing = FILE_MISSING.exec(note)
  if (missing) return `The model file "${phoneModelName(missing[1])}" ${FILE_MISSING_PHONE}`
  if (FILE_MISSING_RAW.test(note)) {
    return note.trim().replace(FILE_MISSING_RAW, (_all, name: string | undefined, path: string) =>
      `The model file "${phoneModelName(name || path)}" ${FILE_MISSING_PHONE}`)
  }
  return withoutPaths(note.replace(DESKTOP_WAY, PHONE_WAY))
}

/**
 * The short line for a note about a model file that is not on the phone, for the moment the keyboard is open on a
 * small screen and there is no room for the sentence (short check 7 on Android, E6). Null for every other note.
 */
export const FILE_MISSING_SHORT = 'Model file missing. Open Models.'
export function shortEngineNote(note: string | null | undefined): string | null {
  return note && (FILE_MISSING.test(note) || FILE_MISSING_RAW_ALONE.test(note.trim())) ? FILE_MISSING_SHORT : null
}
