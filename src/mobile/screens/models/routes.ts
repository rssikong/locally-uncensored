/**
 * Extra pages of the strand "models".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/models/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'models-example', owner: 'models' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/models/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/models/example/:id', { id }) is known to the compiler.
 *
 * E13.8 "Advanced" is such a page: DESIGN.md calls it a sub page of the
 * engine page, and it has no line of its own in nav/routes.ts.
 */
import { defineRoutes } from '../../nav/define'

export const MODELS_ROUTES = defineRoutes({
  '/settings/engine/advanced': { code: 'E13.8', title: 'Advanced', kind: 'page', tab: 'settings', screen: 'settings-engine-advanced', owner: 'models' },
})
