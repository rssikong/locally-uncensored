/**
 * The risk mark of the acceptance frame (TESTIDS.md, duty 6): a target that
 * removes something for good carries data-m-risk="destructive", so a sweep or
 * a persona agent can tell before tapping.
 *
 * The UI kit writes the attribute from a `risk` prop on Button, IconButton,
 * Row and Chip. Spread `riskMark()` onto the target: `<Row {...riskMark('destructive')} />`.
 *
 * Downloads carry no mark on purpose. "paid" means "uses credits", and a
 * model download uses none. The sweep still leaves them alone by their name.
 */
export type Risk = 'paid' | 'destructive'

export function riskMark(risk: Risk): { risk: Risk } {
  return { risk }
}

/** Every target of this strand that removes something for good, by its testid. The guard test reads this list. */
export const DESTRUCTIVE_TARGETS = [
  'm-models-detail-delete',
  'm-models-partials-clear',
  'm-models-benchmark-clear',
  'm-settings-engine-reset',
  'm-settings-storage-delete',
  'm-settings-storage-partials-clear',
  'm-settings-storage-token-remove',
  'm-settings-storage-cache-clear',
  // Transfer.tsx builds these from the prefix of its place: cancel throws the part away, remove deletes it.
  "t('cancel')",
  "t('remove')",
] as const
