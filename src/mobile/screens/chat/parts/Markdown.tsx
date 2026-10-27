/**
 * The Markdown of an answer, drawn with the classes of this strand.
 *
 * Own renderer on purpose: the desktop one (components/chat/MarkdownRenderer)
 * brings desktop classes, a hover copy button and a click handler that opens
 * links at once. Here a code block has a 44 px Copy (C2.22) and, for a web
 * page, Preview (C2.23); a link asks first (C2.34).
 */
import { memo, useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components, Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import { Check, Copy, Play } from 'lucide-react'
import { codeBlockText } from '../../../../lib/markdown-code'
import { MATH_OPTIONS, contentNeedsKatex } from '../../../../lib/markdown-math'
import { nav } from '../../../nav'
import { copyText } from '../../../platform'
import { CHAT_STRINGS } from '../../../strings/chat'
import { Icon, riskProps, toast } from '../../../ui'
import { fencedBlockIndex, isHtmlBlock, isInlineImageSrc, languageLabel, previewBlockId } from './logic/markdown'

const S = CHAT_STRINGS

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

export interface MarkdownProps {
  content: string
  /** With both, a web page block offers Preview and opens /chat/:id/preview/:blockId. */
  chatId?: string
  messageId?: string
}

function CodeBlock(props: { code: string; language?: string; onPreview?: () => void }) {
  const { code, language, onPreview } = props
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
        toast(S.actions.copied, { testid: 'copied' })
      } else {
        toast(S.actions.copyFailed, { tone: 'error', testid: 'copy-failed' })
      }
    })
  }
  return (
    <div className="m-chat-code" data-testid="m-chat-code">
      <div className="m-chat-code-bar">
        <span className="m-chat-code-lang">{languageLabel(language, S.code.plain)}</span>
        {onPreview ? (
          <button type="button" className="m-chat-code-btn" aria-label={S.code.previewName} data-testid="m-chat-code-preview" data-el="C2.23" onClick={onPreview}>
            <Icon icon={Play} small />
            {S.code.preview}
          </button>
        ) : null}
        <button type="button" className="m-chat-code-btn" aria-label={S.code.copy} data-testid="m-chat-code-copy" data-el="C2.22" data-state={copied ? 'copied' : 'idle'} onClick={copy}>
          <Icon icon={copied ? Check : Copy} small />
          {copied ? S.actions.copied : S.code.copyShort}
        </button>
      </div>
      <pre tabIndex={0}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

function MarkdownImpl({ content, chatId, messageId }: MarkdownProps) {
  const rehypePlugins = useRehypePlugins(content)
  const components = useMemo<Components>(
    () => ({
      // The block draws its own frame, so the <pre> of the parser is dropped.
      pre({ children }) {
        return <>{children}</>
      },
      code({ className, children, node }) {
        const match = /language-([\w+#.-]+)/.exec(className || '')
        const text = codeBlockText(children)
        const isBlock = !!match || text.includes('\n')
        if (!isBlock) return <code>{children}</code>
        const language = match?.[1]
        const line = node?.position?.start.line
        const canPreview = !!chatId && !!messageId && typeof line === 'number' && isHtmlBlock(language, text)
        return (
          <CodeBlock
            code={text}
            language={language}
            onPreview={
              canPreview
                ? () => nav.push('/chat/:id/preview/:blockId', { id: chatId, blockId: previewBlockId(messageId, fencedBlockIndex(content, line)) })
                : undefined
            }
          />
        )
      },
      a({ href, children }) {
        const url = href ?? ''
        return (
          <a
            href={url}
            className="m-chat-link"
            data-testid="m-chat-link" {...riskProps('leaves-app')}
            data-el="C2.34"
            onClick={(event) => {
              event.preventDefault()
              if (url) nav.openSheet('chat-link', { url })
            }}
          >
            {children}
          </a>
        )
      },
      img({ src, alt }) {
        const address = typeof src === 'string' ? src : ''
        if (isInlineImageSrc(address)) return <img src={address} alt={alt ?? ''} loading="lazy" decoding="async" />
        if (!address) return <>{alt}</>
        return (
          <a
            href={address}
            className="m-chat-link"
            data-testid="m-chat-link" {...riskProps('leaves-app')}
            data-el="C2.34"
            onClick={(event) => {
              event.preventDefault()
              nav.openSheet('chat-link', { url: address })
            }}
          >
            {alt || address}
          </a>
        )
      },
      table({ children }) {
        return (
          <div className="m-chat-table" tabIndex={0}>
            <table>{children}</table>
          </div>
        )
      },
    }),
    [chatId, messageId, content],
  )
  return (
    <div className="m-chat-md">
      <ReactMarkdown remarkPlugins={[remarkGfm, [remarkMath, MATH_OPTIONS]]} rehypePlugins={rehypePlugins} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  )
}

/** Memoised: a finished answer does not parse again while the next one streams. */
export const Markdown = memo(MarkdownImpl)
