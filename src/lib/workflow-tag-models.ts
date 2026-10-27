import type { AIModel, ComfyModelSource } from '../types/models'

/** The ComfyUI folders a Create model is picked from (getImageModels and the
 *  video lane). Everything else in ComfyUI\models is an addon. */
const MAIN_SOURCES: ReadonlySet<ComfyModelSource> = new Set(['checkpoint', 'diffusion_model', 'motion_module'])

/**
 * Does a tag on this inventory row pair it with a workflow?
 *
 * A workflow is found by the tags of the model picked in Create
 * (workflowStore getWorkflowForModel), and a LoRA, a VAE or a text encoder is
 * never that model. Their rows in the Workflows & Tags model list took tags
 * that no run ever read (Discord 2026-10-23: LoRAs in the list, picking one
 * did nothing), so the list leaves them out. A row without a source did not
 * come from the inventory's folder lanes and stays.
 */
export function takesWorkflowTags(model: AIModel): boolean {
  if (!('source' in model) || !model.source) return true
  return MAIN_SOURCES.has(model.source)
}
