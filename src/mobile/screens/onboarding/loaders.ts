/**
 * Files of the extra pages and sheets of the strand "onboarding".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key:
 *
 *   export const ONBOARDING_ROUTE_LOADERS: Record<keyof typeof ONBOARDING_ROUTES, ScreenLoader> = {
 *     '/onboarding/example/:id': () => import('./ExamplePage'),
 *   }
 *
 * The compiler asks for a loader for every key and refuses one too many.
 * Names and files live in two files so a page can import `nav` without
 * landing in a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { ONBOARDING_ROUTES } from './routes'
import type { ONBOARDING_SHEETS } from './sheets'

export const ONBOARDING_ROUTE_LOADERS: Record<keyof typeof ONBOARDING_ROUTES, ScreenLoader> = {}

export const ONBOARDING_SHEET_LOADERS: Record<keyof typeof ONBOARDING_SHEETS, ScreenLoader> = {}
