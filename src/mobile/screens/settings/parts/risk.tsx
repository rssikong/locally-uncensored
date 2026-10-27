/**
 * The risk mark of the test frame (data-m-risk) for this strand.
 *
 * A control that deletes something for good, signs the user out or sends
 * something to a person that cannot be taken back carries
 * data-m-risk="destructive", one that costs money or credits carries
 * data-m-risk="paid". The automatic sweep of the acceptance frame never taps
 * such a control.
 *
 * The attribute is written by the UI kit from the `risk` prop of Button, Row,
 * IconButton and Chip, at the control itself. This file is the list that
 * says which control is which, and the guard test
 * (__tests__/misc.test.ts) holds the sources against it: a control of the
 * list without its `risk` prop fails there.
 *
 * A control that only opens a question still carries the mark: the question
 * is one tap further, and a sweep must not get that far.
 */

export type Risk = 'destructive' | 'paid'

/** Exact test ids. */
export const RISK_BY_ID: Record<string, Risk> = {
  // Account
  'm-account-signout': 'destructive',
  'm-account-delete': 'destructive',
  'm-account-delete-go-delete': 'destructive',
  // Signed out: the way to delete the account on the website. One tap further the account is gone.
  'm-account-delete-website': 'destructive',
  // Sends a mail to a person, and that cannot be taken back (TESTIDS.md, duty 6).
  'm-account-reset-send': 'destructive',
  'm-account-reset-again': 'destructive',
  'm-account-buy': 'paid',
  'm-account-manage': 'paid',
  'm-account-pay-invoice': 'paid',
  // LU Cloud, credits, price
  'm-cloud-plans': 'paid',
  'm-cloud-pay-invoice': 'paid',
  // A plan without credits: the button leads to the plans with credits, like m-cloud-plans.
  'm-cloud-open-account': 'paid',
  'm-credits-plans': 'paid',
  'm-price-plans': 'paid',
  // Settings pages
  'm-settings-chat-reset': 'destructive',
  'm-settings-appearance-picture-remove': 'destructive',
  'm-settings-data-all-delete': 'destructive',
  'm-settings-data-restore-confirm': 'destructive',
  'm-settings-provider-key-delete': 'destructive',
  'm-settings-provider-delete': 'destructive',
  'm-settings-remote-disconnect': 'destructive',
  'm-settings-remote-forget-delete': 'destructive',
  'm-settings-privacy-ai-withdraw-reset': 'destructive',
  'm-settings-troubleshooting-reset': 'destructive',
  'm-settings-troubleshooting-setup': 'destructive',
  // A preview of a Cloud voice is a paid request.
  'm-settings-voice-test': 'paid',
  'm-settings-voice-plans': 'paid',
}

/** Test ids with a changing end: the plans of the gate and of its sheet, the previews of the Cloud voices. */
export const RISK_BY_PREFIX: ReadonlyArray<readonly [string, Risk]> = [
  ['m-cloud-plan-', 'paid'],
  // The same plans in the sheet of "Get LU Cloud" (round 51).
  ['m-cloud-sheet-plan-', 'paid'],
  ['m-settings-voice-preview-', 'paid'],
]

/** Pure: the risk of a control by its test id, or null. */
export function riskOf(testid: string | null | undefined): Risk | null {
  if (!testid) return null
  const exact = RISK_BY_ID[testid]
  if (exact) return exact
  for (const [prefix, risk] of RISK_BY_PREFIX) if (testid.startsWith(prefix)) return risk
  return null
}
