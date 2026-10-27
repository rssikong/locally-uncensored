import { describe, expect, it } from 'vitest'
import { explainError, phoneSentence } from '../parts/errors'
import { DEFAULT_UPLOAD_LIMITS as MAX_BYTES } from '../../../../lib/upload-limits'
import { checkFile, fileKind, isHeic, needsReencode, saveName, saveTarget, scaledSize } from '../parts/files'
import { BUILT_IN_STYLES, MAX_USER_STYLES, applyStyleText, checkStyle, cleanStyle, stylesFor, type PromptStyle } from '../parts/styles'
import { CREATE_STRINGS as T } from '../../../strings/create'

describe('what went wrong', () => {
  it('sorts the sentences of the cloud layer into kinds with a next step', () => {
    const cases: [string, string, string][] = [
      ['You are out of credits for this month.', 'credits', 'plans'],
      ['Your video budget for this month is used up.', 'video-budget', 'plans'],
      ['Your included character trainings are used up. Top-up credits keep training going, or upgrade your plan.', 'trainings', 'plans'],
      ['Sign in to your LU Cloud account to render in the cloud.', 'signed-out', 'sign-in'],
      ['This prompt was blocked by the safety check.', 'policy', 'none'],
      ['Too many requests. Wait 12s and try again.', 'too-fast', 'retry'],
      ['Upload failed (413)', 'too-large', 'pick-again'],
      ['Unsupported file type.', 'format', 'pick-again'],
      ['The result link has expired.', 'expired', 'pick-again'],
      ['Could not reach LU Cloud. Check your connection.', 'network', 'retry'],
      ['Failed to fetch', 'network', 'retry'],
      ['The render is still rendering in the cloud.', 'still-rendering', 'gallery'],
      ['Something odd happened', 'failed', 'retry'],
    ]
    for (const [message, kind, action] of cases) {
      expect(explainError(message), message).toMatchObject({ kind, action })
    }
  })

  it('reads the new price', () => {
    expect(explainError('The price changed to 1,250 credits. Review it and start again.')).toMatchObject({ kind: 'price-changed', credits: 1250, action: 'review-price' })
  })

  it('says when something may have been charged', () => {
    expect(explainError('Could not reach the server').notCharged).toBe(true)
    expect(explainError('It is still rendering').notCharged).toBe(false)
  })

  it('turns a desktop sentence into one for a phone', () => {
    const verb = 'cl' + 'ick'
    expect(phoneSentence(`Add an image, then ${verb} Create`)).toBe('Add an image, then tap Create.')
    expect(phoneSentence('Pick a clip from the gallery, or upload one from disk.')).toBe('Pick a clip from the gallery.')
    expect(phoneSentence('Uploading…')).toBe('Uploading.')
  })
})

describe('files', () => {
  it('knows the kind by type, and by name when the picker gives no type', () => {
    expect(fileKind({ name: 'a.bin', type: 'image/png' })).toBe('image')
    expect(fileKind({ name: 'IMG_0001.HEIC', type: '' })).toBe('image')
    expect(fileKind({ name: 'clip.mov', type: 'application/octet-stream' })).toBe('video')
    expect(fileKind({ name: 'notes.pdf', type: 'application/pdf' })).toBeNull()
    expect(fileKind({ name: 'noext', type: '' })).toBeNull()
  })

  it('a HEIC photo is an image that is encoded again before the upload', () => {
    const heic = { name: 'IMG_1.heic', type: 'image/heic' }
    expect(isHeic(heic)).toBe(true)
    expect(isHeic({ name: 'IMG_2.HEIF', type: '' })).toBe(true)
    expect(checkFile({ ...heic, size: 1000 }, 'image')).toBeNull()
    expect(needsReencode(heic, null)).toBe(true)
    expect(needsReencode({ name: 'a.jpg', type: 'image/jpeg' }, { width: 3000, height: 2000 })).toBe(false)
    expect(needsReencode({ name: 'a.jpg', type: 'image/jpeg' }, { width: 6000, height: 4000 })).toBe(true)
  })

  it('refuses the wrong kind, an empty file and a file that is too large', () => {
    expect(checkFile({ name: 'a.mp4', type: 'video/mp4', size: 10 }, 'image')).toEqual({ kind: 'wrong-kind', wanted: 'image' })
    expect(checkFile({ name: 'a.png', type: 'image/png', size: 0 }, 'image')).toEqual({ kind: 'empty' })
    expect(checkFile({ name: 'a.png', type: 'image/png', size: MAX_BYTES.image + 1 }, 'image')).toMatchObject({ kind: 'too-large', limitMb: 30 })
    expect(checkFile({ name: 'a.mp4', type: 'video/mp4', size: MAX_BYTES.image + 1 }, 'video')).toBeNull()
  })

  it('scales a huge photo down and leaves the rest alone', () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 4000, height: 3000 })
    expect(scaledSize(8192, 4096)).toEqual({ width: 4096, height: 2048 })
  })

  it('names a saved result and picks where it goes', () => {
    const at = new Date(2026, 9, 8, 9, 5).getTime()
    expect(saveName('image', 'image/webp', at, 'job-abc123')).toEqual({ name: 'lu-20261008-0905-abc123.webp', mime: 'image/webp' })
    expect(saveName('video', '', at, 'x')).toEqual({ name: 'lu-20261008-0905-x.mp4', mime: 'video/mp4' })
    expect(saveTarget('image')).toBe('photos')
    expect(saveTarget('video')).toBe('photos')
    expect(saveTarget('audio')).toBe('files')
  })
})

