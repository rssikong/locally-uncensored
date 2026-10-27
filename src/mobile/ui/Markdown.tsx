/**
 * The Markdown of an answer, for every place that shows one: the chat,
 * Compare, the transcript of a background task, the chat with a desktop.
 *
 * Own renderer on purpose: the desktop one brings desktop classes, a hover
 * copy button and a handler that opens links at once. Here a code block has
 * a 44 px Copy and, for a web page, Preview; a link asks before it leaves
 * the app; an image that names an address is never loaded unasked; a wide
 * table and a long code line scroll sideways inside their own box. Code is
 * coloured once its grammar has loaded, and stays readable until then.
 */
import { Suspense, lazy, memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components, Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { Check, Copy, Play } from 'lucide-react'
import { codeBlockText } from '../../lib/markdown-code'
import { MATH_OPTIONS, contentNeedsKatex } from '../../lib/markdown-math'
import { navApi } from '../nav/api'
import { copyText } from '../platform/clipboard'
import { openExternal } from '../platform/open-external'
import { COMMON } from '../strings/common'
import { cx, riskProps } from './common'
import { shouldHighlight } from './highlight'
import { Icon } from './Icon'
import { fencedBlockIndex, isInlineImageSrc, isPreviewableBlock, languageLabel } from './markdown-blocks'
import { toast } from './Toast'

type RehypePlugins = NonNullable<Options['rehypePlugins']>
type KatexPlugin = RehypePlugins[number]

let katexPlugin: KatexPlugin | null = null
let katexLoad: Promise<void> | null = null

/** KaTeX is loaded only for an answer that holds a formula. Until then the source text stays readable. */
function loadKatex(): Promise<void> {
  katexLoad ??= import('rehype-katex').then(
    (m) => {
      katexPlugin = m.default
    },
    () => {
      katexLoad = null
    },
  )
  return katexLoad
}

function useRehypePlugins(content: string): RehypePlugins {
  const needsKatex = contentNeedsKatex(content)
  const [ready, setReady] = useState(() => katexPlugin !== null)
  useEffect(() => {
    if (!needsKatex || katexPlugin) return
    let alive = true
    void loadKatex().then(() => {
      if (alive && katexPlugin) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [needsKatex])
  return needsKatex && ready && katexPlugin ? [katexPlugin] : []
}

const HighlightedCode = lazy(() => import('./highlight-code'))

/** A code block of an answer, as the preview of a page needs it. */
export interface MarkdownCodeBlock {
  /** Position among the fenced blocks of the text, from 0 (ui/markdown-blocks.ts). */
  index: number
  language: string | undefined
  code: string
}

export interface MarkdownProps {
  content: string
  /**
   * A link was tapped. Default: ask "Open link?" and open it in the browser
   * of the phone. A screen with its own link sheet hands in its own.
   */
  onLink?: (url: string) => void
  /** With it, a web page block offers "Preview" and calls this with the block. */
  onPreview?: (block: MarkdownCodeBlock) => void
  /**
   * Prefix of the data-testids, default "m-md": m-md-code, m-md-code-copy,
   * m-md-code-preview, m-md-link. The chat hands in "m-chat".
   */
  idPrefix?: string
  /** Element numbers from DESIGN.md for the three targets. */
  els?: { copy?: string; preview?: string; link?: string }
  className?: string
}

/** The default for a tapped link: ask, then open it outside the app and say so when that fails. */
export async function askAndOpenLink(url: string): Promise<void> {
  const yes = await navApi.confirm({ title: COMMON.openLinkTitle, text: url, confirmLabel: COMMON.openLinkConfirm, cancelLabel: COMMON.notNow, testid: 'open-link' })
  if (!yes) return
  const result = await openExternal(url)
  if (!result.opened) toast(result.reason === 'blocked' ? COMMON.linkBlocked : COMMON.linkNotOpened, { tone: 'error', testid: 'link-failed' })
}

interface CodeBlockProps {
  code: string
  language?: string
  onPreview?: () => void
  idPrefix: string
  els?: MarkdownProps['els']
}

export function CodeBlock(props: CodeBlockProps) {
  const { code, language, onPreview, idPrefix, els } = props
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])
  const copy = () => {
    void copyText(code).then((ok) => {
      if (ok) {
        setCopied(true)
        toast(COMMON.copied, { testid: 'copied' })
      } else {
        toast(COMMON.copyFailed, { tone: 'error', testid: 'copy-failed' })
      }
    })
  }
  const plain = (
    <pre>
      <code>{code}</code>
    </pre>
  )
  const colours = shouldHighlight(language, code)
  return (
    <div className="m-code" data-testid={`${idPrefix}-code`} data-highlight={colours ? '' : undefined}>
      <div className="m-code-bar">
        <span className="m-code-lang">{languageLabel(language, COMMON.codePlain)}</span>
        {onPreview ? (
          <button type="button" className="m-code-btn" aria-label={COMMON.previewPage} data-testid={`${idPrefix}-code-preview`} data-el={els?.preview} onClick={onPreview}>
            <Icon icon={Play} small />
            {COMMON.preview}
          </button>
        ) : null}
        <button type="button" className="m-code-btn" aria-label={COMMON.copyCode} data-testid={`${idPrefix}-code-copy`} data-el={els?.copy} data-state={copied ? 'copied' : 'idle'} onClick={copy}>
          <Icon icon={copied ? Check : Copy} small />
          {copied ? COMMON.copied : COMMON.copy}
        </button>
      </div>
      {/* The box scrolls sideways on purpose; the layout check of the tests reads data-m-scroll-x. */}
      <div className="m-code-scroll" tabIndex={0} data-m-scroll-x="">
        {colours ? (
          <Suspense fallback={plain}>
            <HighlightedCode code={code} language={language} />
          </Suspense>
        ) : (
          plain
        )}
      </div>
    </div>
  )
}

function MarkdownImpl({ content, onLink, onPreview, idPrefix = 'm-md', els, className }: MarkdownProps) {
  const rehypePlugins = useRehypePlugins(content)
  const components = useMemo<Components>(() => {
    const open = (url: string) => {
      if (!url) return
      if (onLink) onLink(url)
      else void askAndOpenLink(url)
    }
    const link = (url: string, children: ReactNode) => (
      <a
        href={url}
        className="m-md-link"
        data-testid={`${idPrefix}-link`}
        data-el={els?.link}
        {...riskProps('leaves-app')}
        onClick={(event) => {
          event.preventDefault()
          open(url)
        }}
      >
        {children}
      </a>
    )
    return {
      // The block draws its own frame, so the <pre> of the parser is dropped.
      pre({ children }) {
        return <>{children}</>
      },
      code({ className: codeClass, children, node }) {
        const match = /language-([\w+#.-]+)/.exec(codeClass || '')
        const text = codeBlockText(children)
        const isBlock = !!match || text.includes('\n')
        if (!isBlock) return <code>{children}</code>
        const language = match?.[1]
        const line = node?.position?.start.line
        const canPreview = !!onPreview && typeof line === 'number' && isPreviewableBlock(language, text)
        return (
          <CodeBlock
            code={text}
            language={language}
            idPrefix={idPrefix}
            els={els}
            onPreview={canPreview ? () => onPreview({ index: fencedBlockIndex(content, line), language, code: text }) : undefined}
          />
        )
      },
      a({ href, children }) {
        return link(href ?? '', children)
      },
      img({ src, alt }) {
        const address = typeof src === 'string' ? src : ''
        if (isInlineImageSrc(address)) return <img src={address} alt={alt ?? ''} loading="lazy" decoding="async" />
        if (!address) return <>{alt}</>
        // Nothing is fetched unasked: an image that names an address shows as a link to it.
        return link(address, alt || address)
      },
      table({ children }) {
        return (
          <div className="m-md-table" tabIndex={0} data-m-scroll-x="">
            <table>{children}</table>
          </div>
        )
      },
    }
  }, [content, onLink, onPreview, idPrefix, els])
  return (
    <div className={cx('m-md', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, MATH_OPTIONS]]} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Memoised: a finished answer does not parse again while the next one streams. Keep `onLink`, `onPreview` and `els` stable. */
export const Markdown = memo(MarkdownImpl)
