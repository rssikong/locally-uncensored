/**
 * The guided presets (K12): what a step needs, what is sent, and the run of
 * a step with its price, its ledger entry and its result. The cloud is a
 * stand in.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const cloud = vi.hoisted(() => ({
  order: [] as string[],
  submit: null as null | ((req: unknown) => Promise<{ id: string }>),
  poll: null as null | ((id: string) => Promise<unknown>),
  cancel: null as null | ((id: string) => Promise<unknown>),
  quote: null as null | (() => Promise<{ credits: number; seconds?: number }>),
  submits: [] as { kind: string; model: string; prompt: string; params: Record<string, unknown> }[],
}))

vi.mock('../../../../api/cloud/jobs', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/cloud/jobs')>('../../../../api/cloud/jobs')
  return {
    ...actual,
    submitCloudJob: vi.fn(async (req: { kind: string; model: string; prompt: string; params: Record<string, unknown> }) => {
      cloud.order.push('submit')
      cloud.submits.push(req)
      return cloud.submit ? cloud.submit(req) : { id: 'job-1' }
    }),
    pollJob: vi.fn(async (id: string) => {
      cloud.order.push('poll')
      return cloud.poll ? cloud.poll(id) : { id, kind: 'audio', model: 'm', status: 'succeeded', result_url: 'https://cdn.example/a.wav', attestation: null }
    }),
    cancelJob: vi.fn(async (id: string) => (cloud.cancel ? cloud.cancel(id) : { status: 'canceled' })),
    uploadInput: vi.fn(async (_blob: Blob, role: string) => `inputs/${role}-1`),
    getQuota: vi.fn(async () => ({ remaining: { credits: 50_000 } })),
  }
})
vi.mock('../../../../api/cloud/studio', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/cloud/studio')>('../../../../api/cloud/studio')
  return { ...actual, studioQuote: vi.fn(async () => (cloud.quote ? cloud.quote() : { credits: 1500 })) }
})
vi.mock('../../../../lib/pending-cloud-jobs', () => ({
  noteCloudSubmitIntent: vi.fn(() => cloud.order.push('intent')),
  settleCloudSubmitIntent: vi.fn((_id: string, answered: boolean) => cloud.order.push(`settle:${answered}`)),
  notePendingCloudJob: vi.fn(() => cloud.order.push('ledger')),
  forgetPendingCloudJob: vi.fn(() => cloud.order.push('forget')),
  unwatchCloudJob: vi.fn(() => cloud.order.push('unwatch')),
}))

import { CloudJobError } from '../../../../api/cloud/client'
import { QuoteChangedError } from '../../../../api/cloud/jobs'
import { CREATE_PRESETS } from '../../../../lib/render/create-presets'
import { useCloudAuthStore } from '../../../../stores/cloudAuthStore'
import { useCreateStore } from '../../../../stores/createStore'
import {
  guidedPresetById, guidedPresets, inputKindOf, keptPaths, promptWord, runLabel, slotFor, stepFields, stepMissing, stepParams, stepView,
  uploadRoleOf, withIdea,
} from '../parts/guided'
import {
  __resetGuidedForTests, cancelGuided, chooseGuidedModel, guidedTouched, isGuidedRunning, nextGuidedStep, openGuided, priceUsable,
  redoGuidedStep, refreshGuidedQuote, runGuidedStep, setGuidedOption, setGuidedPrompt, startOverGuided, useGuided, viewOf,
} from '../parts/guided-run'

const preset = (id: string) => {
  const p = CREATE_PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`no preset ${id}`)
  return p
}

describe('guided presets, the rules of a step', () => {
  it('offers the presets of the desktop, and leaves the ones without refusals out of a capped build', () => {
    expect(guidedPresets({ adult: true })).toHaveLength(CREATE_PRESETS.length)
    const capped = guidedPresets({ adult: false })
    expect(capped.length).toBeGreaterThan(0)
    expect(capped.every((p) => !p.adult)).toBe(true)
    expect(guidedPresetById('spicy-character', { adult: false })).toBeUndefined()
    expect(guidedPresetById('talking-avatar', { adult: false })?.title).toBe('Talking Avatar')
    expect(guidedPresetById(undefined, { adult: true })).toBeUndefined()
  })

  it('every step of every preset can be read: a model, a role, and inputs with a kind', () => {
    for (const p of CREATE_PRESETS) {
      p.steps.forEach((_, i) => {
        const view = stepView(p, i)
        expect(view.model, `${p.id} step ${i}`).toBeTruthy()
        expect(view.label, `${p.id} step ${i}`).toBeTruthy()
        expect(view.last).toBe(i === p.steps.length - 1)
        for (const input of view.inputs) {
          expect(['image', 'video', 'audio']).toContain(input.kind)
          // The painted area is not offered on the phone.
          expect(input.key).not.toBe('mask_path')
        }
        // Nothing is on the page AND under "More settings".
        const f = stepFields(view)
        expect(f.primary.filter((k) => f.other.includes(k))).toEqual([])
      })
    }
  })

  it('names what is missing, first things first, and nothing once the step is complete', () => {
    const view = stepView(preset('talking-avatar'), 1)
    expect(view.model).toBe('infinitetalk')
    const required = view.inputs.filter((i) => i.required).map((i) => i.key)
    expect(required).toEqual(expect.arrayContaining(['source_path', 'audio_path']))
    const first = stepMissing(view, { prompt: '', options: {}, paths: {} })
    expect(first?.what).toBe('input')
    const paths = Object.fromEntries(required.map((k) => [k, `inputs/${k}`]))
    const rest = stepMissing(view, { prompt: view.promptRequired ? 'hello' : '', options: {}, paths })
    expect(rest).toBeNull()
  })

  it('a text step needs its text', () => {
    const view = stepView(preset('talking-avatar'), 0)
    expect(view.role).toBe('speech')
    expect(view.inputs.filter((i) => i.required)).toEqual([])
    expect(stepMissing(view, { prompt: '  ', options: {}, paths: {} })).toEqual({ what: 'prompt' })
    expect(stepMissing(view, { prompt: 'hi', options: {}, paths: {} })).toBeNull()
    expect(promptWord(view.role)).toBe('speech')
  })

  it('sends a studio step with its options and uploads under the job parameters', () => {
    const view = stepView(preset('your-character'), 0)
    expect(view.studio).toBe(true)
    const params = stepParams(view, { options: { loras: [{ path: 'hardcut', scale: 0.8 }] }, paths: { source_path: 'inputs/source-1' } })
    expect(params).toMatchObject({ op: 'studio', source_path: 'inputs/source-1', studio_options: { loras: [{ path: 'hardcut', scale: 0.8 }] } })
    expect(stepFields(view).primary).toContain('loras')
  })

  it('keeps only the uploads the next model reads, and finds the slot a result goes into', () => {
    const p = preset('talking-avatar')
    const view = stepView(p, 1)
    const kept = keptPaths(p, 1, view.model, { source_path: 'a', audio_path: 'b', video_path: 'c', source_url: 'd' })
    expect(kept).toMatchObject({ source_path: 'a', audio_path: 'b', source_url: 'd' })
    expect('video_path' in kept).toBe(view.inputs.some((i) => i.key === 'video_path'))
    expect(slotFor(view, 'audio')?.key).toBe('audio_path')
    expect(slotFor(view, 'image')?.key).toBe('source_path')
  })

  it('small words: kinds, upload roles, labels, ideas', () => {
    expect(inputKindOf('audio_path')).toBe('audio')
    expect(inputKindOf('left_audio_path')).toBe('audio')
    expect(inputKindOf('video_path')).toBe('video')
    expect(inputKindOf('source_path')).toBe('image')
    expect(uploadRoleOf('audio_path')).toBe('audio')
    expect(uploadRoleOf('video_path')).toBe('video')
    expect(uploadRoleOf('image_paths')).toBe('source')
    const p = preset('talking-avatar')
    expect(runLabel(p, 0)).toBe('Talking Avatar · Create the voice')
    expect(runLabel(p, 1)).toBe('Talking Avatar')
    expect(withIdea('', 'soft light')).toBe('soft light')
    expect(withIdea(' a fox ', 'soft light')).toBe('a fox, soft light')
  })
})

describe('guided presets, the run of a step', () => {
  beforeEach(() => {
    __resetGuidedForTests()
    cloud.order = []
    cloud.submits = []
    cloud.submit = null
    cloud.poll = null
    cloud.cancel = null
    cloud.quote = null
    useCreateStore.setState({ gallery: [], isGenerating: false, error: null })
    useCloudAuthStore.setState({ quota: null })
  })

  const ready = async () => {
    openGuided(preset('talking-avatar'))
    setGuidedPrompt('Good morning')
    await refreshGuidedQuote()
  }

  it('does not start without a confirmed price for exactly what is on the page', async () => {
    openGuided(preset('talking-avatar'))
    expect(await runGuidedStep()).toBe('no-price')
    setGuidedPrompt('Good morning')
    await refreshGuidedQuote()
    expect(priceUsable(useGuided.getState())).toBe(true)
    // A change after the price was confirmed takes the price away again.
    setGuidedPrompt('Good evening')
    expect(priceUsable(useGuided.getState())).toBe(false)
    expect(await runGuidedStep()).toBe('no-price')
    expect(cloud.submits).toHaveLength(0)
  })

  it('refuses when the wallet is short, and when another run is in flight', async () => {
    await ready()
    const quote = useGuided.getState().quote ?? 0
    useCloudAuthStore.setState({ quota: { remaining: { credits: quote - 1 } } as never })
    expect(await runGuidedStep()).toBe('credits')
    useCloudAuthStore.setState({ quota: null })
    useCreateStore.setState({ isGenerating: true })
    expect(await runGuidedStep()).toBe('busy')
    expect(cloud.submits).toHaveLength(0)
  })

  it('writes the intent before the submit and the ledger entry before the first poll, then lands the result', async () => {
    await ready()
    const quote = useGuided.getState().quote
    expect(await runGuidedStep()).toBeNull()
    expect(cloud.order).toEqual(['intent', 'submit', 'ledger', 'settle:true', 'poll', 'forget'])
    expect(cloud.submits[0]).toMatchObject({ kind: 'audio', prompt: 'Good morning' })
    expect(cloud.submits[0].params).toMatchObject({ label: 'Talking Avatar · Create the voice', max_credits: quote })
    expect(String(cloud.submits[0].params.client_request_id)).toMatch(/[0-9a-f-]{36}/)
    const s = useGuided.getState()
    expect(s.done[0]).toEqual({ jobId: 'job-1', kind: 'audio' })
    expect(s.activeJob).toBeNull()
    expect(isGuidedRunning()).toBe(false)
    const create = useCreateStore.getState()
    expect(create.isGenerating).toBe(false)
    expect(create.gallery).toHaveLength(1)
    expect(create.gallery[0]).toMatchObject({ id: 'job-1', label: 'Talking Avatar · Create the voice', prompt: 'Good morning' })
  })

  it('a clear no at the submit books nothing and says why; the inputs stay', async () => {
    await ready()
    cloud.submit = async () => {
      throw new CloudJobError('This prompt was blocked by the content policy.', 400)
    }
    expect(await runGuidedStep()).toBeNull()
    expect(cloud.order).toEqual(['intent', 'submit', 'settle:true'])
    const s = useGuided.getState()
    expect(s.error).toContain('blocked')
    expect(s.done[0]).toBeUndefined()
    expect(s.prompt).toBe('Good morning')
    expect(useCreateStore.getState().isGenerating).toBe(false)
  })

  it('an answer that never came leaves the question open for the resume pass', async () => {
    await ready()
    cloud.submit = async () => {
      throw new CloudJobError('could not reach LU Cloud', 0)
    }
    await runGuidedStep()
    expect(cloud.order).toEqual(['intent', 'submit', 'settle:false'])
  })

  it('a higher price found while booking is shown and never booked silently', async () => {
    await ready()
    cloud.submit = async () => {
      throw new QuoteChangedError('price changed', 4200)
    }
    await runGuidedStep()
    const s = useGuided.getState()
    expect(s.quote).toBe(4200)
    expect(s.error).toContain('4,200')
    expect(priceUsable(s)).toBe(true)
    // The main page does not get a price notice for a preset.
    expect(useCreateStore.getState().error).toBeNull()
  })

  it('a lost line while rendering keeps the job in the ledger', async () => {
    await ready()
    cloud.poll = async () => {
      throw new CloudJobError('could not reach LU Cloud', 0)
    }
    await runGuidedStep()
    expect(cloud.order.slice(-2)).toEqual(['poll', 'unwatch'])
    expect(useGuided.getState().done[0]).toBeUndefined()
  })

  it('Cancel of a job a GPU already took says that it finishes', async () => {
    await ready()
    let release: (job: unknown) => void = () => undefined
    cloud.poll = (id) => new Promise((resolve) => (release = () => resolve({ id, kind: 'audio', model: 'm', status: 'succeeded', result_url: 'https://cdn.example/a.wav', attestation: null })))
    const running = runGuidedStep()
    await vi.waitFor(() => expect(useGuided.getState().activeJob).toBe('job-1'))
    expect(isGuidedRunning()).toBe(true)
    expect(useCreateStore.getState().isGenerating).toBe(true)
    cloud.cancel = async () => {
      throw new CloudJobError('job is no longer cancelable', 409)
    }
    await cancelGuided()
    expect(useGuided.getState().error).toMatch(/stopped/i)
    expect(useGuided.getState().cancelling).toBe(false)
    release(null)
    await running
    expect(useGuided.getState().done[0]).toBeDefined()
  })

  it('the next step starts empty, Try again drops the result, Start over clears the run', async () => {
    await ready()
    await runGuidedStep()
    // No address to fetch in this test: the carry over is covered by the e2e file, the move itself is checked here.
    useCreateStore.setState({ gallery: [] })
    await nextGuidedStep()
    let s = useGuided.getState()
    expect(s.index).toBe(1)
    expect(s.prompt).toBe('')
    expect(s.quote).toBeNull()
    expect(viewOf(s)?.model).toBe('infinitetalk')
    expect(guidedTouched(s)).toBe(true)
    // Nothing done on step two: Try again has nothing to drop.
    redoGuidedStep()
    expect(useGuided.getState().done[0]).toBeDefined()
    startOverGuided()
    s = useGuided.getState()
    expect(s.index).toBe(0)
    expect(s.done).toEqual({})
    expect(s.preset?.id).toBe('talking-avatar')
    expect(guidedTouched(s)).toBe(false)
  })

  it('another model for the step drops its settings and the price, and an open preset is not replaced by itself', async () => {
    openGuided(preset('spicy-character'))
    const view = viewOf(useGuided.getState())
    const other = view?.alternatives.find((m) => m.id !== view.model)
    setGuidedOption('duration', 8)
    setGuidedPrompt('a knight')
    if (other) {
      chooseGuidedModel(other.id)
      const s = useGuided.getState()
      expect(viewOf(s)?.model).toBe(other.id)
      expect(s.options).toEqual({})
      expect(s.prompt).toBe('a knight')
      expect(s.quote).toBeNull()
    }
    openGuided(preset('spicy-character'))
    expect(useGuided.getState().prompt).toBe('a knight')
    openGuided(preset('talking-avatar'))
    expect(useGuided.getState().prompt).toBe('')
  })
})
