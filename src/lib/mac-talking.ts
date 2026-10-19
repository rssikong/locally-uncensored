// Talking Character on a Mac (3.0.8): a portrait and a voice become a clip
// whose lips follow the speech, on LTX-2.3 4-bit through the engine's `a2v`
// (src-tauri/src/commands/video_ltx2mlx.rs). The tab has no prompt field: the
// run describes the scene in the words below, with what the voice says (the
// line under the chips) quoted in it, and the portrait does the rest.

/** How the prompt ends: what LTX-2.3 needs to be told for the lips to move.
 *  Real runs on the same portrait and voice (15.10.2026): with "natural lip
 *  movement" in the prompt the mouth stayed closed for four seconds; with
 *  this ending the lips moved with every word, with the words quoted and
 *  without them. */
const TALKING_ENDING = 'Their lips move clearly with every word, natural expression, slight head movement, static camera.'

/** The prompt of a talking run. `words` is what the voice says, as the user
 *  typed it (optional); quoted in the prompt it is what makes the lips follow
 *  the speech best. Double quotes inside become single ones, so the quote of
 *  the prompt stays one. */
export function macTalkingPrompt(words: string): string {
  const said = words.replace(/\s+/g, ' ').trim().replace(/"/g, "'")
  return said
    ? `A person talks directly to the camera and says: "${said}" ${TALKING_ENDING}`
    : `A person talks directly to the camera. ${TALKING_ENDING}`
}

/** What the run says when no installed video model talks. The tab is not
 *  offered then, so this is the guard for a stale store reaching submit. */
export const MAC_TALKING_NO_MODEL =
  'Talking Character on a Mac runs on LTX-2.3 Distilled 4-bit. Get it in the Model Manager, then get Talking Character on this tab.'
