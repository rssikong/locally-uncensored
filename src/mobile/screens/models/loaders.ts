/**
 * Files of the extra pages and sheets of the strand "models".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key:
 *
 *   export const MODELS_ROUTE_LOADERS: Record<keyof typeof MODELS_ROUTES, ScreenLoader> = {
 *     '/models/example/:id': () => import('./ExamplePage'),
 *   }
 *
 * The compiler asks for a loader for every key and refuses one too many.
 * Names and files live in two files so a page can import `nav` without
 * landing in a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { MODELS_ROUTES } from './routes'
import type { MODELS_SHEETS } from './sheets'

export const MODELS_ROUTE_LOADERS: Record<keyof typeof MODELS_ROUTES, ScreenLoader> = {
  '/settings/engine/advanced': () => import('./EngineAdvancedPage'),
}

export const MODELS_SHEET_LOADERS: Record<keyof typeof MODELS_SHEETS, ScreenLoader> = {}
