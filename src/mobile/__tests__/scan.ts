/**
 * Reading the source tree for the guards in this folder. Not a test itself.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const MOBILE_DIR = path.resolve(HERE, '..')
export const SRC_DIR = path.resolve(MOBILE_DIR, '..')

export interface SourceFile {
  /** Path from src, with forward slashes: "mobile/nav/core.ts". */
  rel: string
  abs: string
  text: string
}

function walk(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, out)
    else out.push(abs)
  }
}

/** Every file below `dir` with one of the endings, test folders left out. */
export function sourceFiles(dir: string, endings: readonly string[]): SourceFile[] {
  const all: string[] = []
  walk(dir, all)
  return all
    .filter((abs) => endings.some((e) => abs.endsWith(e)))
    .map((abs) => ({ abs, rel: path.relative(SRC_DIR, abs).split(path.sep).join('/'), text: fs.readFileSync(abs, 'utf8') }))
}

export interface ImportHit {
  spec: string
  /** import('...') instead of a static import. */
  dynamic: boolean
  /** Where the specifier points, from src with forward slashes, or null for a package. */
  target: string | null
}

const STATIC = /(?:^|[\s;])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]/g
const DYNAMIC = /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g
const REQUIRE = /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g

function targetOf(file: SourceFile, spec: string): string | null {
  if (!spec.startsWith('.')) return null
  return path.relative(SRC_DIR, path.resolve(path.dirname(file.abs), spec)).split(path.sep).join('/')
}

/** All imports of a file, comments removed first so an example in a comment does not count. */
export function importsOf(file: SourceFile): ImportHit[] {
  const code = stripComments(file.text)
  const hits: ImportHit[] = []
  for (const m of code.matchAll(STATIC)) hits.push({ spec: m[1], dynamic: false, target: targetOf(file, m[1]) })
  for (const m of code.matchAll(DYNAMIC)) hits.push({ spec: m[1], dynamic: true, target: targetOf(file, m[1]) })
  for (const m of code.matchAll(REQUIRE)) hits.push({ spec: m[1], dynamic: true, target: targetOf(file, m[1]) })
  return hits
}

/**
 * Remove comments, keep strings. A small scanner instead of a regex, because
 * "//" also stands inside strings (addresses) and a regex would cut those.
 */
export function stripComments(text: string): string {
  let out = ''
  let i = 0
  let quote: string | null = null
  while (i < text.length) {
    const c = text[i]
    const next = text[i + 1]
    if (quote) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i += 2
        continue
      }
      if (c === quote) quote = null
      i++
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c
      out += c
      i++
      continue
    }
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      i = end === -1 ? text.length : end + 2
      out += ' '
      continue
    }
    out += c
    i++
  }
  return out
}

/** String literals and JSX text of a file: what can end up in front of a user. */
export function shownTexts(file: SourceFile): string[] {
  const code = stripComments(file.text)
    .split('\n')
    // Import lines carry file names, not words for the user.
    .filter((line) => !/^\s*(import|export)\b.*\bfrom\b/.test(line) && !/^\s*import\s+['"]/.test(line) && !/\bimport\s*\(/.test(line))
    .join('\n')
  const out: string[] = []
  for (const m of code.matchAll(/'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g)) {
    out.push(m[1] ?? m[2] ?? m[3] ?? '')
  }
  // JSX text: between a closing ">" and the next "<" or "{", with at least one letter.
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)[<{]/g)) out.push(m[1])
  return out
}

/** Every file of src the phone app loads: src/mobile and whatever it imports, followed through. */
export function reachableFromMobile(): SourceFile[] {
  const seen = new Map<string, SourceFile>()
  const todo = sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])
  while (todo.length > 0) {
    const file = todo.pop() as SourceFile
    if (seen.has(file.abs)) continue
    seen.set(file.abs, file)
    for (const hit of importsOf(file)) {
      if (hit.target === null) continue
      const base = path.join(SRC_DIR, hit.target)
      const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')].find((p) => fs.existsSync(p) && fs.statSync(p).isFile() && /\.tsx?$/.test(p))
      if (!found || seen.has(found)) continue
      todo.push({ abs: found, rel: path.relative(SRC_DIR, found).split(path.sep).join('/'), text: fs.readFileSync(found, 'utf8') })
    }
  }
  return [...seen.values()]
}
