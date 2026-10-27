/**
 * Files of the extra pages and sheets of the strand "create".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key. The
 * compiler asks for a loader for every key and refuses one too many. Names
 * and files live in two files so a page can import `nav` without landing in
 * a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { CREATE_ROUTES } from './routes'
import type { CREATE_SHEETS } from './sheets'

export const CREATE_ROUTE_LOADERS: Record<keyof typeof CREATE_ROUTES, ScreenLoader> = {
  '/create/styles': () => import('./PromptStylesPage'),
  '/create/presets/:id': () => import('./PresetRunPage'),
  '/create/gallery/pick/:purpose': () => import('./GalleryPickPage'),
  '/create/computer-mask': () => import('./ComputerMaskPage'),
}

export const CREATE_SHEET_LOADERS: Record<keyof typeof CREATE_SHEETS, ScreenLoader> = {
  'create-enhance': () => import('./EnhanceVideoSheet'),
  'create-preset': () => import('./PresetSheet'),
  'create-character': () => import('./CharacterSheet'),
  'create-computer': () => import('./ComputerSettingsSheet'),
}
