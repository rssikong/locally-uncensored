/**
 * G9 StorageDialog. Owned by strand 4 (Models and onboarding).
 *
 * The dialog before a download that does not fit the free storage (DESIGN.md
 * 5.2). It is opened through nav.confirm, so it holds a place in the back
 * stack and back means "Close". This file is where the wording and the
 * numbers are put together: what the model needs, what is free, what has to
 * be freed. The download does not start.
 */
import { nav } from '../nav'
import { spaceShortfall, storageDialogText, type SpaceShortfall } from '../screens/models/parts/download-state'
import { useModelsView } from '../screens/models/parts/view'
import { MODELS_STRINGS as S } from '../strings/models'

export interface StorageDialogInput {
  /** Name of the model, as the card shows it. */
  name: string
  shortfall: SpaceShortfall
  /** The download has a part already: the numbers are about its rest, and the part is kept. */
  resume?: boolean
}

/** Show G9. Resolves when the user answered; "Manage installed models" opens Models, Installed. */
export async function showStorageDialog(input: StorageDialogInput): Promise<void> {
  const manage = await nav.confirm({
    title: S.storageDialog.title,
    text: storageDialogText(input.name, input.shortfall, input.resume === true),
    confirmLabel: S.storageDialog.manage,
    cancelLabel: S.storageDialog.close,
    testid: 'storage-full',
  })
  if (!manage) return
  useModelsView.getState().setSegment('installed')
  if (nav.getState().flow) nav.finishFlow('models')
  else nav.resetTo('models')
}

/** One at a time: two files of one model fail in the same second, and one dialog says it for both. */
let ranOutOpen = false

/**
 * Storage ran out while a download was running. Said wherever the user is,
 * because a download runs on while they chat. The part is kept, the dialog
 * says how much to free, and "Open storage" leads to the page that frees it.
 */
export async function showStorageRanOut(input: { text: string }): Promise<void> {
  if (ranOutOpen) return
  ranOutOpen = true
  try {
    const open = await nav.confirm({
      title: S.storageDialog.ranOutTitle,
      text: input.text,
      confirmLabel: S.storageDialog.openStorage,
      cancelLabel: S.storageDialog.close,
      testid: 'storage-ran-out',
    })
    if (!open) return
    if (nav.getState().flow) {
      // Inside the first run there is no settings page to go to: the list of installed models is where room is made.
      useModelsView.getState().setSegment('installed')
      nav.finishFlow('models')
    } else nav.push('/settings/storage')
  } finally {
    ranOutOpen = false
  }
}

export { spaceShortfall }

/** Kept for the frame: the dialog itself is drawn by ui/Dialog through nav.confirm. */
export function StorageDialog() {
  return null
}
