import { expect, type Page, type Locator } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'fs'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME, type TauriMockOptions } from '../support/tauri-mock'
import { routeCloud, seedOnboardingDone, signInViaGate, cloudSwitch, type CloudScenario } from '../support/cloud-mock'

/**
 * Records one how-to from the running UI: it performs the real clicks and
 * keystrokes, photographs every state, and writes a timeline the video player
 * (LU-HowTo/videos/_template) turns into the film. Nothing is drawn by hand
 * except the cursor.
 *
 * The clock is the film's clock, not the wall clock: every action advances it
 * by a fixed amount, so a re-run of the same script gives the same film.
 */

export type Point = { x: number; y: number }
type Target = Locator | Point
type Op =
  | { kind: 'key'; t: number; file: string }
  | { kind: 'type'; t: number; dur: number; files: string[]; rect: { x: number; y: number; w: number; h: number } }
  | { kind: 'move'; t: number; dur: number; x: number; y: number }
  | { kind: 'click'; t: number; x: number; y: number }
  | { kind: 'cam'; t: number; dur: number; cx: number; cy: number; scale: number }

export const HOWTO_OUT = process.env.LU_HOWTO_OUT

export class Rec {
  t = 0
  private ops: Op[] = []
  private scenes: { from: number; text: string }[] = []
  private keys = 0
  private frames = 0
  private out: string

  readonly page: Page
  readonly id: string
  readonly title: string

  constructor(page: Page, id: string, title: string) {
    this.page = page
    this.id = id
    this.title = title
    this.out = `${HOWTO_OUT}/${id}/assets/ui`
    mkdirSync(`${this.out}/type`, { recursive: true })
  }

