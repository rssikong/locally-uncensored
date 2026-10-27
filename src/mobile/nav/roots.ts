/** The root route of each tab and the first page of each flow. No imports, so the controller can use it without the route table. */
import type { FlowId, Tab } from './types'

export const TAB_ROOT_ROUTES: Record<Tab, string> = {
  chat: '/chats',
  create: '/create',
  models: '/models',
  settings: '/settings',
}

export const FLOW_FIRST_ROUTES: Record<FlowId, string> = { onboarding: '/welcome' }

export const NEW_CHAT_ROUTE = '/chat/:id'
export const NEW_CHAT_PARAMS = { id: 'new' } as const

/** localStorage key of the saved stack (ARCHITEKTUR.md 3.5). */
export const NAV_STORAGE_KEY = 'lu-mobile-nav'
