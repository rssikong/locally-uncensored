import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../platform', () => ({ copyText: vi.fn(), isNativeUnavailable: () => false, nativeBridge: async () => null, saveToDevice: vi.fn(), shareFile: vi.fn(), shareText: vi.fn() }))

import { chatsInBackup } from '../parts/adapters/backup-found'
import { estimateTokens } from '../parts/adapters/generation-speed'
import { exportFileName } from '../parts/adapters/handover'
import { imageFileName, isTextMime } from '../parts/file-source'

describe('estimateTokens', () => {
  it('takes about four characters for one token', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('  abcd  ')).toBe(1)
    expect(estimateTokens('a'.repeat(401))).toBe(101)
  })
})

describe('chatsInBackup', () => {
  const backup = (conversations: unknown) => JSON.stringify({ 'chat-conversations': JSON.stringify({ state: { conversations } }) })
  it('counts the chats of a backup', () => {
    expect(chatsInBackup(backup([{ id: 'a' }, { id: 'b' }]))).toBe(2)
    expect(chatsInBackup(JSON.stringify({ 'chat-conversations': { state: { conversations: [{}] } } }))).toBe(1)
  })
  it('counts none for anything it cannot read', () => {
    for (const raw of [null, undefined, '', 'not json', '[]', '{}', backup('x'), JSON.stringify({ 'chat-conversations': '{broken' })]) expect(chatsInBackup(raw)).toBe(0)
  })
})

describe('exportFileName', () => {
  it('is a name every share target takes', () => {
    expect(exportFileName('Trip to Rome: day 1/2', 'markdown')).toBe('Trip_to_Rome_day_1_2.md')
    expect(exportFileName('???', 'json')).toBe('chat.json')
    expect(exportFileName('x'.repeat(80), 'json')).toBe(`${'x'.repeat(50)}.json`)
  })
})

describe('file helpers', () => {
  it('know what reads as text', () => {
    expect(isTextMime('text/plain', 'a')).toBe(true)
    expect(isTextMime('application/json', 'a')).toBe(true)
    expect(isTextMime('', 'notes.MD')).toBe(true)
    expect(isTextMime('application/pdf', 'paper.pdf')).toBe(false)
  })
  it('give an image a name with an extension', () => {
    expect(imageFileName('photo', 'image/jpeg')).toBe('photo.jpg')
    expect(imageFileName('scan.png', 'image/png')).toBe('scan.png')
    expect(imageFileName(undefined, 'image/webp')).toBe('image.webp')
    expect(imageFileName('', '')).toBe('image.png')
  })
})
