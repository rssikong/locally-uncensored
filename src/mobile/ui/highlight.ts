/**
 * Which grammar colours a code block. Pure and small: the grammars
 * themselves live in highlight-code.tsx and are loaded only once a block
 * with a known language is on screen.
 */

/** The grammars highlight-code.tsx registers, with the names and short names a fence may carry. */
const LANGUAGES: Record<string, string> = {
  bash: 'bash', sh: 'bash', shell: 'bash', zsh: 'bash', console: 'bash', shellsession: 'bash',
  c: 'c', h: 'c',
  cpp: 'cpp', 'c++': 'cpp', cc: 'cpp', hpp: 'cpp',
  csharp: 'csharp', cs: 'csharp', 'c#': 'csharp', dotnet: 'csharp',
  css: 'css',
  diff: 'diff', patch: 'diff',
  go: 'go', golang: 'go',
  java: 'java',
  javascript: 'javascript', js: 'javascript', mjs: 'javascript', cjs: 'javascript', node: 'javascript',
  json: 'json', jsonc: 'json', json5: 'json',
  jsx: 'jsx',
  kotlin: 'kotlin', kt: 'kotlin', kts: 'kotlin',
  markdown: 'markdown', md: 'markdown',
  markup: 'markup', html: 'markup', htm: 'markup', xhtml: 'markup', xml: 'markup', svg: 'markup',
  php: 'php',
  python: 'python', py: 'python', python3: 'python',
  ruby: 'ruby', rb: 'ruby',
  rust: 'rust', rs: 'rust',
  sql: 'sql',
  swift: 'swift',
  toml: 'toml',
  tsx: 'tsx',
  typescript: 'typescript', ts: 'typescript',
  yaml: 'yaml', yml: 'yaml',
}

/** Colouring a very long block again for every streamed word would stall a phone. Beyond this it stays plain. */
export const HIGHLIGHT_MAX_CHARS = 20_000

/** The grammar for a fence tag, or null: unknown and missing tags stay plain text, they never throw. */
export function highlightLanguage(language: string | undefined): string | null {
  const key = (language ?? '').trim().toLowerCase()
  return key ? (LANGUAGES[key] ?? null) : null
}

/** Should this block be coloured at all. */
export function shouldHighlight(language: string | undefined, code: string): boolean {
  return highlightLanguage(language) !== null && code.length > 0 && code.length <= HIGHLIGHT_MAX_CHARS
}

/** The grammars that must be registered: every value of the table above, once. */
export const HIGHLIGHT_GRAMMARS: readonly string[] = [...new Set(Object.values(LANGUAGES))].sort()
