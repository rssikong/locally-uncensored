/**
 * The route table: every page of the mobile shell from DESIGN.md section 3.
 *
 * Paths are ids of the shell's own stack router, not browser addresses.
 * Each route has one file under src/mobile/screens/<strand>/, named in
 * nav/loaders.ts. The scaffold wrote all of them as placeholders; a strand
 * fills the file and leaves this table alone.
 *
 * The files are NOT imported here. This table is what `nav` reads its ids
 * from, and every screen imports `nav`; a loader in here would close a
 * circle from each screen back to itself (npm run cycles).
 *
 * A strand that needs a page that is not listed here adds it to ITS OWN
 * registry, screens/<strand>/routes.ts, which is merged in below. That keeps
 * this file free of merge conflicts between strands (src/mobile/STRAENGE.md).
 */
import { defineRoutes, type RouteDef } from './define'
import type { Tab } from './types'
import { CHAT_ROUTES } from '../screens/chat/routes'
import { AGENT_ROUTES } from '../screens/agent/routes'
import { CREATE_ROUTES } from '../screens/create/routes'
import { ONBOARDING_ROUTES } from '../screens/onboarding/routes'
import { MODELS_ROUTES } from '../screens/models/routes'
import { SETTINGS_ROUTES } from '../screens/settings/routes'
import { REMOTE_ROUTES } from '../screens/remote/routes'

