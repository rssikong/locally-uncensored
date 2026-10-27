/**
 * The moving preview of the page LU Cloud (round 51, plan section 4): three
 * scenes, chat, image and video, rebuilt in HTML and CSS after the panels of
 * the website. No video file, no library, nothing loaded from the network.
 *
 * Exception to DESIGN.md 1.8 and 9 for this page only (decision D5): the CSS
 * moves `transform` and `opacity` and nothing else, every animation ends on
 * its own, the scenes change every 4.5 seconds for two rounds and then the
 * first one stands. Nothing moves while the app is in the background, while
 * the preview is out of sight, after the user picked a scene, or when the
 * system asks for reduced motion (then every scene stands finished).
 *
 * For a screen reader the preview is one group with one sentence per scene;
 * the change of scenes is not announced.
 */
import { useEffect, useRef, useState } from 'react'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { Segmented } from '../../../ui'
import type { CloudCounts } from '../parts/cloud-counts'
import { SHOWCASE_CHAT_MODEL, SHOWCASE_IMAGES, SHOWCASE_SCENES, SHOWCASE_STEP_MS, showcaseImageUrl, showcaseTick, type ShowcaseScene, type ShowcaseState } from './showcase'
import './cloud-showcase.css'

const T = SETTINGS_STRINGS.cloudShowcase

function useReducedMotion(): boolean {
  const query = typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null
  const [reduced, setReduced] = useState(() => query?.matches ?? false)
  useEffect(() => {
    if (!query) return
    const on = () => setReduced(query.matches)
    query.addEventListener?.('change', on)
    return () => query.removeEventListener?.('change', on)
  }, [query])
  return reduced
}

function useHidden(): boolean {
  const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden)
  useEffect(() => {
    const on = () => setHidden(document.hidden)
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return hidden
}

function useInView(ref: React.RefObject<HTMLElement | null>): boolean {
  const [inView, setInView] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)))
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
  return inView
}

function Head(props: { title: string }) {
  return (
    <div className="m-cs-head">
      <span className="m-cs-name">{props.title}</span>
      <span className="m-cs-state">
        <span className="m-cs-dot" />
        {T.cloud}
      </span>
    </div>
  )
}

function ChatScene() {
  return (
    <>
      <Head title={SHOWCASE_CHAT_MODEL.name} />
      <div className="m-cs-ask">{T.ask}</div>
      <div className="m-cs-answer">
        {T.answer.map((line) => (
          <span key={line} className="m-cs-line">
            {line}
          </span>
        ))}
      </div>
      <div className="m-cs-typing">
        <i />
        <i />
        <i />
      </div>
    </>
  )
}

function ImageScene(props: { title: string }) {
  return (
    <>
      <Head title={props.title} />
      <div className="m-cs-grid">
        {SHOWCASE_IMAGES.slice(0, 3).map((id) => (
          <img key={id} src={showcaseImageUrl(id)} alt="" decoding="async" loading="lazy" />
        ))}
        <div className="m-cs-slot">
          <span className="m-cs-shine" />
          <span className="m-cs-slot-word">{T.rendering}</span>
        </div>
      </div>
      <div className="m-cs-prompt m-mono">{T.prompt}</div>
    </>
  )
}

function VideoScene(props: { title: string }) {
  return (
    <>
      <Head title={props.title} />
      <div className="m-cs-video">
        <img src={showcaseImageUrl('product-360')} alt="" decoding="async" loading="lazy" />
      </div>
      <div className="m-cs-track">
        <b />
      </div>
      <div className="m-cs-time m-mono">{T.time}</div>
    </>
  )
}

const SENTENCE: Record<ShowcaseScene, string> = { chat: T.chatSentence, image: T.imageSentence, video: T.videoSentence }

export function CloudShowcase(props: { counts: CloudCounts | null }) {
  const { counts } = props
  const ref = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const hidden = useHidden()
  const inView = useInView(ref)
  const [state, setState] = useState<ShowcaseState>({ scene: 0, steps: 0, held: false })
  // The page and its main button are drawn first; the preview starts after the first frame.
  const [started, setStarted] = useState(false)
  useEffect(() => {
    const frame = requestAnimationFrame(() => setStarted(true))
    return () => cancelAnimationFrame(frame)
  }, [])

  // The timer lives only while the preview may move; a change of the world starts it anew.
  useEffect(() => {
    if (!started) return
    const world = { hidden, inView, reduced }
    const timer = window.setInterval(() => setState((s) => showcaseTick(s, world)), SHOWCASE_STEP_MS)
    return () => window.clearInterval(timer)
  }, [started, hidden, inView, reduced])

  const scene = SHOWCASE_SCENES[state.scene]
  const title = (kind: string, n: number | undefined) => (n === undefined ? kind : T.withCount(kind, n))

  return (
    <section ref={ref} className="m-pad m-cs" role="group" aria-label={T.label} data-testid="m-cloud-showcase" data-scene={scene} data-paused={hidden || !inView || !started ? '' : undefined} data-still={reduced ? '' : undefined}>
      <Segmented
        label={T.pick}
        value={scene}
        onChange={(next) => setState((s) => ({ ...s, held: true, scene: SHOWCASE_SCENES.indexOf(next) }))}
        options={[
          { value: 'chat', label: T.chat, testid: 'm-cloud-showcase-chat' },
          { value: 'image', label: T.image, testid: 'm-cloud-showcase-image' },
          { value: 'video', label: T.video, testid: 'm-cloud-showcase-video' },
        ]}
        testid="m-cloud-showcase-pick"
      />
      <div className="m-cs-card">
        <p className="m-sr">{SENTENCE[scene]}</p>
        {/* A new key on every change starts the animations of the scene from the beginning. */}
        <div key={`${scene}-${state.steps}`} className={`m-cs-scene m-cs-scene--${scene}`} aria-hidden="true">
          {scene === 'chat' ? <ChatScene /> : scene === 'image' ? <ImageScene title={title(T.image, counts?.image)} /> : <VideoScene title={title(T.video, counts?.video)} />}
        </div>
      </div>
    </section>
  )
}
