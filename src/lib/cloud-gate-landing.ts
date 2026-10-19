// Where the app lands once an account that clicked a model in the gate can
// use it: on exactly that model. Chat and Code hand the model to the mode
// rule (AppShell, pickForMode), which takes it once the hosted list has it;
// Create opens its tab on the model's kind with the model picked.
import { useCloudGateStore } from '../stores/cloudGateStore'
import { useUIStore } from '../stores/uiStore'
import { useCreateStore } from '../stores/createStore'
import { prefixModelName } from '../api/providers'
import { freshGatePick } from './cloud-gate'

/** Lands on the kept pick, if there is a fresh one, and forgets it. True when
 *  it did. The caller switches the app to Cloud. */
export function landOnGatePick(now = Date.now()): boolean {
  const gate = useCloudGateStore.getState()
  const pick = freshGatePick(gate.pick, now)
  gate.setPick(null)
  if (!pick) return false
  const ui = useUIStore.getState()
  if (pick.category === 'create') {
    const create = useCreateStore.getState()
    const kind = pick.kind ?? 'image'
    create.setIntent(kind)
    if (kind === 'image') create.setCloudImageModel(pick.model)
    else if (kind === 'video') create.setCloudVideoModel(pick.model)
    else create.setCloudOpModel(pick.model)
    ui.setView('create')
  } else {
    ui.setPendingCloudModel(prefixModelName('lu-cloud', pick.model))
    ui.setView('chat')
  }
  return true
}
