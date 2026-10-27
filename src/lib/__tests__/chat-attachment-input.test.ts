import { describe, it, expect } from 'vitest'
import { BLIND_MODEL_NOTICE, blindModelNotice, chatImageAttachments, imageAttachmentNote, parseAttachmentNumber, pickAttachment, stagedAttachmentName } from '../chat-attachment-input'

const img = (name: string) => ({ name, mimeType: 'image/png', data: 'AAAA' })

describe('chat image attachments by number (A12)', () => {
  const messages = [
    { role: 'user', content: 'a', images: [img('cat.png')] },
    { role: 'assistant', content: 'b', images: [img('not-user.png')] },
    { role: 'user', content: 'c', images: [img('image.png'), img('image.png')] },
  ]

  it('counts the user\'s pictures over the whole chat', () => {
    expect(chatImageAttachments(messages).map((e) => `${e.number}:${e.name}`)).toEqual(['1:cat.png', '2:image.png', '3:image.png'])
  })

  it('tells the model the number to pass, not a filename', () => {
    const note = imageAttachmentNote([img('image.png')], 2)
    expect(note).toContain('attachment 2 ("image.png")')
    expect(note).toContain('inputImage "attachment 2"')
    expect(imageAttachmentNote([], 1)).toBe('')
  })

  it('reads the ways a model writes the number', () => {
    for (const s of ['attachment 1', 'Attachment #1', 'attachment:1', 'att 1', 'Anhang 1', ' attachment1 ']) {
      expect(parseAttachmentNumber(s)).toBe(1)
    }
    for (const s of ['attachment 0', 'image.png', 'attachment', 'LU_00001_.png']) {
      expect(parseAttachmentNumber(s)).toBeNull()
    }
  })

  it('picks by number, by the newest of a filename, or not at all', () => {
    const all = chatImageAttachments(messages)
    expect(pickAttachment('attachment 1', all)).toMatchObject({ entry: { number: 1 } })
    expect(pickAttachment('C:\\Users\\x\\IMAGE.PNG', all)).toMatchObject({ entry: { number: 3 } })
    expect(pickAttachment('LU_00001_.png', all)).toBeNull()
    expect(pickAttachment('attachment 4', all)).toMatchObject({ error: expect.stringContaining('3 attached images') })
    expect(pickAttachment('attachment 1', [])).toMatchObject({ error: expect.stringContaining('No image is attached') })
  })

  it('names the upload so two chats do not overwrite each other', () => {
    const [e] = chatImageAttachments(messages)
    expect(stagedAttachmentName(e, 'abcdef0123456789')).toBe('lu-chat-abcdef012345-cat.png')
    expect(stagedAttachmentName({ ...e, name: 'my photo (1).jpg' }, 'x')).toBe('lu-chat-x-my_photo_1_.jpg')
  })

  it('does not send a customer away from an edit that works', () => {
    expect(blindModelNotice(false)).toBe(BLIND_MODEL_NOTICE)
    expect(blindModelNotice(true)).toContain('image or video generation')
    expect(blindModelNotice(true)).toContain('vision model')
  })
})
