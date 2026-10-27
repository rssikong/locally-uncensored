/**
 * Files of the extra pages and sheets of the strand "chat".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key:
 *
 *   export const CHAT_ROUTE_LOADERS: Record<keyof typeof CHAT_ROUTES, ScreenLoader> = {
 *     '/chat/example/:id': () => import('./ExamplePage'),
 *   }
 *
 * The compiler asks for a loader for every key and refuses one too many.
 * Names and files live in two files so a page can import `nav` without
 * landing in a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { CHAT_ROUTES } from './routes'
import type { CHAT_SHEETS } from './sheets'

export const CHAT_ROUTE_LOADERS: Record<keyof typeof CHAT_ROUTES, ScreenLoader> = {}

export const CHAT_SHEET_LOADERS: Record<keyof typeof CHAT_SHEETS, ScreenLoader> = {
  'chat-voice-gate': () => import('./VoiceGateSheet'),
  'chat-link': () => import('./LinkSheet'),
}
