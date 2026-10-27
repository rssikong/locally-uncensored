/**
 * Extra pages of the strand "onboarding".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/onboarding/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'onboarding-example', owner: 'onboarding' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/onboarding/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/onboarding/example/:id', { id }) is known to the compiler.
 */
import { defineRoutes } from '../../nav/define'

export const ONBOARDING_ROUTES = defineRoutes({})
