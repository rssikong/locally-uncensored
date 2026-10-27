import { describe, expect, it } from 'vitest'
import { chatResultMedia, resolveChatInputRef, resultMediaUrl } from '../chat-media-refs'

const call = (toolName: string, result: string, status = 'completed') => ({
  role: 'assistant',
  agentBlocks: [{ id: 'b', phase: 'tool_call' as const, content: '', timestamp: 1, toolCalls: [{ id: 'x', toolName, args: {}, status: status as 'completed', timestamp: 1, result }] }],
})
const pic = call('image_generate', 'Image generated: LU_1.png (prompt: "a")\nhttp://localhost:8188/view?filename=LU_1.png&subfolder=s&type=output')
const clip = call('video_generate', 'Video generated: LU_2.webp (prompt: "b")\nhttp://localhost:8188/view?filename=LU_2.webp&subfolder=&type=output')
const failed = call('image_generate', 'Image generation hit the 20 minute budget and was cancelled so the GPU is free again.')
const att = { role: 'user', images: [{ name: 'me.png', mimeType: 'image/png', data: 'AA' }] }

describe('what inputImage names in a chat (A13)', () => {
  it('lists only delivered media, by the file name its result starts with', () => {
    expect(chatResultMedia([pic, clip, failed]).map((m) => [m.kind, m.name])).toEqual([['image', 'LU_1.png'], ['video', 'LU_2.webp']])
  })

  it('reads the address from the last line only', () => {
    expect(resultMediaUrl('Image generated: a.png (prompt: "see http://localhost:8188/view?filename=q.png")\nhttp://localhost:8188/view?filename=a.png')).toBe('http://localhost:8188/view?filename=a.png')
    expect(resultMediaUrl('Image generation cancelled.')).toBeNull()
  })

  it('an earlier picture by name carries its full address', () => {
    const r = resolveChatInputRef('LU_1.png', [pic])
    expect(r).toMatchObject({ kind: 'result', media: { url: expect.stringContaining('subfolder=s') } })
  })

  it('an earlier clip is refused even where its name ends in .webp', () => {
    expect(resolveChatInputRef('LU_2.webp', [clip])).toMatchObject({ kind: 'error', error: expect.stringMatching(/video clip/) })
  })

  it('attachments by number and by name; an unknown name is left to ComfyUI', () => {
    expect(resolveChatInputRef('attachment 1', [att])).toMatchObject({ kind: 'attachment' })
    expect(resolveChatInputRef('me.png', [att])).toMatchObject({ kind: 'attachment' })
    expect(resolveChatInputRef('gallery_00042_.png', [att])).toEqual({ kind: 'unknown', name: 'gallery_00042_.png' })
    expect(resolveChatInputRef('attachment 4', [att])).toMatchObject({ kind: 'error', error: expect.stringContaining('attachment 1 ("me.png")') })
  })

  it('file addresses and absolute paths are paths', () => {
    expect(resolveChatInputRef('file:///Users/a/b%20c.png', [])).toEqual({ kind: 'path', path: '/Users/a/b c.png' })
    expect(resolveChatInputRef('/Users/a/x.png', [])).toEqual({ kind: 'path', path: '/Users/a/x.png' })
    expect(resolveChatInputRef('/comfyui/view?filename=x.png', [])).toEqual({ kind: 'url', url: '/comfyui/view?filename=x.png' })
  })
})
