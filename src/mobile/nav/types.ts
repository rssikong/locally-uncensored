/** Shapes of the stack router. No imports, so the pure core stays testable in node. */

export type Tab = 'chat' | 'create' | 'models' | 'settings'
export const TABS: readonly Tab[] = ['chat', 'create', 'models', 'settings']

/** A run of pages without tab bar. Only the onboarding today (A1 to A4). */
export type FlowId = 'onboarding'

export type Params = Record<string, string>

export interface PageEntry {
  kind: 'page'
  /** Route id from nav/routes.ts, for example "/chat/:id". */
  route: string
  params: Params
  key: string
}

export interface SheetEntry {
  kind: 'sheet'
  /** Sheet id from nav/sheets.ts, for example "model". */
  sheet: string
  props?: unknown
  /** Sub pages inside the sheet, last one is shown. */
  sub: string[]
  key: string
}

export interface DialogSpec {
  /** A question, for example "Delete this chat?". */
  title: string
  /** One sentence about the consequence. */
  text?: string
  /** The action button, on top. */
  confirmLabel: string
  /** The safe answer, below. Back picks this one. Default "Cancel". */
  cancelLabel?: string
  /** danger paints the action red (destructive), cloud paints it cloud violet. */
  tone?: 'default' | 'danger' | 'cloud'
  /** The action stays disabled until the user typed exactly this (for example DELETE). */
  requireText?: string
  /** A text field in the dialog (rename). Its value is what nav.prompt resolves with. */
  field?: { label: string; initial?: string; placeholder?: string }
  /** Suffix for data-testid: m-dialog-<testid>. */
  testid?: string
  /**
   * What the action costs, written as data-m-risk on the action button: the
   * mark of the control that opened the question goes on with it, because
   * this tap is the one that deletes or pays. Left out, the tone says it:
   * danger is destructive, cloud is paid. `none` takes the mark away for a
   * red question that removes nothing.
   */
  risk?: 'paid' | 'destructive' | 'leaves-app' | 'none'
}

export interface DialogEntry {
  kind: 'dialog'
  dialog: DialogSpec
  key: string
}

export type OverlayEntry = SheetEntry | DialogEntry
export type Entry = PageEntry | OverlayEntry

export interface NavState {
  /** Set while a flow runs. The tab bar is gone and `flowStack` is the active stack. */
  flow: FlowId | null
  flowStack: PageEntry[]
  tab: Tab
  /** One stack per tab, index 0 is the root. */
  stacks: Record<Tab, PageEntry[]>
  /** Sheets and dialogs above the active stack, last one is on top. */
  overlays: OverlayEntry[]
}

/** What closeTop took away. */
export type Closed =
  | { kind: 'none' }
  | { kind: 'dialog'; entry: DialogEntry }
  | { kind: 'sheet-sub'; entry: SheetEntry; sub: string }
  | { kind: 'sheet'; entry: SheetEntry }
  | { kind: 'page'; entry: PageEntry }
  | { kind: 'tab'; from: Tab }
