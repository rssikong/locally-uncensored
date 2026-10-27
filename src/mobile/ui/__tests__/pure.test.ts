/** The decisions inside the base components that need no DOM. */
import { describe, expect, it } from 'vitest'
import { fieldHeightCap } from '../field-in-view'
import { CRAMPED_BELOW_UNITS, TIGHT_BELOW_UNITS, roomOf } from '../room'
import { trapTarget } from '../focus'
import { composerSlot } from '../Composer'
import { stepValue } from '../Slider'
import { ZOOM_MAX, pinchZoom } from '../MediaViewer'

describe('trapTarget', () => {
  const items = ['a', 'b', 'c']

  it('wraps at both ends', () => {
    expect(trapTarget(items, 'c', false)).toBe('a')
    expect(trapTarget(items, 'a', true)).toBe('c')
  })

  it('lets the browser move inside the trap', () => {
    expect(trapTarget(items, 'b', false)).toBeNull()
    expect(trapTarget(items, 'b', true)).toBeNull()
  })

  it('pulls the focus in when it is outside', () => {
    expect(trapTarget(items, null, false)).toBe('a')
    expect(trapTarget(items, 'x', true)).toBe('c')
  })

  it('has nothing to offer in an empty trap', () => {
    expect(trapTarget([], null, false)).toBeNull()
  })
})

describe('composerSlot', () => {
  it('empty field shows the microphone, text shows Send, a running answer shows Stop', () => {
    expect(composerSlot({ text: '', canDictate: true })).toBe('mic')
    expect(composerSlot({ text: '  ', canDictate: true })).toBe('mic')
    expect(composerSlot({ text: 'hi', canDictate: true })).toBe('send')
    expect(composerSlot({ text: '', hasAttachment: true, canDictate: true })).toBe('send')
    expect(composerSlot({ text: 'hi', running: true, canDictate: true })).toBe('stop')
  })

  it('while a dictation goes the slot stays the microphone, also over text already typed (r48)', () => {
    expect(composerSlot({ text: '', canDictate: true, dictation: 'recording' })).toBe('mic')
    expect(composerSlot({ text: 'hi', canDictate: true, dictation: 'recording' })).toBe('mic')
    expect(composerSlot({ text: 'hi', canDictate: true, dictation: 'transcribing' })).toBe('mic')
    expect(composerSlot({ text: '', hasAttachment: true, canDictate: true, dictation: 'transcribing' })).toBe('mic')
    expect(composerSlot({ text: 'hi', running: true, canDictate: true, dictation: 'recording' })).toBe('stop')
  })

  it('without dictation the slot is Send from the start', () => {
    expect(composerSlot({ text: '', canDictate: false })).toBe('send')
  })
})

describe('stepValue', () => {
  it('steps without float dust', () => {
    expect(stepValue(0.1, 1, 0, 2, 0.1)).toBe(0.2)
    expect(stepValue(0.2, 1, 0, 2, 0.1)).toBe(0.3)
    expect(stepValue(0.7, -1, 0, 2, 0.1)).toBe(0.6)
  })

  it('stays inside min and max', () => {
    expect(stepValue(8, 1, 1, 8, 1)).toBe(8)
    expect(stepValue(1, -1, 1, 8, 1)).toBe(1)
  })
})

describe('pinchZoom', () => {
  it('follows the fingers and stays between 1 and the maximum', () => {
    expect(pinchZoom(1, 100, 200)).toBe(2)
    expect(pinchZoom(2, 100, 10)).toBe(1)
    expect(pinchZoom(2, 100, 1000)).toBe(ZOOM_MAX)
    expect(pinchZoom(2, 0, 100)).toBe(2)
  })
})

// ---- Runde 2: what the kit decides without a DOM ----
import { riskProps } from '../common'
import { bannerActions } from '../Notice'
import { TOAST_LARGE_TEXT_MS, TOAST_MAX_MS, TOAST_MS, toastDuration } from '../Toast'
import { segmentsFit } from '../Segmented'
import { splitMiddle } from '../MiddleEllipsis'
import { parseNumberInput } from '../Slider'
import { screenShape } from '../screen-shape'
import { hyphenParts, hyphenPoints } from '../hyphenate'
import { HIGHLIGHT_MAX_CHARS, highlightLanguage, shouldHighlight } from '../highlight'
import { PERMISSION_LEVELS, permissionOptions } from '../PermissionRow'
import { pageControlId, sheetControlId } from '../../nav/context'
import { sheetMarks, slidesIn } from '../Sheet'

