// @vitest-environment jsdom
/**
 * The price of a model the provider bills by the length of its input
 * (`credits.length`), on the phone, BEFORE the first tap.
 *
 * Driven through the real parts: PriceOwner measures the attached input and
 * leaves the price where the cloud hook reads its ceiling, and the facts of
 * the Create page show that number and hold the button while it is measured.
 * Only the measuring of a media file is replaced: jsdom plays nothing.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'

const media = vi.hoisted(() => ({
  seconds: new Map<string, number | undefined>(),
  open: [] as Array<() => void>,
  hold: false,
}))
vi.mock('../../../../components/create/experimental/useStudioPrice', () => ({
  useStudioPrice: () => null,
  mediaSeconds: (url: string) =>
    new Promise<number | undefined>((resolve) => {
      const done = () => resolve(media.seconds.get(url))
      if (media.hold) media.open.push(done)
      else done()
    }),
}))
vi.mock('../../../resilience/useOnline', () => ({ useCloudOnline: () => true }))
vi.mock('../../../../api/cloud/jobs', async (orig) => ({
  ...(await orig<typeof import('../../../../api/cloud/jobs')>()),
  getJob: async (id: string) => ({ id, result_url: `https://cdn.example/${id}.mp3` }),
}))

import type { CloudModel } from '../../../../lib/render/cloud-models'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useCloudCatalogStore } from '../../../../stores/cloudCatalogStore'
import { useCreateStore } from '../../../../stores/createStore'
import { useCreateFacts, usePriceStore } from '../parts/facts'
import { lengthBasis, lengthSource, lengthUnit } from '../parts/length-price'
import { PriceOwner } from '../parts/PriceOwner'
import { blockReason } from '../parts/run-state'

/** Shaped like /api/jobs/catalog: `base` is the price of `quote` units, `length` is the rule. */
const TALK = {
  id: 'infinitetalk-fast', label: 'InfiniteTalk Fast', kind: 'video', ops: ['lipsync'],
  credits: { base: 15_000, length: { basis: 'audio', block: 1, per_block: 1_500, min: 3, max: 600, quote: 10 } },
} as CloudModel
const RESYNC = {
  id: 'resync', label: 'Resync', kind: 'video', ops: ['lipsync'], lipsync_source: 'video',
  credits: { base: 20_000, length: { basis: 'video', block: 5, per_block: 10_000, min: 5, max: 120, quote: 10 } },
} as CloudModel
const VOICE = (id: string) => ({
  id, label: id, kind: 'audio', ops: ['tts'],
  credits: { base: 2_500, length: { basis: 'chars', block: 100, per_block: 500, min: 1, max: 4000, quote: 500 } },
}) as CloudModel
const FLAT = { id: 'flat-talk', label: 'Flat Talk', kind: 'video', ops: ['lipsync'], credits: { base: 9_000 } } as CloudModel

const blob = new Blob(['x'])
const QUOTA = { tier: 'hosted', period: '2026-10', limits: { credits: 2_000_000 }, costs: { image: 1000, video: 10_000 }, used: { credits_used: 0 }, remaining: { credits: 2_000_000 } } as never

function stage(model: string) {
  useCloudCatalogStore.setState({ models: [TALK, RESYNC, FLAT, VOICE('qwen3-tts'), VOICE('qwen3-tts-design')] })
  useCloudAuthStore.setState({ quota: QUOTA } as never)
  useCreateStore.setState({
    isGenerating: false, error: null, backend: 'cloud', mask: null, cloudStudioOptions: {}, cloudStudioCredits: null,
    cloudImageCount: 1, source: { url: 'data:image/png;base64,AA==', name: 'face.png' }, audioInput: null, videoInput: null,
    voiceFromJob: null, extendSource: null,
  } as never)
  useCreateStore.getState().setIntent('lipsync')
  useCreateStore.getState().setCloudOpModel(model)
  useCreateStore.getState().setPrompt('')
  usePriceStore.setState({ model: null, credits: null, live: false, error: null, inputSeconds: undefined, measuring: false })
}

