/**
 * Extra pages of the strand "settings".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/settings/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'settings-example', owner: 'settings' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/settings/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/settings/example/:id', { id }) is known to the compiler.
 */
import { defineRoutes } from '../../nav/define'

export const SETTINGS_ROUTES = defineRoutes({})
