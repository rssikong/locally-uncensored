/** Props every component of src/mobile/ui takes. */
export interface Testable {
  /** data-testid, by the convention m-<screen>-<element>. */
  testid?: string
  /** Element number from DESIGN.md ("C2.7"), written as data-el. The button inventory reads these. */
  el?: string
}

export function testProps(p: Testable): { 'data-testid'?: string; 'data-el'?: string } {
  const out: { 'data-testid'?: string; 'data-el'?: string } = {}
  if (p.testid) out['data-testid'] = p.testid
  if (p.el) out['data-el'] = p.el
  return out
}

/**
 * What a tap on a target does beyond the app, written as data-m-risk on the
 * target itself, so the button inventory and a persona agent can tell before
 * tapping.
 *
 *   paid         it uses credits.
 *   destructive  it removes data, signs out, or sends something to people
 *                that cannot be taken back (a report).
 *   leaves-app   it opens something outside the app: a link in the browser,
 *                the mail app, the settings of the system, the share sheet.
 *   sensor       it opens the camera, the microphone or the photo library of
 *                the phone (taking a picture, picking one, saving one there).
 *
 * One mark per target, the heavier one: a link to the plans is `paid`, the
 * link that deletes the account is `destructive`, the microphone of the chat
 * is `paid` (dictation over LU Cloud costs credits). The action button of a
 * question carries the mark of what was asked (ui/Dialog, dialogRisk).
 * A target that only opens the question still carries the mark: the question
 * is one tap further.
 */
export const RISKS = ['paid', 'destructive', 'leaves-app', 'sensor'] as const
export type Risk = (typeof RISKS)[number]

/** A target that can carry the risk mark: Button, IconButton, Row, Chip and the send button of the Composer. */
export interface RiskMarked {
  risk?: Risk
}

export function riskProps(risk: Risk | null | undefined): { 'data-m-risk'?: Risk } {
  return risk ? { 'data-m-risk': risk } : {}
}

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
