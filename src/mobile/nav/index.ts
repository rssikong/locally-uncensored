/**
 * The public face of the stack router. This is the only file screens import
 * from for navigation.
 *
 *   nav.push('/chat/:id', { id })      nav.replace(...)        nav.back()
 *   nav.switchTab('models')            nav.resetTo('chat', [...])
 *   nav.openSheet('model', { onPick }) nav.sheetPush('price')  nav.closeSheet()
 *   await nav.confirm({ title, confirmLabel, tone: 'danger' })
 *   await nav.prompt({ title, confirmLabel, field: { label } })
 *   useRoute()  useParams()  useIsTop()  useSheet()  useLeaveGuard(dirty)  useGuardedLeave(dirty)
 *
 * Route and sheet ids are checked by the compiler against nav/routes.ts and
 * nav/sheets.ts.
 */
import { navApi } from './api'
import type { RouteId, RouteParams } from './routes'
import type { SheetId } from './sheets'
import type { DialogSpec, FlowId, NavState, Params, Tab } from './types'

type PushArgs<R extends RouteId> = RouteParams<R> extends undefined ? [] : [params: RouteParams<R>]

export interface PageTarget {
  route: RouteId
  params?: Params
}

export const nav = {
  push<R extends RouteId>(route: R, ...args: PushArgs<R>): void {
    navApi.push(route, args[0] as Params | undefined)
  },
  replace<R extends RouteId>(route: R, ...args: PushArgs<R>): void {
    navApi.replace(route, args[0] as Params | undefined)
  },
  /** One step back: dialog, sub page of a sheet, sheet, page, tab. False when nothing was left to close. */
  back: (): boolean => navApi.back(),
  switchTab: (tab: Tab): void => navApi.switchTab(tab),
  resetTo: (tab: Tab, pages: PageTarget[] = []): void => navApi.resetTo(tab, pages),
  openSheet: (sheet: SheetId, props?: unknown): void => navApi.openSheet(sheet, props),
  sheetPush: (sub: string): void => navApi.sheetPush(sub),
  closeSheet: (): void => navApi.closeSheet(),
  confirm: (spec: DialogSpec): Promise<boolean> => navApi.confirm(spec),
  prompt: (spec: DialogSpec): Promise<string | null> => navApi.prompt(spec),
  setLeaveGuard: (pageKey: string, isDirty: (() => boolean) | null): void => navApi.setLeaveGuard(pageKey, isDirty),
  startFlow: (flow: FlowId): void => navApi.startFlow(flow),
  finishFlow: (tab: Tab = 'chat', pages: PageTarget[] = []): void => navApi.finishFlow(tab, pages),
  getState: (): NavState => navApi.getState(),
}

export { useRoute, useParams, useIsTop, useSheet, useNavState, useLeaveGuard, usePage, pageControlId, sheetControlId, type PagePlace } from './context'
export { useGuardedLeave } from './guarded-leave'
export { currentLinkOffer, useLinkOfferStore, receiveDeepLink, type LinkOffer } from './deeplink'
export { useChatsSegment, showChatsSegment, type ChatsSegment } from './chats-segment'
export type { RouteId, RouteParams } from './routes'
export type { SheetId } from './sheets'
export type { Tab, DialogSpec, FlowId, Params } from './types'
export { TABS } from './types'
