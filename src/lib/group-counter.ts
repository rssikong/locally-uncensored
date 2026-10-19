/**
 * Whose context the counter shows in a group chat (GH #167, part 2).
 *
 * THE BUG: the counter anchored on the newest message that carried a usage
 * report, whichever model wrote it, and divided by the window of the model
 * the picker stands on. In a group every speaker sends its own prompt, under
 * its own history budget, into its own window. So the number alternated
 * between the speakers' prompt sizes (the reporter saw 10.4K while the next
 * model answered and 205.2K after the other one finished), over a
 * denominator that belonged to neither of them, and nothing said which model
 * a number was about.
 *
 * THE RULE NOW: the counter belongs to ONE speaker and says which. It is the
 * speaker whose request is the next one, or the current one:
 *
 *   - While a round runs, the speaker that is answering right now (the
 *     newest assistant bubble carries its model).
 *   - Otherwise the first speaker of the group, who opens the next round when
 *     the user sends.
 *
 * Its numerator anchors only on that speaker's OWN last usage report
 * (`computeContextFill(..., { anchorModelId })`), and the window is that
 * speaker's window. Numerator, denominator and label then always describe
 * the same model, and the number only changes together with the name.
 *
 * Leaf module: no React, no store, so the rule unit-tests without a renderer.
 */
import { displayModelName } from '../api/providers/model-name'
import { isGroupChat, type GroupSpeaker } from './group-chat'

export interface CounterSpeaker {
  /** The model id, as the group stores it. */
  model: string
  /** What the counter writes in front of the number. */
  label: string
}

interface SpeakerMessage {
  role: string
  modelId?: string
}

/**
 * The speaker the counter belongs to, or null outside a group chat.
 *
 * `speakers` is `groupSpeakers(...)`: a speaker with a persona of its own is
 * labelled with the persona name, every other one with its model name
 * without the slot prefix.
 */
export function groupCounterSpeaker(
  messages: readonly SpeakerMessage[],
  groupModels: string[] | undefined,
  generating: boolean,
  speakers?: Readonly<Record<string, GroupSpeaker>>,
): CounterSpeaker | null {
  if (!isGroupChat(groupModels)) return null
  let model = groupModels[0]
  if (generating) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role === 'user') break
      if (m.role === 'assistant' && m.modelId && groupModels.includes(m.modelId)) {
        model = m.modelId
        break
      }
    }
  }
  const speaker = speakers?.[model]
  const label = speaker?.personaPrompt !== undefined ? speaker.name : displayModelName(model)
  return { model, label }
}
