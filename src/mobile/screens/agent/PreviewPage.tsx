/**
 * C11 Preview. Route /chat/:id/preview/:blockId, kind full, tab chat, strand 2 (Agent and knowledge).
 *
 * Shows a web page the model wrote, in a closed off frame. "Phone" lays it
 * out in the width of this screen, "Wide" in a desktop width and scales it
 * down, so nothing has to be scrolled sideways. The block is found by the
 * address alone (parts/preview-block.ts), so the page also works after a
 * restart.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FileWarning, RotateCw, X } from 'lucide-react'
import { sandboxAttr } from '../../../lib/file-preview'
import { useChatStore } from '../../../stores/chatStore'
import { nav, useParams } from '../../nav'
import { AGENT_STRINGS as T } from '../../strings/agent'
import { Button, EmptyState, IconButton, Notice, Page, Segmented } from '../../ui'
import './parts/agent.css'
import { findPreviewBlock, parsePreviewBlockId } from './parts/preview-block'
import { PREVIEW_READY_WAIT_MS, noteScriptsBlocked, pageWantsScripts, previewDocument, scriptsKnownBlocked, readPreviewMessage, readPreviewReady, wideScale, WIDE_WIDTH } from './parts/preview-doc'

const S = T.preview
type Width = 'phone' | 'wide'

/** Random part of the token of one page view; made once, outside of rendering. */
function previewSalt(): string {
  return Math.random().toString(36).slice(2, 10)
}

export default function PreviewPage() {
  const { id, blockId } = useParams<{ id: string; blockId: string }>()
  const ref = parsePreviewBlockId(blockId ?? '')
  const text = useChatStore((s) => {
    if (!ref) return undefined
    return s.conversations.find((c) => c.id === id)?.messages.find((m) => m.id === ref.messageId)?.content
  })
  const block = ref ? findPreviewBlock(text, ref.index) : null

  const [width, setWidth] = useState<Width>('phone')
  const [reload, setReload] = useState(0)
  // An error belongs to the page view that reported it; a reload starts without one.
  const [reported, setReported] = useState<{ token: string; message: string } | null>(null)
  const [stage, setStage] = useState({ width: 0, height: 0 })
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)

  // A token per page view: only the frame of this view can report an error.
  const [salt] = useState(previewSalt)
  const token = `p${reload}x${salt}`

  const pageError = reported && reported.token === token ? reported.message : null

  // Do scripts run in the frame? In the installed app they do not (parts/preview-doc.ts, PREVIEW_READY).
  // `ready` is the view whose frame said so, `waited` the view that was given its time to say so.
  const [ready, setReady] = useState<string | null>(null)
  const [waited, setWaited] = useState<string | null>(null)
  const wantsScripts = block ? pageWantsScripts(block.code) : false
  // The reporter is a script of ours. It is only written into a page that has scripts, and not into a frame that
  // is known not to run them: the policy of the app refuses it, with an error in the console at every load (N10).
  // Decided per view (reload, width), so what the first wait found out reaches the next frame.
  const reporterOn = useMemo(() => wantsScripts && !scriptsKnownBlocked(), [wantsScripts, token, width]) // eslint-disable-line react-hooks/exhaustive-deps
  const doc = useMemo(() => (block ? previewDocument(block.code, block.language, token, reporterOn) : ''), [block, token, reporterOn])
  const noScripts = wantsScripts && (!reporterOn || (waited === `${token}-${width}` && ready !== token))

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return
      if (readPreviewReady(event.data, token)) {
        setReady(token)
        return
      }
      const message = readPreviewMessage(event.data, token)
      if (message !== null) setReported({ token, message })
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [token])

  useEffect(() => {
    if (!wantsScripts) return
    // Phone and Wide are two frames of the same view: each gets its own wait.
    const view = `${token}-${width}`
    const timer = window.setTimeout(() => setWaited(view), PREVIEW_READY_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [token, width, wantsScripts])

  // What the first wait found out is kept for the next views.
  useEffect(() => {
    if (!reporterOn) return
    if (ready === token) noteScriptsBlocked(false)
    else if (waited === `${token}-${width}`) noteScriptsBlocked(true)
  }, [reporterOn, ready, waited, token, width])

  const hasBlock = block !== null
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ width: el.clientWidth, height: el.clientHeight })
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasBlock])

  const close = () => void nav.back()
  const actions = (
    <>
      {block ? <IconButton icon={RotateCw} label={S.reload} onPress={() => setReload((n) => n + 1)} testid="m-preview-reload" el="C11.3" /> : null}
      <IconButton icon={X} label={S.close} onPress={close} testid="m-preview-close" el="C11.1" />
    </>
  )

  if (!block) {
    return (
      <Page title={S.title} screen="chat-preview" noBack actions={actions}>
        <EmptyState
          title={S.failed}
          icon={FileWarning}
          testid="m-preview-missing"
          actions={
            <Button onPress={close} testid="m-preview-missing-close">
              {S.close}
            </Button>
          }
        >
          {S.failedText}
        </EmptyState>
      </Page>
    )
  }

  const scale = width === 'wide' ? wideScale(stage.width) : 1
  const frameWidth = width === 'wide' ? WIDE_WIDTH : stage.width
  const frameHeight = scale > 0 ? stage.height / scale : stage.height

  return (
    <Page title={S.title} screen="chat-preview" noBack actions={actions} flush>
      <div className="m-ag-pv">
        <div className="m-ag-pv-bar">
          <Segmented
            label={S.widthLabel}
            value={width}
            onChange={setWidth}
            options={[
              { value: 'phone', label: S.phone, testid: 'm-preview-phone' },
              { value: 'wide', label: S.wide, testid: 'm-preview-wide' },
            ]}
            testid="m-preview-width"
            el="C11.2"
          />
        </div>
        {pageError !== null ? (
          <Notice variant="error" title={S.failed} testid="m-preview-error">
            {pageError || S.sandbox}
          </Notice>
        ) : null}
        {noScripts && pageError === null ? (
          <Notice title={S.noScriptsTitle} testid="m-preview-noscripts">
            {S.noScripts}
          </Notice>
        ) : null}
        <div className="m-ag-pv-stage" ref={stageRef} data-testid="m-preview-stage" data-width={width}>
          {stage.width > 0 ? (
            <iframe
              key={`${reload}-${width}`}
              ref={frameRef}
              srcDoc={doc}
              sandbox={sandboxAttr(true)}
              referrerPolicy="no-referrer"
              title={S.frame}
              data-testid="m-preview-frame"
              style={{ width: frameWidth, height: frameHeight, transform: scale !== 1 ? `scale(${scale})` : undefined }}
            />
          ) : null}
        </div>
      </div>
    </Page>
  )
}
