/**
 * @vitest-environment jsdom
 *
 * Discord, thread "I can't launch Wan2.2" (15.10.2026, Windows, ComfyUI
 * Desktop): an image made in the chat showed as a broken picture, and its link
 * pointed at localhost. The desktop result carries an absolute
 * http://localhost:<port>/view URL, and a current ComfyUI answers the WebView's
 * cross-origin <img> load for it with a 403 (Sec-Fetch-Site), the same block
 * the Create gallery hit in #75. Create has fetched the bytes through the app's
 * own localhost proxy on that error ever since (useComfyMedia,
 * proxiedComfyBlobUrl). The chat retried only a RELATIVE /comfyui/view path,
 * which a desktop result never is, so on the desktop it stayed broken.
 *
 * Run: npx vitest run src/components/chat/__tests__/a-blocked-chat-picture-loads-through-the-app.test.tsx
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { createElement } from 'react'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import type { AgentToolCall } from '../../../types/agent-mode'

const fetchLocalhostBytes = vi.fn(async (_url: string) => new Uint8Array([137, 80, 78, 71]))
const tauri = vi.hoisted(() => ({ on: true }))
vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  isTauri: () => tauri.on,
  fetchLocalhostBytes: (url: string) => fetchLocalhostBytes(url),
}))

const { ToolCallBlock } = await import('../ToolCallBlock')
const { MarkdownRenderer } = await import('../MarkdownRenderer')

const VIEW = 'http://localhost:8188/view?filename=LU_00001_.png&subfolder=&type=output'
const call = (result: string): AgentToolCall => ({
  id: 't1', toolName: 'image_generate', args: { prompt: 'a cat' }, status: 'completed', timestamp: 1,
  result: `Image generated: LU_00001_.png (prompt: "a cat")\n${result}`,
} as AgentToolCall)

let made = 0
beforeEach(() => {
  fetchLocalhostBytes.mockClear()
  tauri.on = true
  made = 0
  vi.stubGlobal('URL', Object.assign(URL, {
    createObjectURL: () => `blob:lu/${++made}`,
    revokeObjectURL: () => {},
  }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('a chat picture the WebView may not load directly', () => {
  it('THE REPORT: after the direct load fails, the picture comes through the app', async () => {
    render(createElement(ToolCallBlock, { toolCall: call(VIEW) }))
    const img = screen.getByAltText('Generated image') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(VIEW)
    fireEvent.error(img)
    await waitFor(() => expect((screen.getByAltText('Generated image') as HTMLImageElement).getAttribute('src')).toMatch(/^blob:/))
    expect(fetchLocalhostBytes).toHaveBeenCalledWith(VIEW)
  })

  it('the link beside it is not the dead localhost address any more either', async () => {
    render(createElement(ToolCallBlock, { toolCall: call(VIEW) }))
    fireEvent.error(screen.getByAltText('Generated image'))
    await waitFor(() => expect(screen.getByAltText('Generated image').closest('a')?.getAttribute('href')).toMatch(/^blob:/))
  })

  it('the Download button stays after the rescue', async () => {
    render(createElement(ToolCallBlock, { toolCall: call(VIEW) }))
    fireEvent.error(screen.getByAltText('Generated image'))
    await waitFor(() => expect((screen.getByAltText('Generated image') as HTMLImageElement).getAttribute('src')).toMatch(/^blob:/))
    expect(screen.getByTitle('Download')).toBeTruthy()
  })

  it('a picture that loads directly is never fetched a second time', () => {
    render(createElement(ToolCallBlock, { toolCall: call(VIEW) }))
    fireEvent.load(screen.getByAltText('Generated image'))
    expect(fetchLocalhostBytes).not.toHaveBeenCalled()
  })

  it('the web build keeps its own retry on the ComfyUI host', async () => {
    tauri.on = false
    render(createElement(ToolCallBlock, { toolCall: call('/comfyui/view?filename=LU_00001_.png&subfolder=&type=output') }))
    fireEvent.error(screen.getByAltText('Generated image'))
    await waitFor(() => expect((screen.getByAltText('Generated image') as HTMLImageElement).getAttribute('src')).toBe(VIEW))
    expect(fetchLocalhostBytes).not.toHaveBeenCalled()
  })

  it('the same address repeated by the model in its reply is rescued too', async () => {
    render(createElement(MarkdownRenderer, { content: `Here it is: ![cat](${VIEW})` }))
    const img = screen.getByAltText('cat') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(VIEW)
    fireEvent.error(img)
    await waitFor(() => expect((screen.getByAltText('cat') as HTMLImageElement).getAttribute('src')).toMatch(/^blob:/))
  })

  it('a picture from any other trusted host is never sent through the proxy', () => {
    render(createElement(MarkdownRenderer, { content: '![x](https://raw.githubusercontent.com/a/b/c.png)' }))
    fireEvent.error(screen.getByAltText('x'))
    expect(fetchLocalhostBytes).not.toHaveBeenCalled()
  })
})
