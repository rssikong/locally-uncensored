/**
 * Extra sheets of the strand "models".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Use the strand name as a
 * prefix so two strands never pick the same id:
 *
 *   'models-example': { code: 'X1', title: 'Example', owner: 'models' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   'models-example': () => import('./ExampleSheet'),
 *
 * Then nav.openSheet('models-example', props) is known to the compiler.
 */
import { defineSheets } from '../../nav/define'

export const MODELS_SHEETS = defineSheets({})
