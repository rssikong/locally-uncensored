/**
 * Bring the saved stack back at start (ARCHITEKTUR.md 3.5).
 *
 * After the onboarding a start always lands in a new chat (round 57): the
 * chat tab is set to the list with a new chat on top, whatever it showed
 * before. The other tabs get their saved pages back.
 *
 * Every saved page is checked: the route must exist, a flow step only comes
 * back inside the flow, a developer page only with the switch, a page the
 * store switches close not at all, and a page
 * that points at a chat only when that chat still exists. Whatever fails is
 * cut off together with everything above it.
 */
import * as core from './core'
import { navApi } from './api'
import { FLOW_FIRST_ROUTES, NAV_STORAGE_KEY, NEW_CHAT_PARAMS, NEW_CHAT_ROUTE, TAB_ROOT_ROUTES } from './roots'
import { ROUTE_IDS, routeDef } from './routes'
import { newKey } from './store'
import type { NavState } from './types'
import { routeGate } from '../policy/gates'

export interface RestoreInput {
  /** False sends the user into the onboarding. */
  onboardingDone: boolean
  /** Developer pages may come back. */
  devPages: boolean
  /** Path to open on top, from the developer switch ?route=/dev/ui. */
  devRoute?: string | null
  /** Does this chat still exist. Undefined while the chat store has not loaded: then the page is kept. */
  chatExists?: (id: string) => boolean
  /**
   * The chats in which a kill ended a running answer, the latest first
   * (lib/interrupted-runs.ts, chatsCutByKill). The start opens the first of
   * them that still exists instead of an empty new chat.
   */
  cutChats?: readonly string[]
  /** Read the saved text. Default: localStorage. */
  read?: () => string | null
  /**
   * The app reloaded itself while it ran (the error screen, "Restart"): no cold start, the saved stack comes
   * back as it was. Default: the mark of markWarmReload, taken once.
   */
  warm?: boolean
}

/** sessionStorage key: the next load is the app restarting itself, not a start by the user. */
const WARM_RELOAD_KEY = 'lu-mobile-warm-reload'

/**
 * Call right before the app reloads itself while it runs. The next start then brings back the page that
 * was open instead of a new chat. sessionStorage: a mark that never outlives the process of the app.
 */
export function markWarmReload(): void {
  try {
    sessionStorage.setItem(WARM_RELOAD_KEY, '1')
  } catch {
    /* without the mark the restart opens a new chat, as a cold start does */
  }
}

function takeWarmReload(): boolean {
  try {
    const warm = sessionStorage.getItem(WARM_RELOAD_KEY) === '1'
    if (warm) sessionStorage.removeItem(WARM_RELOAD_KEY)
    return warm
  } catch {
    return false
  }
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(NAV_STORAGE_KEY)
  } catch {
    return null
  }
}

/** Pure given its input: the state the shell starts with. */
export function restoredState(input: RestoreInput): NavState {
  let raw: unknown = null
  try {
    const text = (input.read ?? readSaved)()
    raw = text ? JSON.parse(text) : null
  } catch {
    raw = null
  }
  let state = core.restore(raw, {
    roots: TAB_ROOT_ROUTES,
    key: newKey,
    isValid: (page, where) => {
      const def = routeDef(page.route)
      if (!def) return false
      if (def.kind === 'root') return false
      if (def.dev && !input.devPages) return false
      // A page the store switches of this build close does not come back (a stack saved by an earlier build).
      if (routeGate(page.route)) return false
      if (def.kind === 'flow' && where !== 'onboarding') return false
      if (page.route.startsWith('/chat/:id')) {
        const id = page.params.id
        if (!id) return false
        if (id !== NEW_CHAT_PARAMS.id && input.chatExists && !input.chatExists(id)) return false
      }
      return true
    },
  })

  if (!input.onboardingDone) {
    if (!state.flow) state = core.startFlow(state, 'onboarding', core.page(FLOW_FIRST_ROUTES.onboarding, {}, newKey('flow')))
  } else {
    if (state.flow) state = core.finishFlow(state)
    // A cold start always opens a new, empty chat in the chat tab, the list one step back (DESIGN.md 2.2, round 57).
    // The app was closed for good; what the chat tab showed before is one tap away in the list. Only a return
    // from the background (the process lived on) keeps the open chat, and that never comes through here. The
    // pages of the other tabs wait behind their tabs. The new chat is not a chat of the list until its first
    // message, so starting again and again never stacks empty chats.
    //
    // One exception: the app was killed in the middle of an answer. The start opens the chat where it happened
    // (second check on Android, F9), the latest of them that is known to exist.
    const chat = state.stacks.chat
    const root = chat[0]
    const cut = (input.cutChats ?? []).find((id) => id !== NEW_CHAT_PARAMS.id && input.chatExists?.(id) === true)
    if (input.warm) {
      // The app restarted itself: what was open stays, a cut answer only over the list or an untouched new chat.
      const top = chat[chat.length - 1]
      const onNewChat = chat.length === 2 && top.route === NEW_CHAT_ROUTE && top.params.id === NEW_CHAT_PARAMS.id
      if (cut && (chat.length === 1 || onNewChat)) state = { ...state, stacks: { ...state.stacks, chat: [root, core.page(NEW_CHAT_ROUTE, { id: cut }, newKey('chat-cut'))] } }
      else if (chat.length === 1) state = { ...state, stacks: { ...state.stacks, chat: [root, core.page(NEW_CHAT_ROUTE, { ...NEW_CHAT_PARAMS }, newKey('chat-new'))] } }
    } else {
      const top = cut ? core.page(NEW_CHAT_ROUTE, { id: cut }, newKey('chat-cut')) : core.page(NEW_CHAT_ROUTE, { ...NEW_CHAT_PARAMS }, newKey('chat-new'))
      state = { ...state, tab: 'chat', stacks: { ...state.stacks, chat: [root, top] } }
    }
  }

  if (input.devRoute && input.devPages) {
    const match = core.matchPath(input.devRoute, ROUTE_IDS)
    if (match && routeDef(match.route)?.kind !== 'root') {
      state = core.push(state, core.page(match.route, match.params, newKey('dev')))
    }
  }
  return state
}

/** Load the restored state into the router. */
export function restoreNav(input: RestoreInput): void {
  navApi.load(restoredState({ ...input, warm: input.warm ?? takeWarmReload() }))
}