describe('prompt styles', () => {
  const own: PromptStyle = { id: 'u1', name: 'Moody', tool: 'image', text: 'soft light' }

  it('adds the building block once', () => {
    expect(applyStyleText('', 'soft light')).toBe('soft light')
    expect(applyStyleText('a fox', 'soft light')).toBe('a fox, soft light')
    expect(applyStyleText('a fox, Soft Light', 'soft light')).toBe('a fox, Soft Light')
    expect(applyStyleText('a fox', '  ')).toBe('a fox')
  })

  it('checks a draft', () => {
    expect(checkStyle({ name: ' ', text: 'x' }, [])).toBe('no-name')
    expect(checkStyle({ name: 'A', text: '' }, [])).toBe('no-content')
    expect(checkStyle({ name: 'A', text: '', aspect: '1:1' }, [])).toBeNull()
    expect(checkStyle({ name: 'moody', text: 'x' }, [own])).toBe('name-taken')
    expect(checkStyle({ id: 'u1', name: 'Moody', text: 'x' }, [own])).toBeNull()
    const many = Array.from({ length: MAX_USER_STYLES }, (_, i) => ({ ...own, id: `u${i}`, name: `n${i}` }))
    expect(checkStyle({ name: 'new', text: 'x' }, many)).toBe('full')
  })

  it('cleans a draft and lists the own styles before the built in ones', () => {
    const p = cleanStyle({ name: '  My   look ', tool: 'video', text: ' slow ', seconds: 5 }, () => 'new-id')
    expect(p).toEqual({ id: 'new-id', name: 'My look', tool: 'video', text: 'slow', seconds: 5 })
    const list = stylesFor('image', [own])
    expect(list[0]).toBe(own)
    expect(list.slice(1).every((x) => x.builtIn && x.tool === 'image')).toBe(true)
    expect(BUILT_IN_STYLES.some((x) => x.tool === 'video')).toBe(true)
  })
})

describe('the texts', () => {
  const walk = (value: unknown, out: string[]): string[] => {
    if (typeof value === 'string') out.push(value)
    else if (typeof value === 'function') {
      try {
        const r: unknown = (value as (...a: unknown[]) => unknown)('Name', 3, 2)
        if (typeof r === 'string') out.push(r)
      } catch {
        /* a text function with other arguments */
      }
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, out))
    else if (value && typeof value === 'object') Object.values(value).forEach((v) => walk(v, out))
    return out
  }
  const all = walk(T, [])

  it('are there', () => {
    expect(all.length).toBeGreaterThan(300)
  })

  it('have no long dash, no desktop verb and no desktop words', () => {
    const verb = new RegExp('\\bcl' + 'ick', 'i')
    for (const text of all) {
      expect(text, text).not.toMatch(/[‒-―]/)
      expect(text, text).not.toMatch(verb)
      expect(text, text).not.toMatch(/drag and drop|from disk|ComfyUI|folder/i)
    }
  })
})
