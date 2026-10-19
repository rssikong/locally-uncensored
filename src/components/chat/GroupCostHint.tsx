// What a group round costs, said out loud above the composer (2.6.6, plan A4).
//
// The group is the only surface where one Enter buys more than one answer, and
// nothing on screen said so: the user picks three models in the Plugins
// dropdown, types a question, and the app quietly bills three completions on
// the shared history. A per-model send budget takes the runaway growth out of
// it, but the multiplier itself is the feature, not a bug, so the honest fix is
// to name it where the user is about to press send.
//
// Only rendered when a line-up is actually active, and never in a single-model
// chat, where it would be noise.

import { Users } from 'lucide-react'
import { Hinweis } from '../ui/Hinweis'
import { useChatStore } from '../../stores/chatStore'
import { useProviderStore } from '../../stores/providerStore'
import { useModelStore } from '../../stores/modelStore'
import { isGroupChat, availableGroupMembers } from '../../lib/group-chat'
import { COMPOSER_MAX_W } from './composer-width'

/** The line itself. Kept pure so the wording is testable without a renderer.
 *
 *  `builtinSpeakers` is how many of the line-up run on the app's own engine.
 *  From two upwards that costs time rather than money: llama-server holds one
 *  model, so the engine is stopped and started again between those speakers.
 *  The counter-check found the app hiding this by not reloading at all and
 *  answering every speaker with the same model, which is the one thing we will
 *  not do, so the wait gets named here before the user presses send. */
export function groupCostHintText(models: number, builtinSpeakers = 0, unavailable = 0): string {
  const answers = models === 1 ? '1 answer' : `${models} answers`
  const base = `1 round = ${answers} = ${models}x the cost`
  const withReload = builtinSpeakers >= 2
    ? `${base}, and the LU Engine reloads between local speakers`
    : base
  // GH #165: a member whose model left the list does not answer, so it is not
  // in the count; saying that it sits out keeps the line from contradicting
  // the group menu.
  if (unavailable === 0) return withReload
  return `${withReload} (${unavailable} unavailable ${unavailable === 1 ? 'model sits' : 'models sit'} out)`
}

export function GroupCostHint() {
  const activeConversationId = useChatStore((s) => s.activeConversationId)
  const groupModels = useChatStore((s) =>
    activeConversationId
      ? s.conversations.find((c) => c.id === activeConversationId)?.groupModels
      : undefined,
  )

  // Only the app-managed engine has the one-model-at-a-time problem. A LAN
  // OpenAI-compatible server in the same slot serves many models at once.
  const managedBuiltin = useProviderStore(
    (s) => !!s.providers.openai?.enabled && s.providers.openai?.managed === true,
  )

  const models = useModelStore((s) => s.models)
  const inventoryLoaded = useModelStore((s) => s.inventoryLoaded)

  if (!isGroupChat(groupModels)) return null

  const answering = availableGroupMembers(groupModels, models, inventoryLoaded)
  const builtinSpeakers = managedBuiltin
    ? answering.filter((m) => m.startsWith('openai::')).length
    : 0

  // Eine Zeile, kein Kasten: der Vervielfacher ist eine Auskunft, kein Alarm.
  // Vorher trug die Zeile einen gelben Rahmen mit gelber Fuellung und ein
  // gelbes Symbol, also die Bauform einer Warnung fuer einen Satz, der nur
  // sagt, was der naechste Enter kostet. Die Begruendung steht in
  // `lib/hinweis.ts`.
  return (
    <div className={`w-full ${COMPOSER_MAX_W} mx-auto px-3 pb-1 flex justify-center`}>
      <Hinweis className="w-full" icon={<Users size={9} className="shrink-0 mt-[3px]" />}>
        <span className="block truncate" title={groupModels.join(', ')}>
          <span className="uppercase tracking-wider">group</span>{' '}
          {groupCostHintText(answering.length, builtinSpeakers, groupModels.length - answering.length)}
        </span>
      </Hinweis>
    </div>
  )
}
