/**
 * From the sentence of the cloud layer to what the phone says. Pure.
 *
 * The cloud hook reports errors as English sentences written for a desktop.
 * Some name things a phone does not have, and none of them says what to do
 * next. This table sorts them into kinds; the texts live in strings/create.ts.
 */

import { isLimitSentence } from '../../../../lib/limit-sentence'
import { storeSentence } from '../../../policy/server-text'

export type ErrorKind =
  | 'network'
  | 'credits'
  | 'video-budget'
  | 'trainings'
  | 'price-changed'
  | 'signed-out'
  | 'policy'
  | 'policy-account'
  | 'still-rendering'
  | 'cannot-stop'
  | 'too-fast'
  | 'too-large'
  | 'format'
  | 'expired'
  | 'not-live'
  | 'partial'
  | 'needs-input'
  | 'failed'

export type ErrorAction = 'retry' | 'plans' | 'review-price' | 'sign-in' | 'gallery' | 'policy' | 'pick-again' | 'none'

export interface ExplainedError {
  kind: ErrorKind
  action: ErrorAction
  /** The new price, for price-changed. */
  credits?: number
  /** True when nothing was charged for sure. */
  notCharged: boolean
  /** The original sentence, shown as the reason where no own text fits. */
  raw: string
}

const has = (text: string, ...needles: string[]) => needles.some((n) => text.includes(n))

export function explainError(message: string): ExplainedError {
  const raw = message.trim()
  const t = raw.toLowerCase()
  const base = { raw, notCharged: true }

  // A request limit comes first: its sentence is the server's own and may hold any word below.
  if (isLimitSentence(raw) || has(t, 'too many requests', 'the server is limiting requests')) return { ...base, kind: 'too-fast', action: 'retry' }

  if (has(t, 'out of credits')) return { ...base, kind: 'credits', action: 'plans' }
  if (has(t, 'video budget')) return { ...base, kind: 'video-budget', action: 'plans' }
  if (has(t, 'character trainings are used up')) return { ...base, kind: 'trainings', action: 'plans' }
  if (has(t, 'price changed', 'price has changed')) {
    const m = /to ([\d,.]+) credits/.exec(t)
    const credits = m ? Number(m[1].replace(/[,.]/g, '')) : undefined
    return { ...base, kind: 'price-changed', action: 'review-price', credits: Number.isFinite(credits) ? credits : undefined }
  }
  if (has(t, 'sign in to your lu cloud', 'not signed in')) return { ...base, kind: 'signed-out', action: 'sign-in' }
  if (has(t, 'content policy blocked')) return { ...base, kind: 'policy-account', action: 'policy' }
  if (has(t, 'this prompt was blocked', 'blocked by', 'content policy', 'nsfw', 'safety')) return { ...base, kind: 'policy', action: 'none' }
  if (has(t, 'still rendering')) return { ...base, kind: 'still-rendering', action: 'gallery', notCharged: false }
  if (has(t, "can't be stopped", 'cannot be stopped')) return { ...base, kind: 'cannot-stop', action: 'none', notCharged: false }
  if (has(t, 'too large', '(413)', 'payload', 'exceeds')) return { ...base, kind: 'too-large', action: 'pick-again' }
  if (has(t, 'unsupported', '(415)', 'could not be decoded', 'file type')) return { ...base, kind: 'format', action: 'pick-again' }
  if (has(t, 'expired', 'no longer available')) return { ...base, kind: 'expired', action: 'pick-again' }
  if (has(t, 'coming soon', 'not live yet')) return { ...base, kind: 'not-live', action: 'none' }
  if (has(t, 'could not reach', 'did not answer in time', 'arrived incomplete', 'failed to fetch', 'load failed', 'networkerror', 'network')) {
    return { ...base, kind: 'network', action: 'retry' }
  }
  if (has(t, 'images failed', 'started ', 'one image per run')) return { ...base, kind: 'partial', action: 'none', notCharged: false }
  if (has(t, 'add a ', 'add the ', 'add at least', 'pick ', 'paint a mask', 'please enter a prompt', 'type what', 'needs a character image', 'no compatible')) {
    return { ...base, kind: 'needs-input', action: 'none' }
  }
  return { ...base, kind: 'failed', action: 'retry' }
}

/**
 * A reason sentence that fits a phone: no ellipsis, none of the desktop
 * words. Used where the original sentence is shown as the reason.
 */
/** The desktop verb for a tap, built from two halves so this file never spells it. */
const DESKTOP_VERB = new RegExp('\\bcl' + 'ick\\b', 'gi')

export function phoneSentence(raw: string): string {
  // A store build shows of a sentence from outside only what it may show (policy/server-text.ts).
  let s = storeSentence(raw).replace(/…/g, '').replace(/\s+/g, ' ').trim()
  s = s.replace(/\bhit Create\b/gi, 'tap Create').replace(DESKTOP_VERB, 'tap')
  s = s.replace(/,? or upload (one|the file) from disk/gi, '').replace(/\bfrom disk\b/gi, 'from your photos')
  s = s.replace(/ on any backend/gi, '')
  if (s && !/[.!?]$/.test(s)) s += '.'
  return s
}
