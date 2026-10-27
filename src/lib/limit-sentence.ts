// The sentence of a request limit (HTTP 429) on a surface that draws its own
// error box out of a sentence: Create on the phone.
//
// The rule is the one of lib/request-limit.ts: what the server wrote is shown
// word for word, and the app's own sentence only stands in for an answer that
// carried no words. A box that sorts errors by their wording cannot know a
// sentence it has never seen, so the sentence is remembered here at the place
// that still holds the status, and the box asks for it by its text.
import { requestLimitMessageOf } from './request-limit'

const sentences = new Set<string>()

/** What the user reads for this refused request. Nothing is booked for a
 *  request LU Cloud refused, and the next step in Create is to try again. */
export function limitSentence(err: unknown): string {
  const sentence = requestLimitMessageOf(err, { nothingCharged: true, again: 'try again' })
  sentences.add(sentence)
  return sentence
}

/** Is this text a sentence `limitSentence` handed out in this session. */
export function isLimitSentence(text: string): boolean {
  return sentences.has(text.trim())
}
