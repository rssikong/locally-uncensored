import { MOUNTED_PAGES } from '../nav/Stack'

/** The pages that draw the notices of the engine (G10) themselves: the chat (C2), the engine page (E13) and its advanced page (E13.8). */
export const DRAWS_ENGINE_NOTICES: readonly string[] = ['/chat/:id', '/settings/engine', '/settings/engine/advanced']

/** Pure: is one of the mounted pages a page that draws the notices of the engine itself. `routes` is the stack, bottom first. */
export function engineNoticesMounted(routes: readonly string[]): boolean {
  return routes.slice(-MOUNTED_PAGES).some((route) => DRAWS_ENGINE_NOTICES.includes(route))
}
