/**
 * Extra sheets of the strand "onboarding".
 *
 * The sheets from DESIGN.md are already in nav/sheets.ts, which only the
 * scaffold changes. A sheet this strand needs on top of those goes HERE and
 * is merged into the sheet table automatically. Use the strand name as a
 * prefix so two strands never pick the same id:
 *
 *   'onboarding-example': { code: 'X1', title: 'Example', owner: 'onboarding' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   'onboarding-example': () => import('./ExampleSheet'),
 *
 * Then nav.openSheet('onboarding-example', props) is known to the compiler.
 */
import { defineSheets } from '../../nav/define'

export const ONBOARDING_SHEETS = defineSheets({})
