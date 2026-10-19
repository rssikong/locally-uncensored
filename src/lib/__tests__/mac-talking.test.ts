import { describe, it, expect } from 'vitest'
import { macTalkingPrompt } from '../mac-talking'

describe('the prompt of a talking run on a Mac', () => {
  it('quotes what the voice says and tells the model to move the lips', () => {
    expect(macTalkingPrompt('Hello there.')).toBe(
      'A person talks directly to the camera and says: "Hello there." Their lips move clearly with every word, natural expression, slight head movement, static camera.',
    )
  })

  it('goes on the voice alone without words, and keeps one quote with them', () => {
    expect(macTalkingPrompt('   ')).toBe('A person talks directly to the camera. Their lips move clearly with every word, natural expression, slight head movement, static camera.')
    expect(macTalkingPrompt('say  "hi"\n now')).toContain('says: "say \'hi\' now"')
  })
})
