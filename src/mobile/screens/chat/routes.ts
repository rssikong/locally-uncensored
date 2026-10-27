/**
 * Extra pages of the strand "chat".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/chat/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'chat-example', owner: 'chat' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/chat/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/chat/example/:id', { id }) is known to the compiler.
 *
 * The strand needs no extra page: C1, C2, C14 and the two pages of C6 are in
 * the table of the scaffold.
 */
import { defineRoutes } from '../../nav/define'

export const CHAT_ROUTES = defineRoutes({})
