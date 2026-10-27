/**
 * Which file a route or a sheet loads.
 *
 * Kept apart from nav/routes.ts and nav/sheets.ts on purpose. Every screen
 * imports `nav`, and `nav` reads its ids from those two tables. If the tables
 * also imported the screens, each screen would sit in a circle with itself.
 * So the tables hold names only, and this file, which nothing but the
 * renderer (Stack, Overlays) imports, holds the files.
 *
 * The compiler keeps both in step: a route without a loader, or a loader
 * without a route, does not build.
 */
import type { ScreenLoader } from './define'
import type { RouteId } from './routes'
import type { SheetId } from './sheets'
import { routeGate, sheetGate } from '../policy/gates'

import { CHAT_ROUTE_LOADERS, CHAT_SHEET_LOADERS } from '../screens/chat/loaders'
import { AGENT_ROUTE_LOADERS, AGENT_SHEET_LOADERS } from '../screens/agent/loaders'
import { CREATE_ROUTE_LOADERS, CREATE_SHEET_LOADERS } from '../screens/create/loaders'
import { ONBOARDING_ROUTE_LOADERS, ONBOARDING_SHEET_LOADERS } from '../screens/onboarding/loaders'
import { MODELS_ROUTE_LOADERS, MODELS_SHEET_LOADERS } from '../screens/models/loaders'
import { SETTINGS_ROUTE_LOADERS, SETTINGS_SHEET_LOADERS } from '../screens/settings/loaders'
import { REMOTE_ROUTE_LOADERS, REMOTE_SHEET_LOADERS } from '../screens/remote/loaders'

export const ROUTE_LOADERS: Record<RouteId, ScreenLoader> = {
  '/welcome': () => import('../screens/onboarding/WelcomePage'),
  '/setup/model': () => import('../screens/onboarding/SetupModelPage'),
  '/setup/documents': () => import('../screens/onboarding/SetupDocumentsPage'),
  '/setup/done': () => import('../screens/onboarding/SetupDonePage'),
  '/chats': () => import('../screens/chat/ChatsPage'),
  '/chat/:id': () => import('../screens/chat/ChatPage'),
  '/chat/:id/file/:fileId': () => import('../screens/chat/FileViewerPage'),
  '/chat/:id/message/:messageId/edit': () => import('../screens/chat/MessageEditPage'),
  '/chat/:id/message/:messageId/text': () => import('../screens/chat/MessageTextPage'),
  '/chat/:id/documents': () => import('../screens/agent/DocumentsPage'),
  '/chat/:id/compare': () => import('../screens/agent/ComparePage'),
  '/chat/:id/tasks': () => import('../screens/agent/TasksPage'),
  '/chat/:id/preview/:blockId': () => import('../screens/agent/PreviewPage'),
  '/chat/:id/group': () => import('../screens/agent/GroupChatPage'),
  '/remote/connect': () => import('../screens/remote/ConnectPage'),
  '/remote/scan': () => import('../screens/remote/ScanPage'),
  '/remote/chat/:id': () => import('../screens/remote/RemoteChatPage'),
  '/remote/help': () => import('../screens/remote/RemoteHelpPage'),
  '/create': () => import('../screens/create/CreatePage'),
  '/create/gallery': () => import('../screens/create/GalleryPage'),
  '/create/item/:id': () => import('../screens/create/ItemViewerPage'),
  '/create/mask': () => import('../screens/create/MaskEditorPage'),
  '/create/characters': () => import('../screens/create/CharactersPage'),
  '/create/characters/new': () => import('../screens/create/NewCharacterPage'),
  '/create/presets': () => import('../screens/create/PresetsPage'),
  '/create/showcase': () => import('../screens/create/ShowcasePage'),
  '/create/batch': () => import('../screens/create/BatchPage'),
  '/models': () => import('../screens/models/ModelsPage'),
  '/models/downloads': () => import('../screens/models/DownloadsPage'),
  '/models/benchmark': () => import('../screens/models/BenchmarkPage'),
  '/models/:id': () => import('../screens/models/ModelDetailPage'),
  '/settings/engine': () => import('../screens/models/EnginePage'),
  '/settings/storage': () => import('../screens/models/StoragePage'),
  '/settings': () => import('../screens/settings/SettingsPage'),
  '/settings/account': () => import('../screens/settings/AccountPage'),
  '/cloud': () => import('../screens/settings/cloud/CloudGatePage'),
  '/settings/appearance': () => import('../screens/settings/AppearancePage'),
  '/settings/chat': () => import('../screens/settings/ChatDefaultsPage'),
  '/settings/voice': () => import('../screens/settings/VoicePage'),
  '/settings/providers': () => import('../screens/settings/ProvidersPage'),
  '/settings/providers/:id': () => import('../screens/settings/ProviderDetailPage'),
  '/settings/remote': () => import('../screens/settings/RemoteSettingsPage'),
  '/settings/data': () => import('../screens/settings/DataPage'),
  '/settings/data/import': () => import('../screens/settings/DataImportPage'),
  '/settings/privacy': () => import('../screens/settings/PrivacyPage'),
  '/settings/content-policy': () => import('../screens/settings/ContentPolicyPage'),
  '/settings/troubleshooting': () => import('../screens/settings/TroubleshootingPage'),
  '/settings/about': () => import('../screens/settings/AboutPage'),
  '/whats-new': () => import('../screens/settings/WhatsNewPage'),
  '/settings/personas': () => import('../screens/agent/PersonasPage'),
  '/settings/personas/:id': () => import('../screens/agent/PersonaEditPage'),
  '/settings/memory': () => import('../screens/agent/MemoryPage'),
  '/settings/memory/:id': () => import('../screens/agent/MemoryDetailPage'),
  '/settings/agent': () => import('../screens/agent/AgentPermissionsPage'),
  '/settings/search': () => import('../screens/agent/WebSearchPage'),
  '/settings/workflows': () => import('../screens/agent/WorkflowsPage'),
  '/settings/workflows/:id': () => import('../screens/agent/WorkflowEditPage'),
  '/dev/ui': () => import('../dev/UiCatalogPage'),
  '/dev/routes': () => import('../dev/RoutesIndexPage'),
  '/dev/frame': () => import('../dev/FramePage'),
  '/dev/composer': () => import('../dev/ComposerPage'),
  '/dev/viewer': () => import('../dev/ViewerPage'),
  ...CHAT_ROUTE_LOADERS,
  ...AGENT_ROUTE_LOADERS,
  ...CREATE_ROUTE_LOADERS,
  ...ONBOARDING_ROUTE_LOADERS,
  ...MODELS_ROUTE_LOADERS,
  ...SETTINGS_ROUTE_LOADERS,
  ...REMOTE_ROUTE_LOADERS,
}