/** What the button of the Create page reads. */
function Probe() {
  const f = useCreateFacts()
  return <output data-testid="probe" data-cost={String(f.cost)} data-state={f.priceState} data-block={String(f.block)} />
}
const probe = () => {
  const el = screen.getByTestId('probe')
  return { cost: el.getAttribute('data-cost'), state: el.getAttribute('data-state'), block: el.getAttribute('data-block') }
}
const show = () =>
  render(
    <>
      <PriceOwner />
      <Probe />
    </>,
  )

beforeEach(() => {
  media.seconds.clear()
  media.open.length = 0
  media.hold = false
})
afterEach(() => cleanup())

describe('the rule, as the phone asks it', () => {
  beforeEach(() => stage('infinitetalk-fast'))

  it('prices the measured seconds, and the characters of a voice', () => {
    expect(lengthUnit('infinitetalk-fast', 'lipsync', '', 42.2)).toBe(64_500)
    expect(lengthUnit('infinitetalk-fast', 'lipsync', '', undefined)).toBe(15_000)
    expect(lengthUnit('qwen3-tts', 'tts', 'x'.repeat(101), undefined)).toBe(1_000)
    expect(lengthUnit('qwen3-tts', 'tts', '', undefined)).toBe(2_500)
    expect(lengthUnit('flat-talk', 'lipsync', '', 42)).toBeNull()
    expect(lengthUnit('infinitetalk-fast', 'generate', '', 42)).toBeNull()
  })

  it('measures the input the model bills: the sound, a voice made earlier, or the clip', () => {
    const inputs = { audioUrl: 'blob:a', videoUrl: 'blob:v', extendUrl: 'blob:e', voiceJobId: 'job-1' }
    expect(lengthSource('lipsync', lengthBasis('infinitetalk-fast', 'lipsync'), inputs)).toEqual({ media: { url: 'blob:a', kind: 'audio' } })
    expect(lengthSource('lipsync', 'audio', { ...inputs, audioUrl: undefined })).toEqual({ voiceJobId: 'job-1' })
    expect(lengthSource('lipsync', lengthBasis('resync', 'lipsync'), inputs)).toEqual({ media: { url: 'blob:v', kind: 'video' } })
    expect(lengthSource('motion', 'video', inputs)).toEqual({ media: { url: 'blob:v', kind: 'video' } })
    expect(lengthSource('extend', 'video', inputs)).toEqual({ media: { url: 'blob:e', kind: 'video' } })
    expect(lengthSource('lipsync', 'chars', inputs)).toEqual({})
    expect(lengthSource('lipsync', undefined, inputs)).toEqual({})
  })
})

