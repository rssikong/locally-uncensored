/**
 * The numbers in the texts of Create are the numbers the code checks: how
 * many photos a training takes, and how long the cloud keeps a result. A text
 * with a number of its own would go stale the day the rule changes.
 */
import { describe, expect, it } from 'vitest'
import { MIN_TRAIN_IMAGES, maxTrainImages } from '../../../../lib/train-image-cap'
import { CLOUD_RETENTION_DAYS } from '../../../../stores/cloudNoticeStore'
import { CREATE_STRINGS as T } from '../../../strings/create'

const MAX = maxTrainImages('cloud')

/** Every text of the strand. Texts with a blank are filled with numbers no rule uses, so a number that shows up is the text's own. */
function allTexts(node: unknown, path = 'T', out: Array<{ path: string; text: string }> = []): Array<{ path: string; text: string }> {
  if (typeof node === 'string') out.push({ path, text: node })
  else if (typeof node === 'function') {
    try {
      const got = (node as (...a: unknown[]) => unknown)(991, 992, 993)
      if (typeof got === 'string') out.push({ path: `${path}()`, text: got })
    } catch {
      /* a text that needs a certain argument is covered where it is used */
    }
  } else if (Array.isArray(node)) node.forEach((v, i) => allTexts(v, `${path}[${i}]`, out))
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) allTexts(v, `${path}.${k}`, out)
  return out
}

const texts = allTexts(T)

describe('numbers in the texts of Create', () => {
  it('the texts that name the rule use the numbers of the code', () => {
    expect(T.block['no-photos']).toBe(`Add at least ${MIN_TRAIN_IMAGES} photos`)
    expect(T.chars.emptyText).toContain(`${MIN_TRAIN_IMAGES} to ${MAX} photos`)
    expect(T.newChar.addHint(MIN_TRAIN_IMAGES, MAX)).toContain(`${MIN_TRAIN_IMAGES} to ${MAX} photos`)
    expect(T.newChar.tooFew(MIN_TRAIN_IMAGES)).toContain(String(MIN_TRAIN_IMAGES))
    expect(T.retention(CLOUD_RETENTION_DAYS)).toContain(`${CLOUD_RETENTION_DAYS} days`)
    expect(T.item.expiredText(CLOUD_RETENTION_DAYS)).toContain(`${CLOUD_RETENTION_DAYS} days`)
  })

  it('the rule itself is 4 to 30 photos and 7 days', () => {
    expect([MIN_TRAIN_IMAGES, MAX, CLOUD_RETENTION_DAYS]).toEqual([4, 30, 7])
  })

  it('no text carries a number of photos or days of its own', () => {
    expect(texts.length).toBeGreaterThan(300)
    const photos = new Set([MIN_TRAIN_IMAGES, MAX, 991, 992, 993])
    const days = new Set([991, 992, 993])
    const wrong: string[] = []
    for (const { path, text } of texts) {
      for (const m of text.matchAll(/(\d+) (?:to (\d+) )?photos\b/g)) {
        for (const n of [m[1], m[2]].filter(Boolean).map(Number)) if (!photos.has(n)) wrong.push(`${path}: "${text}"`)
      }
      // A length in days is always handed in, never written out.
      for (const m of text.matchAll(/(\d+) days?\b/g)) if (!days.has(Number(m[1]))) wrong.push(`${path}: "${text}"`)
      if (/\b(a|one) (week|month)\b|\b\d+ (weeks?|months?|hours?)\b/i.test(text) && /kept|stay|expire|available/i.test(text)) wrong.push(`${path}: "${text}"`)
    }
    expect(wrong).toEqual([])
  })

  it('no text has a dash', () => {
    expect(texts.filter(({ text }) => /[\u2013\u2014]/.test(text)).map((t) => t.path)).toEqual([])
  })
})
