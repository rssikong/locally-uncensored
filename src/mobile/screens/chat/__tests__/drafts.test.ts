import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_CHAT_IMAGES } from '../../../../lib/chat-image-input'
import { EMPTY_DRAFT, NEW_CHAT_KEY, roomFor, setPendingSend, takePendingSend, useDraftStore } from '../parts/logic/drafts'

const image = (name: string) => ({ data: 'AAAA', mimeType: 'image/png', name })
const draft = (chat: string) => useDraftStore.getState().drafts[chat] ?? EMPTY_DRAFT

beforeEach(() => useDraftStore.setState({ drafts: {} }))

describe('roomFor', () => {
  it('says how many still fit', () => {
    expect(roomFor(0, 3, 5)).toBe(3)
    expect(roomFor(4, 3, 5)).toBe(1)
    expect(roomFor(5, 3, 5)).toBe(0)
    expect(roomFor(9, 3, 5)).toBe(0)
  })
})

describe('draft store', () => {
  it('keeps a text per chat', () => {
    useDraftStore.getState().setText('a', 'hello')
    useDraftStore.getState().setText('b', 'other')
    expect(draft('a').text).toBe('hello')
    expect(draft('b').text).toBe('other')
  })
  it('takes images up to the limit and reports how many were taken', () => {
    const many = Array.from({ length: MAX_CHAT_IMAGES + 2 }, (_, i) => image(`p${i}.png`))
    expect(useDraftStore.getState().addImages('a', many)).toBe(MAX_CHAT_IMAGES)
    expect(draft('a').images).toHaveLength(MAX_CHAT_IMAGES)
    expect(useDraftStore.getState().addImages('a', [image('late.png')])).toBe(0)
    useDraftStore.getState().removeImage('a', 0)
    expect(draft('a').images[0].name).toBe('p1.png')
    expect(useDraftStore.getState().addImages('a', [image('late.png')])).toBe(1)
  })
  it('puts the typed text back when an edit is cancelled, also after a second edit began', () => {
    const s = useDraftStore.getState()
    s.setText('a', 'half typed')
    s.beginEdit('a', 'm1', 'old message')
    expect(draft('a')).toMatchObject({ editing: 'm1', text: 'old message', textBeforeEdit: 'half typed' })
    s.beginEdit('a', 'm2', 'another one')
    expect(draft('a')).toMatchObject({ editing: 'm2', text: 'another one', textBeforeEdit: 'half typed' })
    s.cancelEdit('a')
    expect(draft('a')).toMatchObject({ editing: null, text: 'half typed', textBeforeEdit: '' })
  })
  it('clears one chat and moves the draft of a new chat to its id', () => {
    const s = useDraftStore.getState()
    s.setText(NEW_CHAT_KEY, 'first words')
    s.setText('b', 'stay')
    s.move(NEW_CHAT_KEY, 'c1')
    expect(draft('c1').text).toBe('first words')
    expect(useDraftStore.getState().drafts[NEW_CHAT_KEY]).toBeUndefined()
    s.clear('c1')
    expect(useDraftStore.getState().drafts).toEqual({ b: { ...EMPTY_DRAFT, text: 'stay' } })
    s.move('nothing', 'x')
    expect(useDraftStore.getState().drafts.x).toBeUndefined()
  })
})

describe('a send that waits for its chat page', () => {
  it('is handed out once', () => {
    setPendingSend('c1', { text: 'hello' })
    expect(takePendingSend('c1')).toEqual({ text: 'hello' })
    expect(takePendingSend('c1')).toBeNull()
  })
})
