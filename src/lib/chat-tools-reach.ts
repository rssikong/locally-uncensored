// Chat Tools are always on (3.0.7, David): plain chat routes a turn that needs
// web, file, image or video through the tool loop wherever the model can call
// tools. A model that cannot (tool-support 'none') goes on in plain chat
// without them, as it did with the old switch off. There is no switch; this is
// the one question every surface asks instead.

import { canUseTools } from './tool-support'

interface ModelRow {
  name: string
  type?: string
  supportsTools?: boolean
}

/** Do Chat Tools reach this model? */
export function chatToolsReach(activeModel: string | null | undefined, models: readonly ModelRow[]): boolean {
  if (!activeModel) return false
  const row = models.find((m) => m.name === activeModel)
  return canUseTools({ name: activeModel, supportsTools: row && row.type === 'text' ? row.supportsTools : undefined })
}
