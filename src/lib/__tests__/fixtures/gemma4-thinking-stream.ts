/**
 * A Gemma 4 answer with a thought, as the pieces of a stream.
 *
 * Built by hand from the documented Gemma 4 format, `<|channel>thought`, the
 * reasoning, `<channel|>`, then the answer. It is not a recording: no Gemma 4
 * build was at hand when this was written. The markers arrive as tokens of
 * their own, the way a server sends them that does not split the thought off.
 */
export const GEMMA4_THOUGHT = 'The user asks why people want permanent daylight saving time. List the main reasons, keep it short.'

export const GEMMA4_ANSWER = 'People mostly want **lighter evenings**. Changing the clock twice a year is also tiring.'

export const GEMMA4_STREAM: string[] = [
  '<|channel>',
  'thought',
  '\n',
  'The user asks why people want permanent daylight saving time.',
  ' List the main reasons,',
  ' keep it short.',
  '<channel|>',
  'People mostly want',
  ' **lighter evenings**.',
  ' Changing the clock twice a year',
  ' is also tiring.',
]
