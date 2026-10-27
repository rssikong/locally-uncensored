/**
 * A small model in a 1 or 2 bit packing is not "Runs well"
 * (r6 Nachpruefung Android, N11, and the second check on Android, F8).
 *
 * Qwen3 0.6B IQ2_M (256 MB) was "Runs well on this phone" on the 8 GB phone
 * and answered "What is the capital of Italy?" with unreadable characters.
 * Memory and pace were never the question: what such a packing leaves of a
 * model this small is. The first rule stopped below 1.5 billion parameters.
 * Then Qwen 3.5 2B IQ2_M carried "Runs well on this phone" and answered the
 * same question with "Florence." (one probe). Decided 10.10.2026: up to and
 * including 4 billion parameters a 1 or 2 bit packing never says "Runs
 * well" and carries "Packed very small, answers may be poor". From 3 bit on
 * nothing changes.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/hard-packing.test.ts
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MOBILE_CHAT_MODELS } from '../../../data/mobile-models'
import { COARSE_UP_TO_PARAMS_B, assessFit, fitModelOfFile, packedTooHard, type FitDevice } from '../../../lib/device-fit'
import { MODELS_STRINGS as S } from '../../../strings/models'
import { fitOfNamedFile } from '../parts/catalog'
import { fitOfCatalogModel, fitWord } from '../parts/fit'

const PHONE: FitDevice = { platform: 'android', ramGb: 8 }
const MIB = 1_048_576
const src = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8')

describe('the rule', () => {
  it('needs a model of up to 4 billion parameters AND a 1 or 2 bit packing', () => {
    expect(COARSE_UP_TO_PARAMS_B).toBe(4)
    for (const quant of ['IQ2_M', 'IQ2_XXS', 'IQ2_XS', 'IQ2_S', 'IQ1_S', 'IQ1_M', 'Q2_K', 'Q2_K_S', 'Q2_K_L', 'iq2_m', ' IQ2_M ']) {
      for (const paramsB of [0.36, 0.6, 1, 1.5, 1.7, 2, 3, 4]) expect(packedTooHard(paramsB, quant), `${paramsB}B ${quant}`).toBe(true)
      // Above 4 billion the rule says nothing: nothing is measured there.
      for (const paramsB of [4.1, 7, 8, 12]) expect(packedTooHard(paramsB, quant), `${paramsB}B ${quant}`).toBe(false)
    }
    // From 3 bit on nothing changes, however small the model is.
    for (const quant of ['IQ3_XXS', 'IQ3_M', 'Q3_K_S', 'Q3_K_M', 'IQ4_XS', 'Q4_K_M', 'Q5_K_M', 'Q8_0', 'F16', 'BF16', 'Q20', '']) {
      for (const paramsB of [0.36, 2, 4]) expect(packedTooHard(paramsB, quant), `${paramsB}B ${quant}`).toBe(false)
    }
    // Without both facts LU does not guess.
    expect(packedTooHard(undefined, 'IQ2_M')).toBe(false)
    expect(packedTooHard(0.6, undefined)).toBe(false)
    expect(packedTooHard(Number.NaN, 'IQ2_M')).toBe(false)
  })
})

describe('the three files of the device run', () => {
  it('Qwen3 0.6B IQ2_M is tight for its answers, with words that say so', () => {
    const fit = fitOfNamedFile('Qwen3-0.6B-IQ2_M.gguf', Math.round(256.3 * MIB), PHONE)
    expect(fit.level).toBe('tight')
    expect(fit.coarse).toBe(true)
    expect(fitWord(fit)).toBe('Packed very small, answers may be poor')
    expect(fitWord(fit)).not.toMatch(/runs well|slow|tight/i)
    expect(fit.long).toContain('IQ2_M')
    expect(fit.long).toMatch(/answers can be wrong or unreadable/)
    // Nothing here is near a limit, and the page must not say so.
    expect(fit.long).not.toMatch(/limit|slow/i)
    const raw = assessFit({ device: PHONE, model: fitModelOfFile('Qwen3-0.6B-IQ2_M', Math.round(256.3 * MIB)) })
    expect(raw).toMatchObject({ verdict: 'tight', coarse: true, slow: false })
    expect(raw.reason).toContain('IQ2_M')
  })

  it('the same model in the listed packing still runs well', () => {
    const listed = MOBILE_CHAT_MODELS.find((m) => m.id === 'qwen3-0.6b')!
    const fit = fitOfCatalogModel(listed, PHONE)
    expect(fit.level).toBe('fits')
    expect(fit.coarse).toBeUndefined()
    expect(fitWord(fit)).toBe(S.fit.fits)
  })

  it('F8: Qwen 3.5 2B IQ2_M is no longer "Runs well", and says what suffers', () => {
    const qwen = fitOfNamedFile('Qwen3.5-2B-UD-IQ2_M.gguf', Math.round(820 * MIB), PHONE)
    expect(qwen.level).toBe('tight')
    expect(qwen.coarse).toBe(true)
    expect(fitWord(qwen)).toBe('Packed very small, answers may be poor')
    expect(qwen.long).toContain('IQ2_M')
    expect(qwen.long).not.toMatch(/limit|slow/i)
  })

  it('SmolLM3 3B IQ2_M was tight for its pace: the badge now speaks of the answers, the verdict knows both', () => {
    const smol = fitOfNamedFile('HuggingFaceTB_SmolLM3-3B-IQ2_M.gguf', Math.round(1024 * MIB), PHONE)
    expect(smol.level).toBe('tight')
    expect(smol.coarse).toBe(true)
    expect(fitWord(smol)).toBe(S.fit.coarse)
    const raw = assessFit({ device: PHONE, model: fitModelOfFile('HuggingFaceTB_SmolLM3-3B-IQ2_M', Math.round(1024 * MIB)) })
    expect(raw).toMatchObject({ verdict: 'tight', coarse: true, slow: true, nearLimit: false })
    expect(raw.reason).toMatch(/may answer badly/)
    expect(raw.reason).toMatch(/slowly/)
  })

  it('the same two models from 3 bit on keep the verdict they had', () => {
    const qwen = fitOfNamedFile('Qwen3.5-2B-Q3_K_M.gguf', Math.round(1100 * MIB), PHONE)
    expect(qwen.coarse).toBeUndefined()
    expect(qwen.level).toBe('fits')
    expect(fitWord(qwen)).toBe(S.fit.fits)
    const smol = fitOfNamedFile('HuggingFaceTB_SmolLM3-3B-Q4_K_M.gguf', Math.round(1900 * MIB), PHONE)
    expect(smol.coarse).toBeUndefined()
    expect(fitWord(smol)).not.toBe(S.fit.coarse)
  })

  it('above 4 billion parameters a 2 bit packing is judged by memory and pace as before', () => {
    const big = fitOfNamedFile('Some-Model-8B-IQ2_M.gguf', Math.round(2900 * MIB), { platform: 'android', ramGb: 16 })
    expect(big.coarse).toBeUndefined()
  })

  it('close to the memory limit as well: the badge still speaks of the answers, the page and the question say both', () => {
    // Find a class of phone on which the file is tight for memory.
    const near = ([3, 4, 6] as const)
      .map((ramGb) => ({ ramGb, raw: assessFit({ device: { platform: 'android', ramGb }, model: fitModelOfFile('Qwen3.5-4B-IQ2_M', Math.round(1500 * MIB)) }) }))
      .find((c) => c.raw.nearLimit)
    expect(near, 'a phone on which 4B IQ2_M is near the limit').toBeDefined()
    expect(near!.raw).toMatchObject({ verdict: 'tight', coarse: true, nearLimit: true })
    expect(near!.raw.reason).toMatch(/Tight on this device/)
    expect(near!.raw.reason).toMatch(/may answer badly/)
    const view = fitOfNamedFile('Qwen3.5-4B-IQ2_M.gguf', Math.round(1500 * MIB), { platform: 'android', ramGb: near!.ramGb })
    expect(view).toMatchObject({ level: 'tight', coarse: true, nearLimit: true })
    expect(fitWord(view)).toBe(S.fit.coarse)
    expect(view.long).toMatch(/close to the limit/)
    expect(view.long).toMatch(/IQ2_M is also a very small packing/)
  })

  it('a file LU knows only by its name is judged the same way', () => {
    const fit = fitOfNamedFile('some-tiny-model-0.5B-Q2_K.gguf', 300 * MIB, PHONE)
    expect(fit.coarse).toBe(true)
    // No size in the name and no catalogue entry: nothing is claimed.
    expect(fitOfNamedFile('my-own-finetune-IQ2_M.gguf', 300 * MIB, PHONE).coarse).toBeUndefined()
  })
})

describe('what the rule leaves alone', () => {
  it('no listed catalogue file is touched, on any RAM class', () => {
    for (const platform of ['ios', 'android'] as const) {
      for (const ramGb of [2, 3, 4, 6, 8, 12, 16]) {
        for (const model of MOBILE_CHAT_MODELS) {
          expect(fitOfCatalogModel(model, { platform, ramGb }).coarse, `${model.id} ${platform} ${ramGb}`).toBeUndefined()
        }
      }
    }
  })

  it('too large stays too large: the rule only speaks where the file would have been "runs well"', () => {
    const fit = fitOfNamedFile('Qwen3-0.6B-IQ2_M.gguf', Math.round(256.3 * MIB), { platform: 'android', ramGb: 2 })
    expect(fit.level).toBe('too-large')
    expect(fit.coarse).toBeUndefined()
  })

  it('loading is not held back: only "too-large" blocks a load', () => {
    const preload = readFileSync(join(__dirname, '../../chat/parts/preload.ts'), 'utf8')
    expect(preload).toMatch(/verdict === 'too-large'/)
    expect(preload).not.toMatch(/verdict === 'tight'|coarse/)
  })
})

describe('every badge takes its words from one place', () => {
  it('card, detail page and onboarding use fitWord, the model sheet names the same text', () => {
    for (const file of ['parts/ModelCard.tsx', 'ModelDetailPage.tsx', '../onboarding/SetupModelPage.tsx', 'BenchmarkPage.tsx']) {
      expect(src(file), file).toContain('fitWord(')
      expect(src(file), file).not.toContain('FIT_WORD')
    }
    expect(src('../chat/ModelSheet.tsx')).toContain('MODELS_STRINGS.fit.coarse')
  })

  it('the question before the download names the reason, not a limit', () => {
    const text = src('parts/start-download.ts')
    expect(text).toContain('fit.coarse && !fit.nearLimit ? S.fit.coarseTitle : S.fit.tightTitle')
    // Near the limit as well: the limit is the title, and the text says both.
    expect(text).toContain('fit.coarse ? (fit.nearLimit ? `${S.fit.tightText} ${S.fit.coarseText}` : S.fit.coarseText) : S.fit.tightText')
    expect(S.fit.coarseTitle).toBe('Answers may be poor')
    expect(S.fit.coarseText).not.toMatch(/limit/i)
  })

  // F13 of the second check: the list of the benchmark drew the badge without words, so the kit put its own
  // ("Tight fit, may be slow") where five other places said "Packed very small, answers may be poor".
  it('no screen draws a badge for a file without saying which words it carries', () => {
    const found: string[] = []
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)
        if (statSync(full).isDirectory()) {
          if (entry !== '__tests__') walk(full)
          continue
        }
        if (!entry.endsWith('.tsx')) continue
        const text = readFileSync(full, 'utf8')
        for (const tag of text.match(/<FitBadge\b[^>]*>/g) ?? []) if (!/\btext=/.test(tag)) found.push(`${entry}: ${tag}`)
      }
    }
    walk(join(__dirname, '..', '..'))
    expect(found).toEqual([])
  })

  it('the list of the benchmark says the same as the card for the file of the report', () => {
    const fit = fitOfNamedFile('Qwen3-0.6B-IQ2_M.gguf', Math.round(256.3 * MIB), PHONE)
    expect(fitWord(fit)).toBe('Packed very small, answers may be poor')
    expect(src('BenchmarkPage.tsx')).toContain('S.common.loaded : fitWord(fitOfFile(f, device))')
  })
})