  /** Boots the app into Cloud mode with the test rig (example account, example credits). */
  static async boot(page: Page, id: string, title: string, opts: {
    scenario?: Partial<CloudScenario>
    tauri?: Partial<TauriMockOptions>
    fixtures?: (page: Page) => Promise<void>
    /** 'local' leaves the app in Local mode (no Cloud sign-in). Default 'cloud'. */
    mode?: 'cloud' | 'local'
    /** true starts on the setup wizard instead of a finished onboarding. */
    onboarding?: boolean
    /** Runs right after tauriMockInit, before the app loads: the place to wrap
     *  `window.__TAURI_INTERNALS__.invoke` for commands the mock does not answer
     *  the way a how-to needs. Declare every such fixture in the spec. */
    initScript?: () => void
  } = {}) {
    await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, ...opts.tauri })
    if (opts.initScript) await page.addInitScript(opts.initScript)
    if (!opts.onboarding) await seedOnboardingDone(page)
    await routeCloud(page, { license: 'active', access: true, mediaLive: true, studioCatalog: true, ...opts.scenario })
    // Network fixtures of one how-to. Registered after the rig's routes, so they
    // answer first, and before the app loads, so its first requests meet them.
    if (opts.fixtures) await opts.fixtures(page)
    await page.goto('/')
    if (opts.onboarding) return new Rec(page, id, title)
    await expect(cloudSwitch(page)).toBeVisible({ timeout: 20_000 })
    if ((opts.mode ?? 'cloud') === 'cloud') {
      await signInViaGate(page)
      await expect(cloudSwitch(page)).toBeChecked({ timeout: 20_000 })
    }
    // The rig has no ComfyUI and Create says so in a red line; it is not part of any how-to.
    await page.addStyleTag({ content: 'main [role="alert"]:not([data-testid^="character-"]){display:none !important}' })
    // A film does not show the help entries themselves; the entry tests (ids
    // starting with "_entry") are the ones that open them.
    if (!id.startsWith('_entry')) await page.addStyleTag({ content: '[data-testid^="howto-"]{display:none !important}' })
    return new Rec(page, id, title)
  }

  /** Opens Create on a tab, with the 7-day notice dismissed through its own button. */
  async openCreate(tab: string) {
    await this.page.getByRole('banner').getByRole('button', { name: 'Create', exact: true }).click()
    await expect(this.page.getByRole('radio', { name: 'Image', exact: true })).toBeVisible({ timeout: 15_000 })
    const notice = this.page.getByText('Do not show again')
    if (await notice.isVisible().catch(() => false)) await notice.click()
    if (tab !== 'Image') await this.page.getByRole('radio', { name: tab, exact: true }).click()
    await this.page.waitForTimeout(600)
  }

  private async point(target: Target, at?: { dx?: number; dy?: number; fx?: number; fy?: number }): Promise<Point> {
    if ('x' in target && 'y' in target && typeof (target as Point).x === 'number') return target as Point
    const b = await (target as Locator).boundingBox()
    if (!b) throw new Error('target has no box')
    return {
      x: Math.round(b.x + b.width * (at?.fx ?? 0.5) + (at?.dx ?? 0)),
      y: Math.round(b.y + b.height * (at?.fy ?? 0.5) + (at?.dy ?? 0)),
    }
  }

  /** A new caption line starts here. One short sentence, a fact of the product. */
  scene(text: string) { this.scenes.push({ from: Number(this.t.toFixed(2)), text }) }

  /** Photographs the whole window as it is now and shows it from this moment. */
  async key(settle = 450) {
    await this.page.waitForTimeout(settle)
    const file = `k${String(this.keys++).padStart(2, '0')}.png`
    await this.page.screenshot({ path: `${this.out}/${file}` })
    this.ops.push({ kind: 'key', t: this.t, file })
  }

  /** Time passes, nothing happens. */
  hold(seconds: number) { this.t += seconds }

  /** Moves the cursor (and the real mouse, so hover states are real). */
  async move(target: Target, opts: { dur?: number; at?: { dx?: number; dy?: number; fx?: number; fy?: number }; real?: boolean } = {}) {
    const p = await this.point(target, opts.at)
    const dur = opts.dur ?? 0.6
    this.ops.push({ kind: 'move', t: this.t, dur, ...p })
    if (opts.real !== false) await this.page.mouse.move(p.x, p.y)
    this.t += dur
    return p
  }

  /** Moves to the target, clicks it for real, and shows the state that follows. */
  async click(target: Target, opts: { dur?: number; at?: { dx?: number; dy?: number; fx?: number; fy?: number }; settle?: number; after?: number; until?: () => Promise<unknown> } = {}) {
    const p = await this.move(target, { dur: opts.dur, at: opts.at })
    this.t += 0.08
    this.ops.push({ kind: 'click', t: this.t, ...p })
    await this.page.mouse.click(p.x, p.y)
    // Optional: wait for the state the click leads to (a run that has to
    // finish) before it is photographed. Costs no film time.
    if (opts.until) await opts.until()
    this.t += 0.1
    await this.key(opts.settle ?? 500)
    this.t += opts.after ?? 0.35
  }

  /** Types into a field. The window is photographed after every chunk, in a
   *  band around the field; the full state follows at the end. */
  async type(field: Locator, text: string, opts: { per?: number; cps?: number; band?: { up?: number; down?: number } } = {}) {
    const per = opts.per ?? (text.length > 60 ? 2 : 1)
    const cps = opts.cps ?? 24
    const size = this.page.viewportSize()!
    const b = await field.boundingBox()
    if (!b) throw new Error('field has no box')
    const top = Math.max(0, Math.round(b.y - (opts.band?.up ?? 150)))
    const bottom = Math.min(size.height, Math.round(b.y + b.height + (opts.band?.down ?? 190)))
    const rect = { x: 0, y: top, w: size.width, h: bottom - top }
    const files: string[] = []
    for (let i = 0; i < text.length; i += per) {
      await field.focus()
      await this.page.keyboard.insertText(text.slice(i, i + per))
      const file = `type/t${String(this.frames++).padStart(3, '0')}.jpg`
      await this.page.screenshot({ path: `${this.out}/${file}`, type: 'jpeg', quality: 92, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } })
      files.push(file)
    }
    const dur = Number((text.length / cps).toFixed(2))
    this.ops.push({ kind: 'type', t: this.t, dur, files, rect })
    this.t += dur
    await this.key(250)
    this.t += 0.25
  }

  /** The camera looks at a target with a zoom. It runs alongside what follows. */
  async cam(target: Target | 'full', scale = 1, dur = 0.9) {
    const size = this.page.viewportSize()!
    const p = target === 'full' ? { x: size.width / 2, y: size.height / 2 } : await this.point(target)
    this.ops.push({ kind: 'cam', t: this.t, dur, cx: p.x, cy: p.y, scale: target === 'full' ? 1 : scale })
  }

  /** Drags with the real mouse along points, photographing a band on the way
   *  (for painting a mask or pulling a slider). */
  async drag(points: Point[], rect: { x: number; y: number; w: number; h: number }, opts: { stepDur?: number } = {}) {
    const stepDur = opts.stepDur ?? 0.09
    await this.move(points[0], { dur: 0.5 })
    this.ops.push({ kind: 'click', t: this.t, ...points[0] })
    await this.page.mouse.down()
    const files: string[] = []
    const from = this.t
    for (const p of points.slice(1)) {
      await this.page.mouse.move(p.x, p.y, { steps: 4 })
      this.ops.push({ kind: 'move', t: this.t, dur: stepDur, ...p })
      this.t += stepDur
      const file = `type/t${String(this.frames++).padStart(3, '0')}.jpg`
      await this.page.screenshot({ path: `${this.out}/${file}`, type: 'jpeg', quality: 92, clip: { x: rect.x, y: rect.y, width: rect.w, height: rect.h } })
      files.push(file)
    }
    await this.page.mouse.up()
    this.ops.push({ kind: 'type', t: from, dur: Number((this.t - from).toFixed(2)), files, rect })
    await this.key(300)
    this.t += 0.3
  }

  /** Writes the timeline and the caption lines. `tail` is how long the last state stands. */
  finish(tail = 1.6) {
    this.t += tail
    const size = this.page.viewportSize()!
    const duration = Math.ceil(this.t * 10) / 10
    const timeline = { id: this.id, title: this.title, w: size.width, h: size.height, duration, ops: this.ops }
    const dir = `${HOWTO_OUT}/${this.id}`
    mkdirSync(`${dir}/js`, { recursive: true })
    writeFileSync(`${dir}/js/timeline.js`, `// Written by the recorder (lu-howto-wt/e2e/howto). Do not edit by hand.\nwindow.TL = ${JSON.stringify(timeline)};\n`)
    writeFileSync(`${dir}/steps.json`, JSON.stringify({ id: this.id, title: this.title, duration, steps: this.scenes }, null, 2) + '\n')
  }
}
