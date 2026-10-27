/**
 * Files of the extra pages and sheets of the strand "settings".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key:
 *
 *   export const SETTINGS_ROUTE_LOADERS: Record<keyof typeof SETTINGS_ROUTES, ScreenLoader> = {
 *     '/settings/example/:id': () => import('./ExamplePage'),
 *   }
 *
 * The compiler asks for a loader for every key and refuses one too many.
 * Names and files live in two files so a page can import `nav` without
 * landing in a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { SETTINGS_ROUTES } from './routes'
import type { SETTINGS_SHEETS } from './sheets'

export const SETTINGS_ROUTE_LOADERS: Record<keyof typeof SETTINGS_ROUTES, ScreenLoader> = {}

export const SETTINGS_SHEET_LOADERS: Record<keyof typeof SETTINGS_SHEETS, ScreenLoader> = {
  'settings-licenses': () => import('./LicensesSheet'),
  'settings-delete-account': () => import('./DeleteAccountSheet'),
  'settings-forgot-password': () => import('./ForgotPasswordSheet'),
  'settings-new-password': () => import('./NewPasswordSheet'),
  'settings-add-credits': () => import('./AddCreditsSheet'),
  'settings-cloud-plans': () => import('./cloud/PlansSheet'),
}
