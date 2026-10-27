/**
 * The moving preview of the page LU Cloud (cloud/CloudShowcase.tsx), held to
 * plan sections 4.3 to 4.5 and decision D5:
 *  - stills only from the neutral list, never spicy or horror, and the files exist;
 *  - the chat scene names a model every package lists;
 *  - the CSS moves transform and opacity only, every animation ends, and a
 *    block for reduced motion switches every animation off;
 *  - the timer stops after two rounds, in the background, out of sight,
 *    after a pick and with reduced motion;
 *  - its texts are harmless in every store package.
 *
 * Lauf: npx vitest run src/mobile/screens/settings/__tests__/cloud-schaukasten.test.ts
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { storeFindings } from '../../../../../e2e/mobile/store-rules'
import { carriesUnfilteredWord, namesUnfiltered } from '../../../policy/unfiltered-names'
import { cloudModelListed } from '../../../policy/unfiltered'
import { STORE_PRESETS, STORE_PRESET_IDS } from '../../../policy/storePolicy'
import { SETTINGS_STRINGS } from '../../../strings/settings'
import { SHOWCASE_CHAT_MODEL, SHOWCASE_IMAGES, SHOWCASE_MAX_STEPS, showcaseRuns, showcaseTick, type ShowcaseState } from '../cloud/showcase'

const ROOT = resolve(__dirname, '../../../../..')
const read = (rel: string) => readFileSync(resolve(__dirname, rel), 'utf8')
const NEUTRAL = ['two-speakers', 'product-scene', 'product-360', 'sharpen-4k', 'restyle-video', 'animate-character']

describe('the preview of LU Cloud', () => {
  it('shows neutral stills only, and they are in the package', () => {
    for (const id of SHOWCASE_IMAGES) {
      expect(NEUTRAL, id).toContain(id)
      expect(id).not.toMatch(/spicy|horror/i)
      expect(carriesUnfilteredWord(id)).toBe(false)
      expect(existsSync(resolve(ROOT, 'public/create-presets', `${id}.webp`)), id).toBe(true)
    }
  })

  it('reads its stills from the list and from nowhere else', () => {
    const tsx = read('../cloud/CloudShowcase.tsx')
    expect(tsx).not.toMatch(/create-presets/)
    expect(tsx).not.toMatch(/\.webp|\.png|\.jpg|\.mp4/)
    for (const name of [...tsx.matchAll(/showcaseImageUrl\('([^']+)'\)/g)].map((m) => m[1])) expect(SHOWCASE_IMAGES as readonly string[]).toContain(name)
  })

  it('names a chat model every package lists', () => {
    const table = readFileSync(resolve(ROOT, 'src/lib/no-refusals-measurement.md'), 'utf8')
    const row = table.split('\n').find((line) => line.startsWith(`| ${SHOWCASE_CHAT_MODEL.id} |`))
    expect(row, 'the model is in the measurement').toBeTruthy()
    expect(row!.trim().endsWith('| full |')).toBe(false)
    expect(namesUnfiltered(SHOWCASE_CHAT_MODEL.name)).toBe(false)
    for (const preset of STORE_PRESET_IDS) {
      expect(cloudModelListed({ name: `lu-cloud::${SHOWCASE_CHAT_MODEL.id}`, displayName: SHOWCASE_CHAT_MODEL.name }, STORE_PRESETS[preset]), preset).toBe(true)
    }
  })

  it('moves transform and opacity only, every animation ends, and reduced motion stops all of it', () => {
    const css = read('../cloud/cloud-showcase.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const frames = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)]
    expect(frames.length).toBeGreaterThan(3)
    for (const [, body] of frames) {
      for (const [, prop] of body.matchAll(/([a-z-]+)\s*:/g)) expect(['transform', 'opacity'], prop).toContain(prop)
    }
    expect(css).not.toMatch(/infinite/)
    expect(css).not.toMatch(/filter\s*:|blur\(|gradient\(|box-shadow|will-change/)
    for (const [, value] of css.matchAll(/animation\s*:\s*([^;]+);/g)) {
      if (value.trim().startsWith('none')) continue
      // A count of runs or `both` with a single run: nothing loops for ever.
      expect(value, value).not.toMatch(/infinite/)
    }
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/animation:\s*none\s*!important/)
  })

  it('changes scenes for two rounds, then stands; never in the background, out of sight, after a pick or with reduced motion', () => {
    const world = { hidden: false, inView: true, reduced: false }
    let state: ShowcaseState = { scene: 0, steps: 0, held: false }
    const seen: number[] = []
    for (let i = 0; i < 20; i += 1) {
      state = showcaseTick(state, world)
      seen.push(state.scene)
    }
    expect(state.steps).toBe(SHOWCASE_MAX_STEPS)
    expect(state.scene).toBe(0)
    expect(seen.slice(0, 6)).toEqual([1, 2, 0, 1, 2, 0])
    const fresh: ShowcaseState = { scene: 0, steps: 0, held: false }
    expect(showcaseRuns(fresh, { ...world, hidden: true })).toBe(false)
    expect(showcaseRuns(fresh, { ...world, inView: false })).toBe(false)
    expect(showcaseRuns(fresh, { ...world, reduced: true })).toBe(false)
    expect(showcaseRuns({ ...fresh, held: true }, world)).toBe(false)
    expect(showcaseTick({ ...fresh, held: true }, world)).toEqual({ ...fresh, held: true })
  })

  it('its texts are no finding in either store package', () => {
    const T = SETTINGS_STRINGS.cloudShowcase
    const texts = [T.label, T.pick, T.chat, T.image, T.video, T.withCount('Image', 15), T.cloud, T.chatSentence, T.imageSentence, T.videoSentence, T.ask, ...T.answer, T.prompt, T.rendering, T.time, SHOWCASE_CHAT_MODEL.name]
    for (const text of texts) {
      expect(storeFindings(text, 'appstore'), text).toEqual([])
      expect(storeFindings(text, 'play'), text).toEqual([])
    }
  })
})