const CORE_ROUTES = defineRoutes({
  // ---- 4.1 Onboarding (strand 4) ----
  '/welcome': { code: 'A1', title: 'Welcome', kind: 'flow', tab: 'none', screen: 'onboarding', owner: 'onboarding' },
  '/setup/model': { code: 'A2', title: 'Pick a starter model', kind: 'flow', tab: 'none', screen: 'onboarding-model', owner: 'onboarding' },
  '/setup/documents': { code: 'A3', title: 'Document Chat', kind: 'flow', tab: 'none', screen: 'onboarding-documents', owner: 'onboarding' },
  '/setup/done': { code: 'A4', title: "You're all set", kind: 'flow', tab: 'none', screen: 'onboarding-done', owner: 'onboarding' },

  // ---- 4.2 Chat (strand 1) ----
  '/chats': { code: 'C1', title: 'Chats', kind: 'root', tab: 'chat', screen: 'chats', owner: 'chat' },
  '/chat/:id': { code: 'C2', title: 'Chat', kind: 'page', tab: 'chat', screen: 'chat', owner: 'chat' },
  '/chat/:id/file/:fileId': { code: 'C14', title: 'File', kind: 'full', tab: 'chat', screen: 'chat-file', owner: 'chat' },
  '/chat/:id/message/:messageId/edit': { code: 'C6', title: 'Edit answer', kind: 'full', tab: 'chat', screen: 'chat-message-edit', owner: 'chat' },
  '/chat/:id/message/:messageId/text': { code: 'C6', title: 'Select text', kind: 'page', tab: 'chat', screen: 'chat-message-text', owner: 'chat' },

  // ---- 4.2 Chat, agent and knowledge (strand 2) ----
  '/chat/:id/documents': { code: 'C8', title: 'Documents', kind: 'page', tab: 'chat', screen: 'chat-documents', owner: 'agent' },
  '/chat/:id/compare': { code: 'C9', title: 'Compare', kind: 'page', tab: 'chat', screen: 'chat-compare', owner: 'agent' },
  '/chat/:id/tasks': { code: 'C10', title: 'Background tasks', kind: 'page', tab: 'chat', screen: 'chat-tasks', owner: 'agent' },
  '/chat/:id/preview/:blockId': { code: 'C11', title: 'Preview', kind: 'full', tab: 'chat', screen: 'chat-preview', owner: 'agent' },
  '/chat/:id/group': { code: 'C13', title: 'Group chat', kind: 'page', tab: 'chat', screen: 'chat-group', owner: 'agent' },

  // ---- 4.3 Remote (strand 6). R1 is a segment of /chats, see screens/remote/RemoteHome.tsx ----
  '/remote/connect': { code: 'R2', title: 'Connect to desktop', kind: 'page', tab: 'chat', screen: 'remote-connect', owner: 'remote' },
  '/remote/scan': { code: 'R3', title: 'Scan code', kind: 'full', tab: 'chat', screen: 'remote-scan', owner: 'remote' },
  '/remote/chat/:id': { code: 'R4', title: 'Remote chat', kind: 'page', tab: 'chat', screen: 'remote-chat', owner: 'remote' },
  '/remote/help': { code: 'R5', title: 'How it works', kind: 'page', tab: 'any', screen: 'remote-help', owner: 'remote' },

  // ---- 4.4 Create (strand 3) ----
  '/create': { code: 'K1', title: 'Create', kind: 'root', tab: 'create', screen: 'create', owner: 'create' },
  '/create/gallery': { code: 'K6', title: 'Gallery', kind: 'page', tab: 'create', screen: 'create-gallery', owner: 'create' },
  '/create/item/:id': { code: 'K7', title: 'Result', kind: 'full', tab: 'create', screen: 'create-item', owner: 'create' },
  '/create/mask': { code: 'K9', title: 'Paint the area', kind: 'full', tab: 'create', screen: 'create-mask', owner: 'create' },
  '/create/characters': { code: 'K10', title: 'Characters', kind: 'page', tab: 'create', screen: 'create-characters', owner: 'create' },
  '/create/characters/new': { code: 'K11', title: 'New character', kind: 'page', tab: 'create', screen: 'create-character-new', owner: 'create' },
  '/create/presets': { code: 'K12', title: 'Presets', kind: 'page', tab: 'create', screen: 'create-presets', owner: 'create' },
  '/create/showcase': { code: 'K13', title: 'What you can make', kind: 'page', tab: 'create', screen: 'create-showcase', owner: 'create' },
  '/create/batch': { code: 'K14', title: 'Batch', kind: 'page', tab: 'create', screen: 'create-batch', owner: 'create' },

  // ---- 4.5 Models (strand 4) ----
  '/models': { code: 'M1', title: 'Models', kind: 'root', tab: 'models', screen: 'models', owner: 'models' },
  '/models/downloads': { code: 'M3', title: 'Downloads', kind: 'page', tab: 'models', screen: 'models-downloads', owner: 'models' },
  '/models/benchmark': { code: 'M4', title: 'Benchmark', kind: 'page', tab: 'models', screen: 'models-benchmark', owner: 'models' },
  '/models/:id': { code: 'M2', title: 'Model', kind: 'page', tab: 'models', screen: 'models-detail', owner: 'models' },
  '/settings/engine': { code: 'E13', title: 'On device engine', kind: 'page', tab: 'settings', screen: 'settings-engine', owner: 'models' },
  '/settings/storage': { code: 'E14', title: 'Storage and downloads', kind: 'page', tab: 'settings', screen: 'settings-storage', owner: 'models' },

  // ---- 4.6 Settings: account, cloud, app (strand 5) ----
  '/settings': { code: 'E1', title: 'Settings', kind: 'root', tab: 'settings', screen: 'settings', owner: 'settings' },
  '/settings/account': { code: 'E2', title: 'Account', kind: 'page', tab: 'settings', screen: 'account', owner: 'settings' },
  '/cloud': { code: 'E3', title: 'LU Cloud', kind: 'page', tab: 'any', screen: 'cloud', owner: 'settings' },
  '/settings/appearance': { code: 'E4', title: 'Appearance', kind: 'page', tab: 'settings', screen: 'settings-appearance', owner: 'settings' },
  '/settings/chat': { code: 'E5', title: 'Chat defaults', kind: 'page', tab: 'settings', screen: 'settings-chat', owner: 'settings' },
  '/settings/voice': { code: 'E11', title: 'Voice', kind: 'page', tab: 'settings', screen: 'settings-voice', owner: 'settings' },
  '/settings/providers': { code: 'E12', title: 'Providers', kind: 'page', tab: 'settings', screen: 'settings-providers', owner: 'settings' },
  '/settings/providers/:id': { code: 'E12', title: 'Provider', kind: 'page', tab: 'settings', screen: 'settings-provider', owner: 'settings' },
  '/settings/remote': { code: 'E15', title: 'Remote desktop', kind: 'page', tab: 'settings', screen: 'settings-remote', owner: 'settings' },
  '/settings/data': { code: 'E16', title: 'Backup and import', kind: 'page', tab: 'settings', screen: 'settings-data', owner: 'settings' },
  '/settings/data/import': { code: 'E16', title: 'Import chats', kind: 'page', tab: 'any', screen: 'settings-data-import', owner: 'settings' },
  '/settings/privacy': { code: 'E17', title: 'Privacy', kind: 'page', tab: 'settings', screen: 'settings-privacy', owner: 'settings' },
  '/settings/content-policy': { code: 'E18', title: 'Content policy', kind: 'page', tab: 'settings', screen: 'settings-content-policy', owner: 'settings' },
  '/settings/troubleshooting': { code: 'E19', title: 'Troubleshooting', kind: 'page', tab: 'settings', screen: 'settings-troubleshooting', owner: 'settings' },
  '/settings/about': { code: 'E20', title: 'About LU', kind: 'page', tab: 'settings', screen: 'settings-about', owner: 'settings' },
  '/whats-new': { code: 'E21', title: 'What is new', kind: 'page', tab: 'any', screen: 'whats-new', owner: 'settings' },

  // ---- 4.6 Settings: agent and knowledge (strand 2) ----
  '/settings/personas': { code: 'E6', title: 'Personas', kind: 'page', tab: 'settings', screen: 'settings-personas', owner: 'agent' },
  '/settings/personas/:id': { code: 'E6', title: 'Persona', kind: 'page', tab: 'settings', screen: 'settings-persona', owner: 'agent' },
  '/settings/memory': { code: 'E7', title: 'Memory', kind: 'page', tab: 'any', screen: 'settings-memory', owner: 'agent' },
  '/settings/memory/:id': { code: 'E7', title: 'Memory', kind: 'page', tab: 'any', screen: 'settings-memory-detail', owner: 'agent' },
  '/settings/agent': { code: 'E8', title: 'Agent and permissions', kind: 'page', tab: 'settings', screen: 'settings-agent', owner: 'agent' },
  '/settings/search': { code: 'E9', title: 'Web search', kind: 'page', tab: 'settings', screen: 'settings-search', owner: 'agent' },
  '/settings/workflows': { code: 'E10', title: 'Workflows', kind: 'page', tab: 'settings', screen: 'settings-workflows', owner: 'agent' },
  '/settings/workflows/:id': { code: 'E10', title: 'Workflow', kind: 'page', tab: 'settings', screen: 'settings-workflow', owner: 'agent' },

  // ---- internal, developer switch only ----
  '/dev/ui': { code: 'DEV', title: 'UI catalogue', kind: 'page', tab: 'any', screen: 'dev-ui', owner: 'shell', dev: true },
  '/dev/routes': { code: 'DEV', title: 'All screens', kind: 'page', tab: 'any', screen: 'dev-routes', owner: 'shell', dev: true },
  '/dev/frame': { code: 'DEV', title: 'Page frame', kind: 'page', tab: 'any', screen: 'dev-frame', owner: 'shell', dev: true },
  '/dev/composer': { code: 'DEV', title: 'Composer page', kind: 'page', tab: 'any', screen: 'dev-composer', owner: 'shell', dev: true },
  '/dev/viewer': { code: 'DEV', title: 'Viewer', kind: 'full', tab: 'any', screen: 'dev-viewer', owner: 'shell', dev: true },
})

