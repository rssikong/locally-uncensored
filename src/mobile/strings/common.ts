/**
 * Texts of the shell itself: frame, start, global notices. English, short,
 * without dashes, and without a word about programs a phone does not have.
 * The guard src/mobile/__tests__/nutzertexte.test.ts reads every text under
 * src/mobile.
 *
 * Texts of a strand go into that strand's file in this folder, never into JSX.
 */
import { marketed } from '../policy/gates'

export const COMMON = {
  get appName() {
    return marketed('Locally Uncensored', 'LU')
  },
  /** What a screen reader says for the mark where it stands without a heading (ui/Icon.tsx, Monogram). The same in every package. */
  markName: 'LU',
  back: 'Back',
  close: 'Close',
  cancel: 'Cancel',
  tryAgain: 'Try again',
  notNow: 'Not now',
  restoring: 'Restoring your chats',
  offline: 'No internet. On device models still work.',
  fatalTitle: 'LU could not start.',
  fatalText: 'Something failed while LU was starting. Your chats are still on this phone.',
  // The same screen after the start went well: the sentence above would not be true then.
  fatalRunningTitle: 'LU ran into a problem.',
  fatalRunningText: 'Something failed while LU was running. Your chats are still on this phone.',
  fatalReset: 'Reset settings and restart',
  fatalResetQuestion: 'Reset all settings?',
  fatalResetText: 'Settings go back to their defaults. Your chats and models stay.',
  fatalResetConfirm: 'Reset and restart',
  restoreFailed: 'Your chats could not be restored from the backup. Nothing was deleted. Close LU and open it again to retry.',
  dismiss: 'Dismiss',
  open: 'Open',
  // A Cloud render that finished while the app was closed or in the background.
  resultInGallery: 'Your result is in the gallery',
  resultsInGallery: 'Your results are in the gallery',
  renderFailed: 'A render did not finish.',
  // Storage trouble, the fallback of the shell until G12 is built.
  storageFull: 'LU is running out of space for chats.',
  manageStorage: 'Manage storage',
  storageNotSaved:
    'Your phone is out of storage. This chat is not saved yet. Free up space, then try again.',
  storageSavedElsewhere: 'Saving is slower than usual. Your chats are safe.',
  // ---- base components (src/mobile/ui) ----
  show: 'Show',
  hide: 'Hide',
  showPassword: 'Show password',
  hidePassword: 'Hide password',
  paste: 'Paste',
  /** The paste button could not read the clipboard (the WebView refused, or there is no way to ask). */
  pasteBlocked: 'LU could not read the clipboard. Press and hold the field, then choose Paste.',
  pasteEmpty: 'There is no text on the clipboard.',
  copy: 'Copy',
  copyCode: 'Copy code',
  copied: 'Copied',
  copyFailed: 'Could not copy. Select the text instead.',
  preview: 'Preview',
  previewPage: 'Preview this page',
  codePlain: 'Code',
  openLinkTitle: 'Open link?',
  openLinkConfirm: 'Open in browser',
  linkBlocked: 'This kind of link cannot be opened from LU.',
  linkNotOpened: 'This phone could not open the link.',
  permissionBlocked: 'Blocked',
  permissionAsk: 'Ask',
  permissionAuto: 'Auto',
  permissionFor: (what: string) => `Permission for ${what}`,
  decrease: (what: string) => `Decrease ${what}`,
  increase: (what: string) => `Increase ${what}`,
} as const
