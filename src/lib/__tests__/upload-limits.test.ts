import { beforeEach, describe, expect, it } from 'vitest'
import { useCloudCatalogStore } from '../../stores/cloudCatalogStore'
import { DEFAULT_UPLOAD_LIMITS, UPLOAD_LIMIT_CEILING, UPLOAD_LIMIT_FLOOR, uploadLimitBytes, uploadLimits, uploadLimitsFrom } from '../upload-limits'

const MIB = 1024 * 1024

beforeEach(() => {
  useCloudCatalogStore.setState({ uploadLimits: null })
})

describe('upload limits', () => {
  it('are the built-in ones while the catalog names none', () => {
    expect(uploadLimits()).toEqual({ image: 30 * MIB, audio: 30 * MIB, video: 150 * MIB })
    expect(uploadLimitsFrom(undefined)).toEqual(DEFAULT_UPLOAD_LIMITS)
    expect(uploadLimitsFrom('30')).toEqual(DEFAULT_UPLOAD_LIMITS)
  })

  it('are the catalog ones once the server sends them', () => {
    useCloudCatalogStore.getState().setCatalog({
      models: [], ops: { removebg: 1, eraser: 1, upscale_image: 1, upscale_video_per_s: 1, upscale_video_min: 1 },
      voice: { stt: 1, tts_per_1k_chars: 1 }, media_live: true, tier: 'pro', monthly_credits: 0,
      upload_limits: { image: 50 * MIB, video: 400 * MIB },
    })
    expect(uploadLimitBytes('image')).toBe(50 * MIB)
    expect(uploadLimitBytes('video')).toBe(400 * MIB)
    // Not named: the default stays.
    expect(uploadLimitBytes('audio')).toBe(30 * MIB)
  })

  it('a catalog without the field puts the defaults back', () => {
    useCloudCatalogStore.setState({ uploadLimits: { image: 50 * MIB } })
    useCloudCatalogStore.getState().setCatalog({
      models: [], ops: { removebg: 1, eraser: 1, upscale_image: 1, upscale_video_per_s: 1, upscale_video_min: 1 },
      voice: { stt: 1, tts_per_1k_chars: 1 }, media_live: true, tier: 'pro', monthly_credits: 0,
    })
    expect(uploadLimits()).toEqual(DEFAULT_UPLOAD_LIMITS)
  })

  it('believes only sane numbers: a catalog cannot switch the check off or lock everything out', () => {
    expect(uploadLimitsFrom({ image: 0, audio: -5, video: Number.NaN })).toEqual(DEFAULT_UPLOAD_LIMITS)
    expect(uploadLimitsFrom({ image: '50000000', audio: null, video: Infinity })).toEqual(DEFAULT_UPLOAD_LIMITS)
    expect(uploadLimitsFrom({ video: 1e15 }).video).toBe(UPLOAD_LIMIT_CEILING)
    expect(uploadLimitsFrom({ image: 12 }).image).toBe(UPLOAD_LIMIT_FLOOR)
    expect(uploadLimitsFrom({ image: 10.9 * MIB }).image).toBe(Math.floor(10.9 * MIB))
  })
})
