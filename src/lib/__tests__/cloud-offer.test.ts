// The rules and the words of the LU Cloud line (lib/cloud-offer.ts).
import { describe, it, expect } from 'vitest'
import {
  bundleCloudTask, createOfferLine, createOfferReason, offerCreditsLine, tileOfferLine,
  type CreateOfferFacts,
} from '../cloud-offer'

const pc = (intent: string, fit: CreateOfferFacts['fit']): CreateOfferFacts =>
  ({ intent, macHost: false, fit, macMemoryShort: false, macLongRun: false })
const mac = (intent: string, macMemoryShort: boolean, macLongRun: boolean): CreateOfferFacts =>
  ({ intent, macHost: true, fit: 'unknown', macMemoryShort, macLongRun })

describe('which task a bundle leads to', () => {
  it('follows the task, not the model', () => {
    expect(bundleCloudTask('image', {})).toBe('image')
    expect(bundleCloudTask('video', {})).toBe('video')
    expect(bundleCloudTask('video', { i2v: true })).toBe('animate')
    expect(bundleCloudTask('video', {}, 'Music')).toBe('music')
    expect(bundleCloudTask('video', {}, 'Lip sync')).toBe('lipsync')
    expect(bundleCloudTask('video', { i2v: true }, 'Motion')).toBe('motion')
  })
})

describe('when Create offers the cloud', () => {
  it('a PC model too big for the card, on every tab with a cloud lane', () => {
    for (const intent of ['image', 'edit', 'video', 'animate', 'extend', 'lipsync', 'motion', 'music']) {
      expect(createOfferReason(pc(intent, 'big'))).toBe('too-big')
    }
  })

  it('a tight model only on a video tab', () => {
    expect(createOfferReason(pc('video', 'tight'))).toBe('partly')
    expect(createOfferReason(pc('animate', 'tight'))).toBe('partly')
    expect(createOfferReason(pc('image', 'tight'))).toBeNull()
    expect(createOfferReason(pc('music', 'tight'))).toBeNull()
  })

  it('never for a model that fits or a card nobody measured', () => {
    expect(createOfferReason(pc('video', 'fits'))).toBeNull()
    expect(createOfferReason(pc('video', 'unknown'))).toBeNull()
  })

  it('never on a tab without a cloud lane of its own', () => {
    expect(createOfferReason(pc('removebg', 'big'))).toBeNull()
    expect(createOfferReason(pc('upscale', 'big'))).toBeNull()
  })

  it('on a Mac from its memory verdict and its measured run time, video only', () => {
    expect(createOfferReason(mac('video', true, false))).toBe('mac-memory')
    expect(createOfferReason(mac('animate', false, true))).toBe('mac-long')
    expect(createOfferReason(mac('video', true, true))).toBe('mac-memory')
    expect(createOfferReason(mac('video', false, false))).toBeNull()
    expect(createOfferReason(mac('image', true, true))).toBeNull()
  })
})

describe('the words', () => {
  it('a tile names the card or the Mac and the task', () => {
    expect(tileOfferLine('video', false)).toBe('Too big for this graphics card. Videos run on LU Cloud.')
    expect(tileOfferLine('chat', false)).toBe('Too big for this graphics card. Large chat models run on LU Cloud.')
    expect(tileOfferLine('image', true)).toBe("Too big for this Mac's memory. Images run on LU Cloud.")
  })

  it('Create says why, in plain words', () => {
    expect(createOfferLine('too-big', 'animate')).toBe('Too big for this graphics card. Videos run on LU Cloud.')
    expect(createOfferLine('partly', 'video')).toBe('This model only partly fits this graphics card, so a run can take long. Videos also run on LU Cloud.')
    expect(createOfferLine('mac-memory', 'video')).toBe("Too big for this Mac's memory. Videos run on LU Cloud.")
    expect(createOfferLine('mac-long', 'video')).toBe('This run takes long on this Mac. Videos also run on LU Cloud.')
  })

  it('a price only when it is known, and never a money amount', () => {
    expect(offerCreditsLine(8000)).toBe('About 8,000 credits per run.')
    expect(offerCreditsLine(0)).toBe('')
    expect(offerCreditsLine(undefined)).toBe('')
    expect(offerCreditsLine(Number.NaN)).toBe('')
  })

  it('no dash, no money sign in any line', () => {
    const lines = [
      tileOfferLine('chat', false), tileOfferLine('music', true),
      createOfferLine('too-big', 'image'), createOfferLine('partly', 'lipsync'),
      createOfferLine('mac-memory', 'video'), createOfferLine('mac-long', 'animate'),
      offerCreditsLine(1234),
    ]
    for (const l of lines) expect(l).not.toMatch(/[\u2013\u2014€$]| - /)
  })
})
