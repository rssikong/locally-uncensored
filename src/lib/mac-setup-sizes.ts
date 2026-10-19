// What a first setup on the Mac downloads, said in the app's one way of
// counting.
//
// The MLX catalogue counts in decimal GB (`size_gb as f64 * 1e9`), the app
// writes every size through `formatBytes`, which divides by 1024. The setup
// sentences added up the catalogue's own figures (3 + 2.6 = "about 5.5 GB",
// 1 + 18 = "about 19 GB") while the tile of the same starter model, one click
// away, said "2.4 GB" and "16.8 GB" (persona walk of the Mac app, 09.10.2026,
// Fund 21). Two rules for one download.
//
// The sentences now go the way the tiles go: decimal GB to bytes, bytes
// through the 1024 rule, rounded to a whole number because "about" is all a
// setup can promise.

import { siGbToBytes } from './formatters'
import { videoModelBringsItsEngine } from './video-engines'

/** The image engine itself, as `api/mlx-install.ts` quotes it. */
export const MAC_IMAGE_ENGINE_SI_GB = 3
/** SD Turbo, the starter the image setup pulls along (`mlx.rs`, `size_gb`). */
export const MAC_IMAGE_STARTER_SI_GB = 2.6
/** The video engine itself. */
export const MAC_VIDEO_ENGINE_SI_GB = 1
/** The second video engine, which the quantized LTX packs bring along. Its
 *  venv measured 0.49 GB after a real install (09.10.2026). */
export const MAC_VIDEO_LTX_ENGINE_SI_GB = 0.5

/** The music engine's venv (`ENGINE_INSTALL_BYTES` in music.rs). Not
 *  measured yet: its wheels are 0.33 GB, and torch and MLX unpack to several
 *  times that, so this is the room the install asks for. */
export const MAC_MUSIC_ENGINE_SI_GB = 3

/** "about 5 GB" for a size the catalogue gives in decimal GB. */
export function aboutGb(siGb: number): string {
  return `about ${Math.max(1, Math.round(siGbToBytes(siGb) / 1024 ** 3))} GB`
}

/** Image engine and SD Turbo together. */
export const MAC_IMAGE_SETUP_SIZE = aboutGb(MAC_IMAGE_ENGINE_SI_GB + MAC_IMAGE_STARTER_SI_GB)
/** The video engine alone, as Settings and the Model Manager set it up. */
export const MAC_VIDEO_ENGINE_SIZE = aboutGb(MAC_VIDEO_ENGINE_SI_GB)
/** The music engine, which comes with the Get of its one model. */
export const MAC_MUSIC_ENGINE_SIZE = aboutGb(MAC_MUSIC_ENGINE_SI_GB)

/**
 * Everything the video setup of Create fetches for its starter, in decimal
 * GB: the model, the text encoder that comes with it when that lies in a
 * repository of its own, and the engine when that is still missing. The
 * starter is chosen per Mac (`starterChoice` in api/mlx-install.ts), so its
 * figures come from the catalogue entry and none is written down here. For
 * LTX-2.3 Distilled 4-bit on a fresh Mac that is 20.5 + 8.1 + 0.5.
 */
export function macVideoSetupSiGb(
  model: { sizeGB: number; textEncoderGB?: number; bringsItsEngine: boolean },
  engineMissing: boolean,
): number {
  const engine = !engineMissing ? 0 : model.bringsItsEngine ? MAC_VIDEO_LTX_ENGINE_SI_GB : MAC_VIDEO_ENGINE_SI_GB
  return model.sizeGB + (model.textEncoderGB ?? 0) + engine
}

/**
 * The bytes a Get of this catalogue entry fetches, which is what its tile in
 * the Model Manager says while the model is not installed: the model, and the
 * text encoder where the list still names one. The list names it only while
 * it is missing on disk (`encoder_to_fetch_gb` in video.rs), so a second
 * model on the same encoder counts the model alone. An installed model is its
 * own size: that is what lies in its folder and what Remove frees.
 */
export function macGetBytes(model: { sizeBytes: number; textEncoderGB?: number; installed?: boolean }): number {
  if (model.installed) return model.sizeBytes
  return model.sizeBytes + siGbToBytes(model.textEncoderGB ?? 0)
}

/** Why the video setup downloads nothing on a Mac no starter fits on. */
export function macVideoNoFitLine(needGb: number, memoryGb: number | null): string {
  const have = memoryGb ? `, and this one has ${Math.round(memoryGb)} GB` : ''
  return `The smallest video model to start with needs a Mac with ${needGb} GB of memory${have}. Nothing is downloaded, because it would not run here. Use LU Cloud for video on this Mac.`
}

/** The plan of the video setup, as far as its card reads it
 *  (`MacVideoSetupPlan` in api/mlx-install.ts). */
interface VideoSetupPlan {
  choice:
    | { pick: { name: string; family: string; sizeGB: number; textEncoderGB?: number }; reason?: undefined }
    | { pick: null; reason: 'installed' }
    | { pick: null; reason: 'memory'; needGb: number }
  memoryGb: number | null
  engineMissing: boolean
}

/**
 * What the video card of Create says on a Mac, from the plan of the setup
 * itself: the same one "Download & install" runs.
 *
 * The card named "the smallest video model" and one fixed size, for a starter
 * that is chosen per Mac. It names the model now, and its size is what the
 * click fetches. A Mac no starter fits on is told so and gets no button.
 * `plain` is what the card says before the plan is read.
 */
export function macVideoSetupCopy(
  plain: { title: string; description: string },
  plan: VideoSetupPlan | null,
): { title: string; description: string; canInstall: boolean } {
  if (!plan) return { ...plain, canInstall: true }
  const { choice } = plan
  if (!choice.pick) {
    if (choice.reason !== 'memory') return { ...plain, canInstall: true }
    return {
      title: 'Local video needs more memory than this Mac has',
      description: macVideoNoFitLine(choice.needGb, plan.memoryGb),
      canInstall: false,
    }
  }
  const pick = choice.pick
  const size = aboutGb(macVideoSetupSiGb(
    { sizeGB: pick.sizeGB, textEncoderGB: pick.textEncoderGB, bringsItsEngine: videoModelBringsItsEngine(pick.family) },
    plan.engineMissing,
  ))
  const encoder = pick.textEncoderGB ? ' with its text encoder' : ''
  return {
    title: plain.title,
    description: `This sets up Apple MLX video on this Mac and downloads ${pick.name}${encoder}, ${size} in all. Video renders take minutes per clip, not seconds. More models are in Models, under Video.`,
    canInstall: true,
  }
}
