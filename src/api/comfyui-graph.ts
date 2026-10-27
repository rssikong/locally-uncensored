/**
 * Reine ComfyUI-Graph-Bausteine: Funktionen, die aus Parametern ein Stück
 * Prompt-JSON bauen und dafür nichts brauchen — kein HTTP, keinen Store, kein
 * anderes Modul.
 *
 * Audit W-T2: Beide standen in api/dynamic-workflow.ts, und api/comfyui.ts hat
 * sie sich für seine älteren Video-Builder mit `await import('./dynamic-workflow')`
 * mitten in der Funktion geholt — weil dynamic-workflow.ts umgekehrt
 * classifyModel/findMatchingVAE/findMatchingCLIP aus comfyui.ts zieht. Das war
 * kein Code-Splitting, sondern eine versteckte Kante: dieselbe Datei lag ohnehin
 * im selben Chunk, der dynamische Import hat nur den Zyklus unsichtbar gemacht
 * (comfyui → dynamic-workflow → comfyui, und einmal weiter über comfyui-nodes).
 *
 * Die ehrliche Auflösung ist nicht "später importieren", sondern "hier gibt es
 * nichts zu zyklen": das Gemeinsame liegt jetzt in einem blattnahen Modul, das
 * beide Seiten statisch importieren. dynamic-workflow.ts re-exportiert beide
 * Namen, damit kein Aufrufer und kein Test seinen Importpfad ändern muss.
 */

import type { ComfyApiGraph, ComfyApiNode, ComfyLinkRef } from '../types/comfy-graph'

// ─── Output filename slug (2026-06-11) ───
//
// Generated media used to be `locally_uncensored_00123_.png` /
// `locally_uncensored_vid_00011.mp4` — opaque. Now the ComfyUI SaveImage /
// VHS `filename_prefix` is derived from the PROMPT, so a file is
// `red_apple_on_white_plate_00001_.png`. That makes the result string
// self-descriptive, so a follow-up "animate the red-apple image" can pass the
// recognisable filename straight back. ComfyUI still appends its own
// `_NNNNN_` counter, so uniqueness is preserved.
//
// Exported + pure for the unit tests.
export function promptFilenamePrefix(prompt: string | undefined, isVideo: boolean): string {
  const slug = (prompt || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .split('_')
    .filter(Boolean)
    .slice(0, 6)          // first ~6 words keep it readable
    .join('_')
    .slice(0, 48)
    .replace(/_+$/g, '')
  if (!slug) return isVideo ? 'locally_uncensored_vid' : 'locally_uncensored'
  // Keep a short tag so a folder full of generations is still recognisably ours
  // and videos never collide with the still they were made from.
  return isVideo ? `${slug}__vid` : slug
}

/**
 * Discord 2026-10-01: downloaded renders "mutated" into
 * copies of other renders. ComfyUI numbers a file one past the highest it
 * still finds for the same prefix, and since 3.0.3 a gallery delete moves the
 * file to the Recycle Bin, so the next run with the same prompt took the freed
 * name. A download asks ComfyUI by name, so the older gallery entry handed out
 * the newer picture. A short tag per run gives every run its own prefix, and a
 * name can never point at two pictures again.
 */
export function tagOutputPrefixes(graph: ComfyApiGraph, tag: string): ComfyApiGraph {
  const out: ComfyApiGraph = {}
  for (const [id, node] of Object.entries(graph)) {
    const prefix = node.inputs?.filename_prefix
    out[id] = typeof prefix === 'string' && prefix
      ? { ...node, inputs: { ...node.inputs, filename_prefix: `${prefix}_${tag}` } }
      : node
  }
  return out
}

/** Six letters and digits, new for every run. */
export function newRunTag(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  return Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
}

/** Decode node for video latents: tiled whenever the install has the node.
 *  A full-frame WanVAE decode next to a resident 14B UNet left 312 MB of VRAM
 *  on a 12 GB card; CUDA paged through the Windows driver instead of throwing,
 *  so ComfyUI's own OOM-then-tiled retry never fired and the decode ran 45+
 *  minutes at "GPU 100%" (live, 2026-08-02). Tiles keep the working set
 *  flat for a quality-neutral overlap cost.
 *
 *  ALL four tiling fields are sent. The live validator refuses a prompt that
 *  omits a required-with-default field ("Node 8 (VAEDecodeTiled): Required
 *  input is missing" three times, e2e 2026-08-02), and cores old enough to
 *  lack the overlap/temporal fields simply ignore unknown inputs. Values are
 *  the node's own defaults except tile_size, halved for the low-VRAM cards
 *  this exists for. Image decodes stay on plain VAEDecode. */
export function videoDecodeNode(
  samplesRef: ComfyLinkRef,
  vaeRef: ComfyLinkRef,
  hasTiled: boolean,
): ComfyApiNode {
  return hasTiled
    ? {
        class_type: 'VAEDecodeTiled',
        inputs: {
          samples: samplesRef, vae: vaeRef,
          tile_size: 256, overlap: 64, temporal_size: 64, temporal_overlap: 8,
        },
      }
    : { class_type: 'VAEDecode', inputs: { samples: samplesRef, vae: vaeRef } }
}

/** Speicherknoten für ein fertiges Video, für alle stummen Video-Wege gleich
 *  (A19, 3.0.8). Wan 2.1 schrieb im Chat fest SaveAnimatedWEBP und in Create
 *  ohne VideoHelperSuite ebenfalls: ein animiertes Bild ohne Steuerung, das im
 *  Chat-Player und in der Galerie nicht als Video lief. Die Reihenfolge ist
 *  deshalb
 *    1. CreateVideo + SaveVideo aus dem ComfyUI-Kern (MP4, H.264; der Kern
 *       schreibt yuv420p), also nichts, was ein Nutzer nachinstallieren muss,
 *    2. VHS_VideoCombine (video/h264-mp4, ebenfalls yuv420p),
 *    3. SaveAnimatedWEBP nur noch für Kerne, die beides nicht haben,
 *    4. SaveImage (Einzelbilder) als allerletzter Ausweg.
 *  Gibt die nächste freie Knotennummer zurück. */
export function addVideoSave(
  workflow: ComfyApiGraph,
  n: number,
  images: ComfyLinkRef,
  fps: number,
  prefix: string,
  has: (classType: string) => boolean,
): number {
  if (has('CreateVideo') && has('SaveVideo')) {
    const createId = String(n++)
    workflow[createId] = { class_type: 'CreateVideo', inputs: { images, fps } }
    workflow[String(n++)] = {
      class_type: 'SaveVideo',
      inputs: { video: [createId, 0], filename_prefix: prefix, format: 'mp4', codec: 'h264' },
    }
  } else if (has('VHS_VideoCombine')) {
    workflow[String(n++)] = {
      class_type: 'VHS_VideoCombine',
      inputs: { images, frame_rate: fps, loop_count: 0, filename_prefix: prefix, format: 'video/h264-mp4', pingpong: false, save_output: true },
    }
  } else if (has('SaveAnimatedWEBP')) {
    workflow[String(n++)] = {
      class_type: 'SaveAnimatedWEBP',
      inputs: { images, filename_prefix: prefix, fps, lossless: false, quality: 90, method: 'default' },
    }
  } else {
    workflow[String(n++)] = { class_type: 'SaveImage', inputs: { images, filename_prefix: prefix } }
  }
  return n
}
