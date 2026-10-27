/**
 * Extra sheets of the strand "create".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Its file goes into
 * ./loaders.ts under the same key.
 */
import { defineSheets } from '../../nav/define'

export const CREATE_SHEETS = defineSheets({
  // K7.8: resolution and price of "Enhance video".
  'create-enhance': { code: 'K7', title: 'Enhance video', owner: 'create' },
  // K12: what a step of a guided preset opens: its models, more settings, a choice list, prompt ideas, the gallery as a picker.
  'create-preset': { code: 'K12', title: 'Preset', owner: 'create' },
  // K10.2: "More" of a character card.
  'create-character': { code: 'K10', title: 'Character', owner: 'create' },
  // R53: model and settings of a job on the user's computer ("My computer").
  'create-computer': { code: 'K14', title: 'On your computer', owner: 'create' },
})
