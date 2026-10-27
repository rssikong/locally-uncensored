/**
 * Shapes of the route table and the sheet table.
 *
 * Kept apart from routes.ts and sheets.ts so the registries of the strands
 * (screens/<strand>/routes.ts and sheets.ts) can import the types without
 * importing the tables that import them.
 */
import type { ComponentType } from 'react'
import type { Tab } from './types'

export type Strand = 'chat' | 'agent' | 'create' | 'onboarding' | 'models' | 'settings' | 'remote' | 'shell'

export type ScreenLoader = () => Promise<{ default: ComponentType }>

export interface RouteDef {
  /** Screen code from DESIGN.md ("C2"), or "DEV" for the internal pages. */
  code: string
  /** Title as the app shows it. A page may show a different one (chat title, model name). */
  title: string
  /**
   * root  the root of a tab, with the tab bar
   * page  a pushed page with a back arrow
   * full  a full screen view (viewer, mask editor, scanner)
   * flow  a step of the onboarding
   */
  kind: 'root' | 'page' | 'full' | 'flow'
  /** The tab it belongs to, or "any" where DESIGN.md says so (E3, E21, R5). */
  tab: Tab | 'any' | 'none'
  /** data-testid of the screen is m-<screen>-screen. */
  screen: string
  /** Who fills this file. */
  owner: Strand
  /** Only reachable with the developer switch. */
  dev?: boolean
}

export interface SheetDef {
  code: string
  title: string
  /** data-testid of the sheet is m-sheet-<id>. */
  owner: Strand
  /** Cannot be swiped away or closed by the scrim (C12). Back still closes it. */
  locked?: boolean
}

export function defineRoutes<const T extends Record<string, RouteDef>>(routes: T): T {
  return routes
}

export function defineSheets<const T extends Record<string, SheetDef>>(sheets: T): T {
  return sheets
}
