import { backendCall } from './backend'
import { checkComfyConnection } from './comfyui'

/**
 * Restart ComfyUI so a freshly installed node pack registers, because packs
 * only load at startup.
 *
 * `stop_comfyui` can only kill the ComfyUI that LU itself spawned. Started from
 * a terminal, a batch file or ComfyUI Desktop, the old process keeps the port
 * and keeps serving its old node list, while the process LU starts next never
 * gets the port at all. Everything downstream then looks like a broken install:
 * the connection check says the engine is up, the node is still missing, and
 * the user is sent to hunt an IMPORT FAILED line that was never written,
 * because that process never tried the import.
 *
 * Measured on the test box on 2026-08-15: two python.exe alive, VHS_VideoCombine
 * installed on disk and absent from the answering /object_info, no import error
 * anywhere in the log. Killing both and starting once listed all 40 VHS nodes.
 *
 * So: stop, then confirm the port actually went quiet before starting again.
 * Whatever still answers after that is an engine LU does not own, and the only
 * honest thing to do is say so.
 */
export const OUTSIDE_LU_NODE_PACKS =
  'Your ComfyUI is running outside LU, so LU cannot restart it. New node packs only load on startup: restart your ComfyUI yourself, then come back here.'

/** `outsideMessage` is the sentence for a ComfyUI LU does not own. The default
 *  is the node pack one; the GPU mode switch in Settings, Hardware passes its
 *  own, because there the honest answer is a different one. */
export async function restartComfyForNewNodes(outsideMessage: string = OUTSIDE_LU_NODE_PACKS): Promise<void> {
  try { await backendCall('stop_comfyui') } catch { /* may already be stopped */ }
  // stop_comfyui reaps its child before returning, so LU's own engine is down
  // by now — poll a few extra rounds anyway instead of trusting one sleep.
  let stillUp = await checkComfyConnection()
  for (let i = 0; stillUp && i < 5; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    stillUp = await checkComfyConnection()
  }
  if (stillUp) {
    throw new Error(outsideMessage)
  }
  await backendCall('start_comfyui')
}