describe('riskProps', () => {
  it('writes data-m-risk only when there is a risk', () => {
    expect(riskProps('paid')).toEqual({ 'data-m-risk': 'paid' })
    expect(riskProps('destructive')).toEqual({ 'data-m-risk': 'destructive' })
    expect(riskProps(undefined)).toEqual({})
    expect(riskProps(null)).toEqual({})
  })
})

describe('bannerActions', () => {
  const a = { label: 'Open chat', onPress: () => {} }
  const b = { label: 'Dismiss', onPress: () => {} }
  const c = { label: 'Third', onPress: () => {} }

  it('draws the single action first and never more than two', () => {
    expect(bannerActions(undefined, undefined)).toEqual([])
    expect(bannerActions(a, undefined)).toEqual([a])
    expect(bannerActions(undefined, [a, b])).toEqual([a, b])
    expect(bannerActions(a, [b, c])).toEqual([a, b])
    expect(bannerActions(undefined, [a, b, c])).toEqual([a, b])
  })
})

describe('toastDuration', () => {
  it('a plain note leaves sooner when the text is large', () => {
    expect(toastDuration({}, 1)).toBe(TOAST_MS)
    expect(toastDuration({}, 1.3)).toBe(TOAST_MS)
    expect(toastDuration({}, 1.5)).toBe(TOAST_LARGE_TEXT_MS)
    expect(toastDuration({}, 2)).toBe(TOAST_LARGE_TEXT_MS)
    expect(TOAST_LARGE_TEXT_MS).toBeLessThan(TOAST_MS)
  })

  it('a sentence stays as long as it takes to read, at every text size', () => {
    const sentence = 'Thinking is off for this chat now. The answer is written again without it.'
    expect(toastDuration({ text: sentence }, 2)).toBeGreaterThan(TOAST_MS)
    expect(toastDuration({ text: sentence }, 1)).toBe(toastDuration({ text: sentence }, 2))
    expect(toastDuration({ text: 'Copied' }, 2)).toBe(TOAST_LARGE_TEXT_MS)
    expect(toastDuration({ text: 'x'.repeat(2000) }, 1)).toBe(TOAST_MAX_MS)
  })

  it('an error and a toast with a button keep the full time at every text size', () => {
    expect(toastDuration({ tone: 'error' }, 2)).toBe(TOAST_MS)
    expect(toastDuration({ action: { label: 'Undo', onPress: () => {} } }, 2)).toBe(TOAST_MS)
  })
})

describe('segmentsFit', () => {
  it('three short labels fit a phone, the same labels at twice the size do not fit a small one', () => {
    // Draft, Standard, High quality at 15 px and at 30 px.
    expect(segmentsFit([36, 64, 84], 358)).toBe(true)
    expect(segmentsFit([72, 128, 168], 288)).toBe(false)
  })

  it('counts the padding, the gaps and the 44 px every option needs', () => {
    // Three options of 44 px, two gaps of 2 px, 6 px padding of the group: 142.
    expect(segmentsFit([10, 10, 10], 142)).toBe(true)
    expect(segmentsFit([10, 10, 10], 141)).toBe(false)
    // A label of 40 px needs 56 px with its padding.
    expect(segmentsFit([40, 40], 120)).toBe(true)
    expect(segmentsFit([40, 40], 119)).toBe(false)
  })

  it('has nothing to say before it is measured', () => {
    expect(segmentsFit([], 100)).toBe(true)
    expect(segmentsFit([500], 0)).toBe(true)
  })
})

