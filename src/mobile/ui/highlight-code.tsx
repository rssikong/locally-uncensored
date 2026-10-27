/**
 * The coloured inside of a code block. Loaded on demand by ui/Markdown, so
 * the highlighter and its grammars are not in the first chunk of the shell.
 *
 * PrismLight, not the full Prism: the engine without the three hundred
 * grammars, every grammar below is asked for by name. The colours are the
 * tokens --m-code-*, so the block follows dark and light without a second
 * theme and without a line of its own in a stylesheet of the library.
 */
import type { CSSProperties } from 'react'
import SyntaxHighlighter from 'react-syntax-highlighter/dist/esm/prism-light'
import bash from 'react-syntax-highlighter/dist/esm/languages/prism/bash'
import c from 'react-syntax-highlighter/dist/esm/languages/prism/c'
import cpp from 'react-syntax-highlighter/dist/esm/languages/prism/cpp'
import csharp from 'react-syntax-highlighter/dist/esm/languages/prism/csharp'
import css from 'react-syntax-highlighter/dist/esm/languages/prism/css'
import diff from 'react-syntax-highlighter/dist/esm/languages/prism/diff'
import go from 'react-syntax-highlighter/dist/esm/languages/prism/go'
import java from 'react-syntax-highlighter/dist/esm/languages/prism/java'
import javascript from 'react-syntax-highlighter/dist/esm/languages/prism/javascript'
import json from 'react-syntax-highlighter/dist/esm/languages/prism/json'
import jsx from 'react-syntax-highlighter/dist/esm/languages/prism/jsx'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/prism/kotlin'
import markdown from 'react-syntax-highlighter/dist/esm/languages/prism/markdown'
import markup from 'react-syntax-highlighter/dist/esm/languages/prism/markup'
import php from 'react-syntax-highlighter/dist/esm/languages/prism/php'
import python from 'react-syntax-highlighter/dist/esm/languages/prism/python'
import ruby from 'react-syntax-highlighter/dist/esm/languages/prism/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/prism/rust'
import sql from 'react-syntax-highlighter/dist/esm/languages/prism/sql'
import swift from 'react-syntax-highlighter/dist/esm/languages/prism/swift'
import toml from 'react-syntax-highlighter/dist/esm/languages/prism/toml'
import tsx from 'react-syntax-highlighter/dist/esm/languages/prism/tsx'
import typescript from 'react-syntax-highlighter/dist/esm/languages/prism/typescript'
import yaml from 'react-syntax-highlighter/dist/esm/languages/prism/yaml'
import { highlightLanguage } from './highlight'

/** Keyed by the name ui/highlight.ts maps a fence tag to. A test holds the two lists together. */
export const GRAMMARS = {
  bash, c, cpp, csharp, css, diff, go, java, javascript, json, jsx, kotlin, markdown, markup, php, python, ruby, rust, sql, swift, toml, tsx, typescript, yaml,
}

for (const [name, grammar] of Object.entries(GRAMMARS)) {
  SyntaxHighlighter.registerLanguage(name, grammar)
}

const color = (token: string): CSSProperties => ({ color: `var(--m-code-${token})` })

/** Token class of the highlighter to colour token of the shell. Everything not listed keeps the text colour. */
const THEME: Record<string, CSSProperties> = {
  comment: { ...color('comment'), fontStyle: 'italic' },
  prolog: color('comment'),
  doctype: color('comment'),
  cdata: color('comment'),
  punctuation: color('punct'),
  operator: color('punct'),
  keyword: color('keyword'),
  atrule: color('keyword'),
  important: color('keyword'),
  tag: color('keyword'),
  boolean: color('number'),
  number: color('number'),
  constant: color('number'),
  symbol: color('number'),
  string: color('string'),
  char: color('string'),
  'attr-value': color('string'),
  inserted: color('string'),
  regex: color('string'),
  function: color('function'),
  'class-name': color('function'),
  'attr-name': color('function'),
  selector: color('function'),
  builtin: color('function'),
  property: color('function'),
  deleted: color('deleted'),
  // The frame, the font and the padding come from .m-code in styles/components.css.
  'pre[class*="language-"]': {},
  'code[class*="language-"]': {},
}

const PRE: CSSProperties = { margin: 0, padding: 0, background: 'none', overflow: 'visible' }
const CODE: CSSProperties = { font: 'inherit' }

export default function HighlightedCode({ code, language }: { code: string; language: string | undefined }) {
  return (
    <SyntaxHighlighter language={highlightLanguage(language) ?? 'text'} style={THEME} customStyle={PRE} codeTagProps={{ style: CODE }}>
      {code}
    </SyntaxHighlighter>
  )
}
