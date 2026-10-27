/**
 * @vitest-environment jsdom
 *
 * 3.0.8 A1 (.molot, thread "generation video", Windows, minimax-h3 through
 * ComfyUI): a clip made in the chat showed as a broken picture "Generated
 * image" with only the Download button working. The result line is right
 * (…/view?filename=…mp4), and the block did start with a <video>. But the
 * WebView's direct load is blocked by ComfyUI (403, the same block a picture
 * meets, see a-blocked-chat-picture-loads-through-the-app), the rescue swapped
 * in a blob: URL, and the element kind was read off THAT URL, which has no
 * filename. So the rescued clip went into an <img>.
 *
 * Run: npx vitest run src/components/chat/__tests__/a-chat-video-plays-in-the-chat.test.tsx
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AgentToolCall } from '../../../types/agent-mode'

const fetchLocalhostBytes = vi.fn(async (_url: string) => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]))
const tauri = vi.hoisted(() => ({ on: true }))
vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => tauri.on,
  fetchLocalhostBytes: (url: string) => fetchLocalhostBytes(url),
}))

const { ToolCallBlock } = await import('../ToolCallBlock')
const { MarkdownRenderer } = await import('../MarkdownRenderer')

// The exact shape from the report's screenshot.
const FILE = 'una_lavadora_moderna_funcionando_girando_suaveme__vid_5wlyfv_00001_.mp4'
const VIEW = `http://localhost:8188/view?filename=${FILE}&subfolder=&type=output`
const call = (url: string): AgentToolCall => ({
  id: 'v1', toolName: 'video_generate', args: { prompt: 'una lavadora moderna funcionando', model: 'minimax-h3', seconds: 2 },
  status: 'completed', timestamp: 1,
  result: `Video generated: ${FILE} (prompt: "una lavadora moderna funcionando")\n${url}`,
} as AgentToolCall)

let made = 0
const blobs: Blob[] = []
beforeEach(() => {
  fetchLocalhostBytes.mockClear()
  tauri.on = true
  made = 0
  blobs.length = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: (b: Blob) => { blobs.push(b); return `blob:lu/${++made}` },
    revokeObjectURL: () => {},
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const video = () => document.querySelector('video') as HTMLVideoElement

describe('a clip made in the chat plays in the chat', () => {
  it('an mp4 result renders as a <video> with controls, not a picture', () => {
    const { container } = render(createElement(ToolCallBlock, { toolCall: call(VIEW) }))
    expect(video().tagName).toBe('VIDEO')
    expect(video().getAttribute('src')).toBe(VIEW)
    expect(video().hasAttribute('controls')).toBe(true)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByAltText('Generated image')).toBeNull()
    expect(screen.getByTitle('Download')).toBeTruthy()
  })

  it('THE REPORT: after the blocked direct load, the rescued clip is still a <video>', async () => {
    const { container } = render(createElement(ToolCallBlock, { toolCall: call(VIEW) }))
    fireEvent.error(video())
    await waitFor(() => expect(video().getAttribute('src')).toMatch(/^blob:/))
    expect(fetchLocalhostBytes).toHaveBeenCalledWith(VIEW)
    expect(blobs[0]?.type).toBe('video/mp4')
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByAltText('Generated image')).toBeNull()
    expect(screen.getByTitle('Download')).toBeTruthy()
  })

  it('a reopened chat (the stored result line) shows the same player', () => {
    // A reload hands the block nothing but the stored result string.
    const stored = JSON.parse(JSON.stringify(call(VIEW))) as AgentToolCall
    render(createElement(ToolCallBlock, { toolCall: stored }))
    expect(video().getAttribute('src')).toBe(VIEW)
  })

  it('a .webm clip plays too, an animated .webp stays a picture', () => {
    render(createElement(ToolCallBlock, { toolCall: call(VIEW.replace('.mp4', '.webm')) }))
    expect(video()).toBeTruthy()
    cleanup()
    render(createElement(ToolCallBlock, { toolCall: call(VIEW.replace('.mp4', '.webp')) }))
    expect(document.querySelector('video')).toBeNull()
    expect(screen.getByAltText('Generated image')).toBeTruthy()
  })

  it('the clip the model links again in its reply plays, and is rescued the same way', async () => {
    const { container } = render(createElement(MarkdownRenderer, { content: `Aquí está: ![clip](${VIEW})` }))
    const v = container.querySelector('video') as HTMLVideoElement
    expect(v).toBeTruthy()
    expect(v.getAttribute('src')).toBe(VIEW)
    expect(container.querySelector('img')).toBeNull()
    fireEvent.error(v)
    await waitFor(() => expect((container.querySelector('video') as HTMLVideoElement).getAttribute('src')).toMatch(/^blob:/))
  })
})

// David's box run (3.0.8 A1, 20.10.2026): the clip showed, LU was closed and
// started again, and the same chat showed a broken "Generated image". The chat
// keeps only the /view address (filename, subfolder, type), which is right. But
// on reopening, ComfyUI was not up yet: the direct load and the one proxy try
// both failed, and nothing ever asked again although the file was on disk.
describe('a chat reopened after the app restarts', () => {
  const restartedCall = (url: string): AgentToolCall => JSON.parse(JSON.stringify(call(url))) as AgentToolCall

  it('THE REPORT: keeps asking until ComfyUI is up, then plays the clip', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let up = false
      fetchLocalhostBytes.mockImplementation(async () => {
        if (!up) throw new Error('connection refused')
        return new Uint8Array([0, 0, 0, 24])
      })
      const { container } = render(createElement(ToolCallBlock, { toolCall: restartedCall(VIEW) }))
      fireEvent.error(video())
      // ComfyUI is still starting: a calm line, no broken frame, no <img>.
      await waitFor(() => expect(screen.getByTestId('tool-media-waiting')).toBeTruthy())
      expect(container.querySelector('img')).toBeNull()
      await vi.advanceTimersByTimeAsync(3500)
      expect(fetchLocalhostBytes.mock.calls.length).toBeGreaterThanOrEqual(3)
      up = true
      await vi.advanceTimersByTimeAsync(5000)
      await waitFor(() => expect(video().getAttribute('src')).toMatch(/^blob:/))
      expect(screen.queryByTestId('tool-media-waiting')).toBeNull()
      expect(blobs.at(-1)?.type).toBe('video/mp4')
      expect(screen.getByTitle('Download')).toBeTruthy()
    } finally {
      vi.useRealTimers()
      fetchLocalhostBytes.mockImplementation(async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]))
    }
  })

  it('a picture made before the restart comes back the same way', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      let up = false
      fetchLocalhostBytes.mockImplementation(async () => {
        if (!up) throw new Error('connection refused')
        return new Uint8Array([137, 80, 78, 71])
      })
      const PIC = VIEW.replace('.mp4', '.webp')
      render(createElement(ToolCallBlock, { toolCall: restartedCall(PIC) }))
      fireEvent.error(screen.getByAltText('Generated image'))
      await waitFor(() => expect(screen.getByTestId('tool-media-waiting')).toBeTruthy())
      up = true
      await vi.advanceTimersByTimeAsync(4000)
      await waitFor(() => expect((screen.getByAltText('Generated image') as HTMLImageElement).getAttribute('src')).toMatch(/^blob:/))
    } finally {
      vi.useRealTimers()
      fetchLocalhostBytes.mockImplementation(async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]))
    }
  })

  it('stops asking after about ten minutes and never loops on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      fetchLocalhostBytes.mockImplementation(async () => { throw new Error('gone') })
      render(createElement(ToolCallBlock, { toolCall: restartedCall(VIEW) }))
      fireEvent.error(video())
      await vi.advanceTimersByTimeAsync(15 * 60_000)
      const calls = fetchLocalhostBytes.mock.calls.length
      await vi.advanceTimersByTimeAsync(15 * 60_000)
      expect(fetchLocalhostBytes.mock.calls.length).toBe(calls)
      expect(calls).toBeLessThan(30)
      expect(screen.queryByTestId('tool-media-waiting')).toBeNull()
    } finally {
      vi.useRealTimers()
      fetchLocalhostBytes.mockImplementation(async () => new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]))
    }
  })
})