describe('splitMiddle', () => {
  it('keeps the ending and the last letters of the name', () => {
    expect(splitMiddle('beach-holiday-lisbon.png')).toEqual({ head: 'beach-holiday-lis', tail: 'bon.png' })
    expect(splitMiddle('quarterly report (2).pdf')).toEqual({ head: 'quarterly report ', tail: '(2).pdf' })
    expect(splitMiddle('recording-2026-10-08.jpeg')).toEqual({ head: 'recording-2026-10', tail: '-08.jpeg' })
  })

  it('a short name is never split', () => {
    expect(splitMiddle('beach.png')).toEqual({ head: 'beach.png', tail: '' })
    expect(splitMiddle('')).toEqual({ head: '', tail: '' })
  })

  it('a name without an ending keeps its last letters, a long ending does not count as one', () => {
    expect(splitMiddle('a title without any ending')).toEqual({ head: 'a title without any ', tail: 'ending' })
    expect(splitMiddle('model-q4-k-m.safetensors')).toEqual({ head: 'model-q4-k-m.safet', tail: 'ensors' })
    expect(splitMiddle('.a-hidden-file-name')).toEqual({ head: '.a-hidden-fil', tail: 'e-name' })
  })

  it('head and tail always give the whole name back', () => {
    for (const name of ['beach-holiday-lisbon.png', 'x'.repeat(40), 'a.b.c.d.e.f.g.h.txt', 'no ending at all here']) {
      const { head, tail } = splitMiddle(name)
      expect(head + tail).toBe(name)
      expect(head.length).toBeGreaterThan(0)
    }
  })
})

describe('parseNumberInput', () => {
  it('is nothing while the field holds no number yet', () => {
    expect(parseNumberInput('', 1, 8, true)).toBeNull()
    expect(parseNumberInput('-', -5, 8, true)).toBeNull()
    expect(parseNumberInput('abc', 1, 8, false)).toBeNull()
  })

  it('holds the number inside min and max', () => {
    expect(parseNumberInput('99', 1, 8, true)).toBe(8)
    expect(parseNumberInput('0', 1, 8, true)).toBe(1)
    expect(parseNumberInput('4', 1, 8, true)).toBe(4)
  })

  it('rounds for whole numbers and keeps the fraction otherwise, with a comma as well', () => {
    expect(parseNumberInput('4.6', 1, 8, true)).toBe(5)
    expect(parseNumberInput('0.7', 0, 2, false)).toBe(0.7)
    expect(parseNumberInput('0,7', 0, 2, false)).toBe(0.7)
  })
})

describe('screenShape', () => {
  it('a phone upright is tall, on its side wide', () => {
    expect(screenShape(390, 844, 16)).toBe('tall')
    expect(screenShape(844, 390, 16)).toBe('wide')
  })

  it('large text on a small phone leaves no room for a fixed footer', () => {
    expect(screenShape(320, 568, 16)).toBe('tall')
    expect(screenShape(320, 568, 32)).toBe('low')
    expect(screenShape(568, 320, 32)).toBe('low')
  })

  it('a text size of nothing counts as 16 px', () => {
    expect(screenShape(390, 844, 0)).toBe('tall')
  })
})

describe('hyphenPoints', () => {
  const cut = (word: string) => hyphenParts(word).join('-')

  it('breaks the long words of the app between syllables', () => {
    expect(cut('Troubleshooting')).toBe('Trou-ble-shoot-ing')
    expect(cut('Notifications')).toBe('Notifica-tions')
    expect(cut('Permissions')).toBe('Per-mis-sions')
    expect(cut('Conversations')).toBe('Con-ver-sa-tions')
    expect(cut('Authentication')).toBe('Authen-tica-tion')
    expect(cut('Recommendations')).toBe('Recom-men-da-tions')
    expect(cut('Accessibility')).toBe('Acces-sibil-ity')
  })

  it('leaves short words, names with digits and anything that is not a plain word alone', () => {
    expect(hyphenPoints('Appearance')).toEqual([])
    expect(hyphenPoints('Settings')).toEqual([])
    expect(hyphenPoints('DeepSeek-R1-Distill')).toEqual([])
    expect(hyphenPoints('192.168.0.12:11435')).toEqual([])
    expect(hyphenPoints('')).toEqual([])
  })

  it('keeps at least three letters at both ends and gives the whole word back', () => {
    for (const word of ['Troubleshooting', 'Uncategorized', 'Acknowledgements', 'Characteristics', 'Synchronization', 'Personalization', 'Subscriptions', 'Internationalisation']) {
      const parts = hyphenParts(word)
      expect(parts.join(''), word).toBe(word)
      expect(parts[0].length, word).toBeGreaterThanOrEqual(3)
      expect(parts[parts.length - 1].length, word).toBeGreaterThanOrEqual(3)
      for (const part of parts) expect(part.length, `${word}: ${parts.join('-')}`).toBeGreaterThanOrEqual(2)
    }
  })

  it('does not split what ends or starts a syllable together', () => {
    expect(cut('Acknowledgements')).toBe('Acknow-ledge-ments')
    expect(cut('Subscriptions')).toBe('Subscrip-tions')
  })
})