describe('the button of the Create page', () => {
  it('shows the price of the catalogue length while nothing is attached', async () => {
    stage('infinitetalk-fast')
    show()
    await waitFor(() => expect(useCreateStore.getState().cloudStudioCredits).toBe(15_000))
    expect(probe()).toMatchObject({ cost: '15000', state: 'known' })
  })

  it('shows the price of the attached sound before any tap, and the ceiling of the start is that number', async () => {
    stage('infinitetalk-fast')
    media.seconds.set('blob:line', 42.2)
    useCreateStore.setState({ audioInput: { url: 'blob:line', name: 'line.mp3', blob } } as never)
    show()
    await waitFor(() => expect(probe().cost).toBe('64500'))
    expect(probe()).toMatchObject({ state: 'known', block: 'null' })
    // hooks/useCloudCreate.ts sends `s.cloudStudioCredits ?? lengthCredits(model)` as max_credits.
    expect(useCreateStore.getState().cloudStudioCredits).toBe(64_500)
  })

  it('holds the button while the length is being measured, then opens it with the right number', async () => {
    stage('infinitetalk-fast')
    media.hold = true
    media.seconds.set('blob:line', 30)
    useCreateStore.setState({ audioInput: { url: 'blob:line', name: 'line.mp3', blob } } as never)
    show()
    await waitFor(() => expect(probe().state).toBe('measuring'))
    expect(probe().block).toBe('price-measuring')
    await act(async () => {
      for (const done of media.open.splice(0)) done()
    })
    await waitFor(() => expect(probe()).toMatchObject({ cost: '45000', state: 'known', block: 'null' }))
  })

  it('a file that cannot be measured does not hold the button for ever: the catalogue figure stands, the server measures', async () => {
    stage('infinitetalk-fast')
    media.seconds.set('blob:odd', undefined)
    useCreateStore.setState({ audioInput: { url: 'blob:odd', name: 'odd.bin', blob } } as never)
    show()
    await waitFor(() => expect(usePriceStore.getState().measuring).toBe(false))
    expect(probe()).toMatchObject({ cost: '15000', state: 'known', block: 'null' })
  })

  it('measures a voice made earlier through its job', async () => {
    stage('infinitetalk-fast')
    media.seconds.set('https://cdn.example/job-7.mp3', 12)
    useCreateStore.setState({ voiceFromJob: { jobId: 'job-7', label: 'Voice' } } as never)
    show()
    await waitFor(() => expect(probe().cost).toBe('18000'))
  })

  it('measures the clip for a model that bills the clip', async () => {
    stage('resync')
    media.seconds.set('blob:clip', 11)
    useCreateStore.setState({ videoInput: { url: 'blob:clip', name: 'clip.mp4', blob }, audioInput: { url: 'blob:line', name: 'l.mp3', blob } } as never)
    media.seconds.set('blob:line', 99)
    show()
    // 11 s are three started blocks of 5 s.
    await waitFor(() => expect(probe().cost).toBe('30000'))
  })

  it('after a 409 quote_changed the number of the server is the price, until an input changes', async () => {
    stage('infinitetalk-fast')
    media.seconds.set('blob:line', 20)
    useCreateStore.setState({ audioInput: { url: 'blob:line', name: 'line.mp3', blob } } as never)
    show()
    await waitFor(() => expect(probe().cost).toBe('30000'))
    // What the catch of the cloud hook does with the price of the server.
    act(() => useCreateStore.getState().setCloudStudioCredits(33_000))
    await waitFor(() => expect(probe().cost).toBe('33000'))
    media.seconds.set('blob:other', 5)
    act(() => useCreateStore.setState({ audioInput: { url: 'blob:other', name: 'o.mp3', blob } } as never))
    await waitFor(() => expect(probe().cost).toBe('7500'))
  })

  it('leaves a model with a flat price as it was', async () => {
    stage('flat-talk')
    media.seconds.set('blob:line', 42)
    useCreateStore.setState({ audioInput: { url: 'blob:line', name: 'line.mp3', blob } } as never)
    show()
    await waitFor(() => expect(usePriceStore.getState().measuring).toBe(false))
    expect(probe()).toMatchObject({ cost: '9000', state: 'known' })
    expect(useCreateStore.getState().cloudStudioCredits).toBeNull()
  })
})

describe('what stays', () => {
  it('a measuring price blocks the tap, and nothing else changed in the order of the reasons', () => {
    const ok = {
      online: true, tool: 'lipsync' as const, promptNeeded: false, prompt: '', sourceNeeded: false, hasSource: true, maskNeeded: false, hasMask: false,
      characterUse: false, hasCharacter: false, trainPhotos: 0, minTrainPhotos: 4, hasVoice: true, needsPortrait: true, needsClip: false, hasVideo: false,
      hasExtendClip: false, hasModel: true, priceState: 'known' as const, quotaKnown: true,
    }
    expect(blockReason(ok)).toBeNull()
    expect(blockReason({ ...ok, priceState: 'measuring' })).toBe('price-measuring')
    expect(blockReason({ ...ok, priceState: 'measuring', hasVoice: false })).toBe('no-voice')
  })

  it('the voice button shows the price of its text, the number makeVoice sends as the ceiling', () => {
    const cards = readFileSync(join(__dirname, '../parts/InputCards.tsx'), 'utf8')
    expect(cards).toContain("lengthUnit(voiceModel, 'tts', text.trim(), undefined) ?? cloudModelById(voiceModel)?.credits?.base")
    const hook = readFileSync(join(__dirname, '../../../../hooks/useCloudCreate.ts'), 'utf8')
    expect(hook).toContain("if (lengthPrice(model, 'tts')) params.max_credits = lengthCredits(model, Array.from(text).length)")
    expect(hook).toContain('params.max_credits = s.cloudStudioCredits ?? lengthCredits(model)')
    // 409 quote_changed and the request id of the phone stay.
    expect(hook).toContain('QuoteChangedError')
    expect(hook).toContain('client_request_id')
  })
})
