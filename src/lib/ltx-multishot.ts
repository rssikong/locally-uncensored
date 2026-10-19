// LTX 2.5 multishot: several shots with the same figure in one run.
//
// How the model takes it, read off the vendor's own docs on 2026-10-02:
// docs.ltx.io, Open Source Model, Usage Guides, Prompting Guide, section
// "Multi-Shot Prompts". There is no separate input and no tag syntax. The
// scene is ONE chronological paragraph in which every cut is written out in
// plain words ("A hard cut transitions to ..."), each new shot says its own
// framing, and a recurring person is described the same way again. The guide
// says to prefer two to four shots and NOT to use a shot list, numbered beats
// or sluglines unless the cut is also described in prose. ComfyUI's LTX-2.5
// templates list "Native multishot" the same way: it is a property of the
// prompt, not of a node.
//
// So the shot list in the advanced settings is a form for that paragraph. The
// prompt field is shot 1, every further shot is one more sentence block, and
// each cut is named in prose. There is no per shot length: the guide has no
// syntax for one, the clip length stays the one length slider.
//
// On a Mac the LTX-2.5 packs of the second engine (ltx-2-mlx) take the same
// paragraph: it is the model that cuts, and the pack reads the prompt through
// its own Gemma like ComfyUI does. The engine's Prompt Relay (`--segment`)
// was read and not used: it gates each text to an even slice of the
// timeline by an attention penalty, with no cut of its own, and fails after
// the model has loaded on a clip with fewer latent frames than shots.

/** The model reads two to four shots well. */
export const MAX_SHOTS = 4

/** Longest text of one further shot, so a pasted essay cannot fill the prompt. */
export const MAX_SHOT_CHARS = 400

/** The named cut between two shots, written the way the guide's examples are. */
const CUT = 'A hard cut transitions to the next shot, with the same characters.'

function sentence(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return /[.!?…"”')]$/.test(t) ? t : `${t}.`
}

/** Does this model take a shot list? LTX 2.5 only. LTX 2.0 and 2.3 are not
 *  named by the guide. */
export function supportsMultishot(modelType: string | undefined | null): boolean {
  return modelType === 'ltx25'
}

/** The prompt of a multishot run. The prompt field is shot 1, `further` are the
 *  shots after it. Empty ones are dropped, and with none left the prompt goes
 *  through as the user wrote it. */
export function composeShots(first: string, further: readonly string[]): string {
  const rest = further.map((s) => s.trim()).filter(Boolean)
  // Shot 1 is the prompt. Without it there is no scene, and the empty prompt
  // must still be refused as such.
  if (rest.length === 0 || !first.trim()) return first
  return [sentence(first), ...rest.map((s) => `${CUT} ${sentence(s)}`)].join(' ')
}

/** How many shots a run really has: the prompt plus every further shot that has
 *  text. Used for the line under the list. */
export function shotCount(first: string, further: readonly string[]): number {
  return (first.trim() ? 1 : 0) + further.filter((s) => s.trim()).length
}

/** The prompt a local run sends. Only plain text-to-video on LTX 2.5 takes the
 *  shot list: through ComfyUI by the model's type, on a Mac where the video
 *  catalogue says so (`macMultishot`, the LTX-2.5 packs). Animate starts from
 *  one opening picture and the guide advises a single take there, and every
 *  other model or lane never saw the shots. Everything else keeps the prompt
 *  as typed. */
export function scenePromptFor(run: {
  prompt: string
  shots: readonly string[]
  mode: string
  intent: string
  onMlxHost: boolean
  modelType: string | undefined | null
  macMultishot?: boolean
}): string {
  const model = run.onMlxHost ? run.macMultishot === true : supportsMultishot(run.modelType)
  const applies = run.mode === 'video' && run.intent === 'video' && model
  return applies ? composeShots(run.prompt, run.shots) : run.prompt
}