export const ROUTES = {
  ...CORE_ROUTES,
  ...CHAT_ROUTES,
  ...AGENT_ROUTES,
  ...CREATE_ROUTES,
  ...ONBOARDING_ROUTES,
  ...MODELS_ROUTES,
  ...SETTINGS_ROUTES,
  ...REMOTE_ROUTES,
} satisfies Record<string, RouteDef>

export type RouteId = keyof typeof ROUTES

export const ROUTE_IDS = Object.keys(ROUTES) as RouteId[]

export const TAB_ROOTS: Record<Tab, RouteId> = {
  chat: '/chats',
  create: '/create',
  models: '/models',
  settings: '/settings',
}

export const FLOW_FIRST = { onboarding: '/welcome' } as const satisfies Record<string, RouteId>

/** The stack a cold start lands on without anything saved: the list, and a new chat on top. */
export const NEW_CHAT_ID = 'new'

export function routeDef(route: string): RouteDef | undefined {
  return (ROUTES as Record<string, RouteDef>)[route]
}

export function isRouteId(route: string): route is RouteId {
  return Object.prototype.hasOwnProperty.call(ROUTES, route)
}

/** Parameter names of a route id, in order. "/chat/:id/file/:fileId" gives ["id", "fileId"]. */
export function routeParamNames(route: string): string[] {
  return route.split('/').filter((part) => part.startsWith(':')).map((part) => part.slice(1))
}

type ParamNames<S extends string> = S extends `${string}:${infer P}/${infer Rest}`
  ? P | ParamNames<`/${Rest}`>
  : S extends `${string}:${infer P}`
    ? P
    : never

/** The params object a route needs. Routes without parameters need none. */
export type RouteParams<R extends string> = [ParamNames<R>] extends [never] ? undefined : Record<ParamNames<R>, string>
