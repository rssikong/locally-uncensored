// @vitest-environment jsdom
/**
 * The result view of the phone shows the prompt of a result the way the
 * desktop does: only the text that ran (`ranPrompt`), with Copy.
 *
 * An entry from before 3.0.6 can carry the name of its run in `prompt`
 * ("Background removed"), and a tool without a prompt field has none. For
 * both the view says that there is no prompt and offers nothing to copy.
 *
 * Driven through the real page and the real store. Replaced are the route
 * (which result is open) and the clipboard of the system.
 *
 * Run: npx vitest run src/mobile/screens/create/__tests__/viewer-prompt.dom.test.tsx
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const seen = vi.hoisted(() => ({ id: 'a', copied: [] as string[], copyWorks: true, toasts: [] as Array<{ text: string; testid?: string; tone?: string }> }))
vi.mock('../../../nav', async (orig) => ({
  ...(await orig<typeof import('../../../nav')>()),
  useParams: () => ({ id: seen.id }),
}))
vi.mock('../../../platform/clipboard', () => ({
  copyText: async (text: string) => {
    seen.copied.push(text)
    return seen.copyWorks
  },
}))
vi.mock('../../../ui', async (orig) => ({
  ...(await orig<typeof import('../../../ui')>()),
  toast: (text: string, options: { testid?: string; tone?: string } = {}) => {
    seen.toasts.push({ text, ...options })
  },
}))

import ItemViewerPage from '../ItemViewerPage'
import { useCreateStore, type GalleryItem } from '../../../../stores/createStore'
import { CREATE_STRINGS as T } from '../../../strings/create'

const entry = (over: Partial<GalleryItem>): GalleryItem =>
  ({
    id: 'a', type: 'image', filename: '', subfolder: '', prompt: '', negativePrompt: '', model: 'flux-schnell', modelType: 'flux',
    seed: 1, steps: 4, cfgScale: 1, sampler: '', scheduler: '', width: 1024, height: 1024, batchSize: 1, createdAt: 1,
    remoteUrl: 'https://cdn.example/a.png', jobId: 'job-a', ...over,
  }) as GalleryItem

async function open(item: GalleryItem) {
  seen.id = item.id
  act(() => useCreateStore.setState({ gallery: [item] }))
  render(<ItemViewerPage />)
  fireEvent.click(screen.getByTestId('m-create-item-prompt'))
  return screen.getByTestId('m-create-item-prompt-text')
}

beforeEach(() => {
  seen.copied = []
  seen.toasts = []
  seen.copyWorks = true
})
afterEach(() => {
  cleanup()
  act(() => useCreateStore.setState({ gallery: [] }))
})

describe('the prompt in the result view of the phone', () => {
  it('shows the text that ran, and Copy puts exactly that text on the clipboard and says "Copied"', async () => {
    const panel = await open(entry({ prompt: '  a red fox in deep snow  ' }))
    expect(panel.textContent).toContain('a red fox in deep snow')
    expect(panel.textContent).not.toContain(T.item.noPrompt)
    fireEvent.click(screen.getByTestId('m-create-item-prompt-copy'))
    await waitFor(() => expect(seen.toasts).toHaveLength(1))
    expect(seen.copied).toEqual(['a red fox in deep snow'])
    expect(seen.toasts[0]).toMatchObject({ text: 'Copied', testid: 'create-copied', tone: 'default' })
  })

  it('a clipboard that refuses is said, not passed off as copied', async () => {
    seen.copyWorks = false
    await open(entry({ prompt: 'a fox' }))
    fireEvent.click(screen.getByTestId('m-create-item-prompt-copy'))
    await waitFor(() => expect(seen.toasts).toHaveLength(1))
    expect(seen.toasts[0].text).toBe(T.copyFailed)
    expect(seen.toasts[0].tone).toBe('error')
  })

  it('an entry from before 3.0.6 whose prompt is the name of its run: no prompt, nothing to copy', async () => {
    const panel = await open(entry({ prompt: 'Background removed', label: 'Background removed' }))
    expect(panel.textContent).toContain(T.item.noPrompt)
    expect(panel.textContent).not.toContain('Background removed')
    expect(screen.queryByTestId('m-create-item-prompt-copy')).toBeNull()
  })

  it('a tool that takes no prompt: no prompt, whatever the entry carries', async () => {
    const panel = await open(entry({ prompt: 'left over from the field', intent: 'removebg' } as Partial<GalleryItem>))
    expect(panel.textContent).toContain(T.item.noPrompt)
    expect(panel.textContent).not.toContain('left over from the field')
    expect(screen.queryByTestId('m-create-item-prompt-copy')).toBeNull()
  })

  it('a voice line keeps its text, it is what the voice says', async () => {
    const panel = await open(entry({ type: 'audio', prompt: 'Good morning.', intent: 'lipsync', remoteUrl: 'https://cdn.example/a.mp3' } as Partial<GalleryItem>))
    expect(panel.textContent).toContain('Good morning.')
    expect(screen.getByTestId('m-create-item-prompt-copy')).toBeTruthy()
  })

  it('an improved prompt: what the user wrote stays shown, Copy takes what was sent', async () => {
    const panel = await open(entry({ prompt: 'a red fox, golden hour, 85mm', promptOriginal: 'a fox' }))
    expect(screen.getByTestId('m-create-item-prompt-own').textContent).toBe('a fox')
    expect(panel.textContent).toContain('golden hour')
    fireEvent.click(screen.getByTestId('m-create-item-prompt-copy'))
    await waitFor(() => expect(seen.copied).toEqual(['a red fox, golden hour, 85mm']))
  })

  it('guard: the page asks the shared rule and does not read the field itself', () => {
    const src = readFileSync(join(process.cwd(), 'src/mobile/screens/create/ItemViewerPage.tsx'), 'utf8')
    expect(src).toContain('const prompt = ranPrompt(item)')
    // `T.item.prompt` is the label of the button, not the field of a result.
    expect(src.replace(/T\.item\.prompt\b/g, '')).not.toMatch(/item\.prompt\b/)
  })
})
