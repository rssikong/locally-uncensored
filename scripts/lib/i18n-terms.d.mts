/**
 * `scripts/lib/i18n-terms.mjs` 的类型声明。
 *
 * scripts/ 不在任何 tsconfig 的 include 里（app 只收 src / mobile-client，node 只收
 * vite.config.ts / dev-server），所以这份文件只服务编辑器提示与阅读 —— 和
 * release-rules.d.mts、mac-engine-pins.d.mts 一样，不参与 tsc 构建。
 */

export type TermMode = 'normalize' | 'report' | 'off'
export type TermScope = 'keys' | 'values' | 'both'
export type TermTable = 'entries' | 'patterns'

export interface TermSource {
  id: string
  english: string
  scope?: TermScope
  canonical?: string
  variants?: string[]
  mode: TermMode
  tables?: TermTable[]
  allowKeys?: string[]
  allowValues?: string[]
  rationale?: string
  proposal?: { at?: string; counts?: Record<string, number>; share?: number }
}

export interface Term extends TermSource {
  id: string
  scope: TermScope
  canonical: string
  variants: string[]
  mode: TermMode
  tables: TermTable[]
  allowKeys: string[]
  allowValues: string[]
  _en: RegExp
  _allowKeys: RegExp[]
  _allowValues: RegExp[]
}

export interface TermsTable {
  version: 1
  terms: Term[]
  _forms: Array<{ form: string; term: Term }>
}

export interface Token {
  text: string
  term: Term | null
}

export interface Change {
  term: string
  from: string
  to: string
}

export interface Violation {
  term: string
  table: TermTable
  key: string
  expected: string
  actual: string
  count: number
  kind: 'variant' | 'mixed'
}

export interface Proposal {
  id: string
  mode: TermMode
  canonical: string
  counts: Record<string, number>
  total: number
  mixed: number
  top: string
  share: number
  gap: number
  unstable: boolean
  matchesFrozen: boolean
}

export interface Options {
  only?: Set<string> | null
}

export const STABILITY: { minShare: number; minGap: number }

export function validateTerms(raw: unknown): TermsTable
export function loadTerms(
  readFileSync: (path: string, encoding: 'utf8') => string,
  path: string,
): TermsTable
export function tokenize(text: string, table: TermsTable): Token[]
export function normalizeValue(
  key: string,
  value: string,
  table: TermsTable,
  options?: Options,
): { value: string; changes: Change[] }
export function findViolations(
  entries: Record<string, string>,
  patterns: ReadonlyArray<readonly [string, string]>,
  table: TermsTable,
  options?: Options,
): Violation[]
export function proposals(
  entries: Record<string, string>,
  patterns: ReadonlyArray<readonly [string, string]>,
  table: TermsTable,
  options?: Options,
): Proposal[]