describe('highlightLanguage', () => {
  it('maps what a fence may say to a grammar', () => {
    expect(highlightLanguage('ts')).toBe('typescript')
    expect(highlightLanguage('TypeScript')).toBe('typescript')
    expect(highlightLanguage('html')).toBe('markup')
    expect(highlightLanguage('sh')).toBe('bash')
    expect(highlightLanguage('py')).toBe('python')
    expect(highlightLanguage('c++')).toBe('cpp')
  })

  it('an unknown or missing language stays plain, and so does a very long block', () => {
    expect(highlightLanguage('brainfuck')).toBeNull()
    expect(highlightLanguage(undefined)).toBeNull()
    expect(highlightLanguage('  ')).toBeNull()
    expect(shouldHighlight('ts', 'const a = 1')).toBe(true)
    expect(shouldHighlight('ts', '')).toBe(false)
    expect(shouldHighlight('ts', 'x'.repeat(HIGHLIGHT_MAX_CHARS + 1))).toBe(false)
    expect(shouldHighlight(undefined, 'const a = 1')).toBe(false)
  })
})

describe('permissionOptions', () => {
  it('the three levels carry the values of the logic and their own test ids', () => {
    expect(PERMISSION_LEVELS.map((l) => l.value)).toEqual(['blocked', 'confirm', 'auto'])
    expect(PERMISSION_LEVELS.map((l) => l.label)).toEqual(['Blocked', 'Ask', 'Auto'])
    expect(permissionOptions(PERMISSION_LEVELS, 'm-perm-web').map((o) => o.testid)).toEqual(['m-perm-web-blocked', 'm-perm-web-confirm', 'm-perm-web-auto'])
    expect(permissionOptions(PERMISSION_LEVELS, undefined).map((o) => o.testid)).toEqual([undefined, undefined, undefined])
  })
})

describe('ids of Back and Close', () => {
  it('the bare id belongs to the page on top, the page below and the one leaving carry a suffix', () => {
    expect(pageControlId('m-page-back', 'top')).toBe('m-page-back')
    expect(pageControlId('m-page-back', undefined)).toBe('m-page-back')
    expect(pageControlId('m-page-back', 'under')).toBe('m-page-back-under')
    expect(pageControlId('m-page-back', 'leaving')).toBe('m-page-back-leaving')
  })

  it('the bare id belongs to the top sheet, a sheet below says how far below', () => {
    expect(sheetControlId('m-sheet-close', 0)).toBe('m-sheet-close')
    expect(sheetControlId('m-sheet-close', undefined)).toBe('m-sheet-close')
    expect(sheetControlId('m-sheet-close', 1)).toBe('m-sheet-close-under-1')
    expect(sheetControlId('m-sheet-back', 2)).toBe('m-sheet-back-under-2')
  })
})

describe('sheetMarks', () => {
  it('every sheet is found as m-sheet-<id>', () => {
    expect(sheetMarks('model', undefined)).toEqual({ sheet: 'm-sheet-model', frame: undefined })
    expect(sheetMarks('model', 'm-sheet-model')).toEqual({ sheet: 'm-sheet-model', frame: undefined })
  })
  it('a test id of its own stays as a second mark, on the frame around the sheet', () => {
    expect(sheetMarks('chat-options', 'm-options')).toEqual({ sheet: 'm-sheet-chat-options', frame: 'm-options' })
  })
  it('outside the navigation the own id is all there is', () => {
    expect(sheetMarks(undefined, 'm-own')).toEqual({ sheet: 'm-own', frame: undefined })
  })
})

