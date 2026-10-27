/**
 * Extra sheets of the strand "remote".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Use the strand name as a
 * prefix so two strands never pick the same id:
 *
 *   'remote-example': { code: 'X1', title: 'Example', owner: 'remote' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   'remote-example': () => import('./ExampleSheet'),
 *
 * Then nav.openSheet('remote-example', props) is known to the compiler.
 */
import { defineSheets } from '../../nav/define'

export const REMOTE_SHEETS = defineSheets({
  // The models of the desktop (the model sheet C3 of strand 1 lists the ones on this phone).
  'remote-model': { code: 'R4', title: 'Model on your desktop', owner: 'remote' },
  // Camera and library for one message (C4 for R4).
  'remote-attach': { code: 'R4', title: 'Add photos', owner: 'remote' },
  // Agent mode, thinking, persona and the short way of speaking of one remote chat (C5 for R4).
  'remote-options': { code: 'R4', title: 'Chat options', owner: 'remote' },
  // Copy and Report for one answer (C6 for R4).
  'remote-message': { code: 'R4', title: 'Message', owner: 'remote' },
  // Rename and delete a remote chat (C7 for R4 and R1.5).
  'remote-chat-menu': { code: 'R4', title: 'Remote chat', owner: 'remote' },
  // Address, way, version, what the desktop allows, disconnect and forget.
  'remote-connection': { code: 'R1', title: 'Connection', owner: 'remote' },
  // A17: what runs on the computer, with Stop.
  'remote-tasks': { code: 'R1', title: 'Running on your computer', owner: 'remote' },
  // A17: a new chat on the computer: Chat, Agent or Code.
  'remote-new-shared': { code: 'R1', title: 'New chat on your computer', owner: 'remote' },
  // A17: the model of a shared chat for the next messages.
  'remote-shared-model': { code: 'R4', title: 'Model on your computer', owner: 'remote' },
})