export const SHEET_LOADERS: Record<SheetId, ScreenLoader> = {
  model: () => import('../screens/chat/ModelSheet'),
  attach: () => import('../screens/chat/AttachSheet'),
  message: () => import('../screens/chat/MessageSheet'),
  'chat-menu': () => import('../screens/chat/ChatMenuSheet'),
  'chat-options': () => import('../screens/agent/ChatOptionsSheet'),
  approval: () => import('../screens/agent/ApprovalSheet'),
  tools: () => import('../screens/create/ToolsSheet'),
  'create-model': () => import('../screens/create/CreateModelSheet'),
  'run-settings': () => import('../screens/create/RunSettingsSheet'),
  source: () => import('../screens/create/SourceSheet'),
  result: () => import('../screens/create/ResultSheet'),
  credits: () => import('../resilience/CreditsSheet'),
  session: () => import('../resilience/SessionSheet'),
  price: () => import('../screens/settings/cloud/PriceSheet'),
  'link-offer': () => import('../resilience/LinkOfferSheet'),
  report: () => import('../policy/ReportSheet'),
  'ai-consent': () => import('../policy/ConsentSheet'),
  'dev-demo': () => import('../dev/DemoSheet'),
  ...CHAT_SHEET_LOADERS,
  ...AGENT_SHEET_LOADERS,
  ...CREATE_SHEET_LOADERS,
  ...ONBOARDING_SHEET_LOADERS,
  ...MODELS_SHEET_LOADERS,
  ...SETTINGS_SHEET_LOADERS,
  ...REMOTE_SHEET_LOADERS,
}

/** What a route or sheet shows that the store switches of this build close (policy/gates.ts). Stable, so the screen is not loaded twice. */
const UNAVAILABLE_PAGE: ScreenLoader = () => import('../policy/UnavailablePage')
const UNAVAILABLE_SHEET: ScreenLoader = () => import('../policy/UnavailableSheet')

/** The file of a route. A route this build closes gets the page "Not part of this version", whatever led there. */
export function routeLoader(route: string): ScreenLoader | undefined {
  const load = (ROUTE_LOADERS as Record<string, ScreenLoader | undefined>)[route]
  return load && routeGate(route) ? UNAVAILABLE_PAGE : load
}

export function sheetLoader(sheet: string): ScreenLoader | undefined {
  const load = (SHEET_LOADERS as Record<string, ScreenLoader | undefined>)[sheet]
  return load && sheetGate(sheet) ? UNAVAILABLE_SHEET : load
}
