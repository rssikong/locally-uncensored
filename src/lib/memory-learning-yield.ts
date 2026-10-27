import { useGenerationStore } from '../stores/generationStore'
import { singleModelSlot } from './capabilities'
import { memoryExtractionRunId } from './silent-runs'

/**
 * The lane identity of a learning run: the chat it learns from plus this suffix.
 * Taken from the one place that books the run (silent-runs.ts), so the two cannot drift apart.
 */
export const MEMORY_LEARNING_SUFFIX = memoryExtractionRunId('')

/**
 * Phone: learning from the last answer steps aside for a new question.
 *
 * Learning is a second, silent call to the model. On a computer it runs on a
 * card that is done in a moment. On a phone the one small model needs many
 * seconds for it, and the next question stood in the queue behind it: 12 to
 * 29 seconds to the first word (acceptance on Android, M9). So a new question
 * ends every learning run, waiting or running. That turn is then not learned
 * from, which is the cheaper loss.
 *
 * Does nothing where two models fit. Returns how many runs were ended.
 */
export function yieldMemoryLearning(): number {
  if (!singleModelSlot()) return 0
  const generation = useGenerationStore.getState()
  const ids = new Set([...Object.keys(generation.aborters), ...Object.keys(generation.runs)])
  let ended = 0
  for (const id of ids) {
    if (!id.endsWith(MEMORY_LEARNING_SUFFIX)) continue
    generation.abortConversation(id)
    ended++
  }
  return ended
}
