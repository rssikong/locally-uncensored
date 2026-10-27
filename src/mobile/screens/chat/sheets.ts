/**
 * Extra sheets of the strand "chat".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Use the strand name as a
 * prefix so two strands never pick the same id:
 *
 *   'chat-example': { code: 'X1', title: 'Example', owner: 'chat' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   'chat-example': () => import('./ExampleSheet'),
 *
 * Then nav.openSheet('chat-example', props) is known to the compiler.
 */
import { defineSheets } from '../../nav/define'

export const CHAT_SHEETS = defineSheets({
  /** C2.7 and C2.18: "Dictation uses LU Cloud" and "Read aloud uses LU Cloud". Props: { kind: 'dictate' | 'speak' }. */
  'chat-voice-gate': { code: 'C2', title: 'Voice uses LU Cloud', owner: 'chat' },
  /** C2.34: "Open link?" with the whole address. Props: { url }. */
  'chat-link': { code: 'C2', title: 'Open link?', owner: 'chat' },
})
