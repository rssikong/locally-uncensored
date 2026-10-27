/**
 * Fetches the price of a model whose price the server confirms, once, and
 * publishes it (facts.ts, usePriceStore). Rendered by CreatePage only.
 *
 * It also measures the input of a model the provider bills by length
 * (length-price.ts) and publishes the price of that length, so the button
 * shows the right number before the first tap. The number goes along with the
 * start as its ceiling (hooks/useCloudCreate.ts reads cloudStudioCredits).
 */
import { useEffect, useState } from 'react'
import { useCreateStore } from '../../../../stores/createStore'
import { getJob } from '../../../../api/cloud/jobs'
import { mediaSeconds, useStudioPrice } from '../../../../components/create/experimental/useStudioPrice'
import { useCreateFacts, usePriceStore } from './facts'
import { lengthBasis, lengthSource, lengthUnit } from './length-price'

/** Bump to ask the server again after "Price could not be confirmed". */
let retryNonce = 0
const listeners = new Set<() => void>()
export function retryPrice(): void {
  retryNonce++
  usePriceStore.getState().set({ error: null, credits: null, live: false })
  for (const fn of listeners) fn()
}

function Owner() {
  const f = useCreateFacts()
  const options = useCreateStore((s) => s.cloudStudioOptions)
  const prompt = useCreateStore((s) => s.prompt)
  const musicDuration = useCreateStore((s) => s.musicDuration)
  const references = useCreateStore((s) => s.references)
  const audioInput = useCreateStore((s) => s.audioInput)
  const voiceFromJob = useCreateStore((s) => s.voiceFromJob)
  const videoInput = useCreateStore((s) => s.videoInput)
  const extendSource = useCreateStore((s) => s.extendSource)
  const setCloudStudioCredits = useCreateStore((s) => s.setCloudStudioCredits)

  const studioPick = f.model.studio ? f.model.id : undefined

  // Models that bill by the length of what goes in need that length before they can name a price.
  // A Studio model always reads the sound of a lip sync; a classic model says in the catalogue what it bills.
  const lengthModel = !studioPick && f.model.id ? f.model.id : undefined
  const basis = lengthBasis(lengthModel, f.op)
  const source = lengthSource(f.tool, studioPick ? (f.tool === 'lipsync' ? 'audio' : 'video') : basis, {
    audioUrl: audioInput?.url,
    videoUrl: videoInput?.url,
    extendUrl: extendSource?.url,
    voiceJobId: voiceFromJob?.jobId,
  })
  const mediaUrl = source.media?.url
  const mediaKind = source.media?.kind ?? ('video' as const)
  const [measured, setMeasured] = useState<{ url: string; seconds: number | undefined } | null>(null)
  useEffect(() => {
    let alive = true
    if (!mediaUrl) return
    void mediaSeconds(mediaUrl, mediaKind).then((seconds) => {
      if (alive) setMeasured({ url: mediaUrl, seconds })
    })
    return () => {
      alive = false
    }
  }, [mediaUrl, mediaKind])
  const voiceJobId = source.voiceJobId
  const [measuredVoice, setMeasuredVoice] = useState<{ jobId: string; seconds: number | undefined } | null>(null)
  useEffect(() => {
    let alive = true
    if (!voiceJobId) return
    void getJob(voiceJobId)
      .then((job) => (job.result_url ? mediaSeconds(job.result_url, 'audio') : undefined))
      .then((seconds) => {
        if (alive) setMeasuredVoice({ jobId: voiceJobId, seconds })
      })
      .catch(() => {
        if (alive) setMeasuredVoice({ jobId: voiceJobId, seconds: undefined })
      })
    return () => {
      alive = false
    }
  }, [voiceJobId])
  const inputSeconds =
    (measured && measured.url === mediaUrl ? measured.seconds : undefined) ??
    (measuredVoice && measuredVoice.jobId === voiceJobId ? measuredVoice.seconds : undefined)
  // Something is attached and its length is not back yet. A file that cannot be read answers too (undefined).
  const measuring = (!!mediaUrl && measured?.url !== mediaUrl) || (!!voiceJobId && measuredVoice?.jobId !== voiceJobId)
  const lengthShown = lengthUnit(lengthModel, f.op, prompt, inputSeconds)

  const runSeconds = f.op === 'music' ? musicDuration : undefined
  const extraPhotos = f.tool === 'edit' || f.tool === 'animate' ? references.length : 0
  const price = useStudioPrice(studioPick, options, prompt, runSeconds ?? inputSeconds, extraPhotos)

  const credits = price?.credits ?? null
  const live = price?.live === true
  const error = price?.error ?? null
  useEffect(() => {
    // The cloud hook compares the confirmed price at the start with this number.
    // After a 409 quote_changed the hook writes the number of the server here, and it stays until an input changes.
    setCloudStudioCredits(credits ?? lengthShown)
    usePriceStore.getState().set({ model: studioPick ?? (lengthShown !== null ? (lengthModel ?? null) : null), credits, live, error, inputSeconds, measuring })
  }, [studioPick, lengthModel, lengthShown, credits, live, error, inputSeconds, measuring, setCloudStudioCredits])

  return null
}

export function PriceOwner() {
  const [nonce, setNonce] = useState(retryNonce)
  useEffect(() => {
    const fn = () => setNonce(retryNonce)
    listeners.add(fn)
    return () => {
      listeners.delete(fn)
    }
  }, [])
  return <Owner key={nonce} />
}
