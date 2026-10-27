/**
 * Files of the extra pages and sheets of the strand "remote".
 *
 * One line per entry in ./routes.ts and ./sheets.ts, with the same key:
 *
 *   export const REMOTE_ROUTE_LOADERS: Record<keyof typeof REMOTE_ROUTES, ScreenLoader> = {
 *     '/remote/example/:id': () => import('./ExamplePage'),
 *   }
 *
 * The compiler asks for a loader for every key and refuses one too many.
 * Names and files live in two files so a page can import `nav` without
 * landing in a circle (nav/loaders.ts explains it).
 */
import type { ScreenLoader } from '../../nav/define'
import type { REMOTE_ROUTES } from './routes'
import type { REMOTE_SHEETS } from './sheets'

export const REMOTE_ROUTE_LOADERS: Record<keyof typeof REMOTE_ROUTES, ScreenLoader> = {
  '/remote/shared/:id': () => import('./SharedChatPage'),
}

export const REMOTE_SHEET_LOADERS: Record<keyof typeof REMOTE_SHEETS, ScreenLoader> = {
  'remote-model': () => import('./RemoteModelSheet'),
  'remote-attach': () => import('./RemoteAttachSheet'),
  'remote-options': () => import('./RemoteOptionsSheet'),
  'remote-message': () => import('./RemoteMessageSheet'),
  'remote-chat-menu': () => import('./RemoteChatMenuSheet'),
  'remote-connection': () => import('./RemoteConnectionSheet'),
  'remote-tasks': () => import('./RemoteTasksSheet'),
  'remote-new-shared': () => import('./SharedNewChatSheet'),
  'remote-shared-model': () => import('./SharedModelSheet'),
}