describe('slidesIn', () => {
  it('a sheet with a real animation is on its way in', () => {
    expect(slidesIn('m-sheet-up', '0.3s')).toBe(true)
    expect(slidesIn('m-fade', '120ms')).toBe(true)
  })
  it('without an animation it has arrived at once', () => {
    expect(slidesIn('none', '0s')).toBe(false)
    expect(slidesIn('', '')).toBe(false)
    expect(slidesIn(undefined, undefined)).toBe(false)
    expect(slidesIn('m-sheet-up', '0s')).toBe(false)
  })
})

describe('room: how much of the screen is visible, in text units (M5, M6)', () => {
  it('a current phone with the keyboard closed or open has room', () => {
    expect(roomOf(844, 16)).toBe('ok')
    expect(roomOf(508, 16)).toBe('ok')
  })
  it('the small iPhone with the keyboard open, a phone on its side and very large text are tight', () => {
    expect(roomOf(407, 16)).toBe('tight')
    expect(roomOf(375, 16)).toBe('tight')
    expect(roomOf(667, 32)).toBe('tight')
  })
  it('on its side with the keyboard, and the largest text with the keyboard, are cramped', () => {
    expect(roomOf(212, 16)).toBe('cramped')
    expect(roomOf(407, 32)).toBe('cramped')
  })
  it('the limits are counted in text units and a missing measure changes nothing', () => {
    expect(roomOf(TIGHT_BELOW_UNITS * 16, 16)).toBe('ok')
    expect(roomOf(TIGHT_BELOW_UNITS * 16 - 1, 16)).toBe('tight')
    expect(roomOf(CRAMPED_BELOW_UNITS * 20, 20)).toBe('tight')
    expect(roomOf(CRAMPED_BELOW_UNITS * 20 - 1, 20)).toBe('cramped')
    expect(roomOf(0, 16)).toBe('ok')
    expect(roomOf(400, 0)).toBe('tight')
  })
})

describe('fieldHeightCap: a field of several lines is never higher than its room (acceptance Android, N8)', () => {
  // A persona field: twelve rows of 23 px, a frame of 26 px, label and hint 50 px more.
  const tall = { natural: 278, around: 76, frame: 26, line: 23.2 }
  it('a field that fits keeps its height', () => {
    expect(fieldHeightCap({ room: 500, ...tall })).toBeNull()
    expect(fieldHeightCap({ room: 278 + 76 + 24, ...tall })).toBeNull()
  })
  it('one pixel short and it is capped, with label and hint still in the room', () => {
    const room = 278 + 76 + 24 - 1
    expect(fieldHeightCap({ room, ...tall })).toBe(277)
    const cap = fieldHeightCap({ room: 240, ...tall })!
    expect(cap).toBe(240 - 24 - 76)
    expect(cap + tall.around + 24).toBeLessThanOrEqual(240)
  })
  it('when label and hint leave less than two lines, the field with its frame alone has to fit', () => {
    // On its side with the keyboard open: about 127 px between header and keyboard.
    const cap = fieldHeightCap({ room: 127, ...tall })!
    expect(cap).toBe(127 - 24 - 26)
    expect(cap + tall.frame).toBeLessThanOrEqual(127)
    expect(cap).toBeGreaterThanOrEqual(2 * 23)
  })
  it('in a room too low for a line with a margin the margin gives way (a sheet above the keyboard of a phone on its side)', () => {
    // 61 px of sheet body: 61 - 24 - 26 = 11 is no line, 61 - 26 = 35 is one.
    const cap = fieldHeightCap({ room: 61, ...tall })!
    expect(cap).toBe(35)
    expect(cap + tall.frame).toBeLessThanOrEqual(61)
  })
  it('never under one line, and never higher than the field wants to be', () => {
    expect(fieldHeightCap({ room: 40, ...tall })).toBe(24)
    expect(fieldHeightCap({ room: 150, natural: 70, around: 120, frame: 26, line: 23.2 })).toBe(70)
  })
  it('without a measure nothing is capped', () => {
    expect(fieldHeightCap({ room: 0, ...tall })).toBeNull()
    expect(fieldHeightCap({ room: 100, natural: 0, around: 0, frame: 0, line: 20 })).toBeNull()
  })
})
