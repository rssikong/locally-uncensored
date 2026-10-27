/**
 * Extra pages of the strand "remote".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/remote/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'remote-example', owner: 'remote' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/remote/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/remote/example/:id', { id }) is known to the compiler.
 */
import { defineRoutes } from '../../nav/define'

export const REMOTE_ROUTES = defineRoutes({
  // A17: a shared chat of the computer (CHATS-V1), live.
  '/remote/shared/:id': { code: 'R4', title: 'Chat on your computer', kind: 'page', tab: 'chat', screen: 'remote-shared', owner: 'remote' },
})
