/**
 * Extra pages of the strand "create".
 *
 * The pages from DESIGN.md are already in nav/routes.ts, which only the
 * scaffold changes. A page this strand needs on top of those goes HERE, in
 * the same shape, and is merged into the route table automatically:
 *
 *   '/create/example/:id': { code: 'X1', title: 'Example', kind: 'page', tab: 'any',
 *     screen: 'create-example', owner: 'create' },
 *
 * Its file goes into ./loaders.ts under the same key:
 *
 *   '/create/example/:id': () => import('./ExamplePage'),
 *
 * Then nav.push('/create/example/:id', { id }) is known to the compiler.
 */
import { defineRoutes } from '../../nav/define'

export const CREATE_ROUTES = defineRoutes({
  // K6.4: the gallery as a picker. The purpose (source, extend, voice) is part of the address.
  // K12b: prompt styles, the prompt building blocks. '/create/presets' (K12) is the list of the guided presets.
  '/create/styles': { code: 'K12', title: 'Prompt styles', kind: 'page', tab: 'create', screen: 'create-styles', owner: 'create' },
  // K12: one guided preset, step by step.
  '/create/presets/:id': { code: 'K12', title: 'Preset', kind: 'page', tab: 'create', screen: 'create-preset', owner: 'create' },
  // A17: the painted area of photo 1 of an edit on "My computer" (the editor of K9, its own owner).
  '/create/computer-mask': { code: 'K9', title: 'Paint the area', kind: 'full', tab: 'create', screen: 'create-computer-mask', owner: 'create' },
  '/create/gallery/pick/:purpose': { code: 'K6', title: 'Pick from gallery', kind: 'page', tab: 'create', screen: 'create-gallery-pick', owner: 'create' },
})
