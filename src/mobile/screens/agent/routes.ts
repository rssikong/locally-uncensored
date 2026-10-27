/**
 * Extra pages of the strand "agent".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/agent/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'agent-example', owner: 'agent' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/agent/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/agent/example/:id', { id }) is known to the compiler.
 */
import { defineRoutes } from '../../nav/define'

export const AGENT_ROUTES = defineRoutes({
  // E10.5: the form of one step of a workflow, a page of its own under its workflow.
  '/settings/workflows/:id/step/:stepId': { code: 'E10', title: 'Step', kind: 'page', tab: 'settings', screen: 'agent-workflow-step', owner: 'agent' },
})
