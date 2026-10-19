/**
 * @vitest-environment jsdom
 *
 * Discord, thread "I can't launch Wan2.2" (15.10.2026): the reporter searched
 * Get new for FramePack and found nothing. The FramePack bundle is filed under
 * Unfiltered, the page opens on Mainstream, and the search only looked inside
 * the open tab. Measured on the rendered page: with "framepack" typed, the
 * FramePack card is there although Mainstream is the open tab.
 *
 * Run: npx vitest run src/components/models/__tests__/a-search-looks-in-both-catalogue-tabs.test.tsx
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, waitFor } from '@testing-library/react'
import { bundlesForTabAndSearch } from '../../../lib/discover-bundle-search'
import { getVideoBundles } from '../../../api/model-bundles'

vi.mock('../../../api/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/backend')>()),
  backendCall: vi.fn(async () => []),
  openExternal: vi.fn(),
  isTauri: () => false,
  isMacOS: () => false,
}))
vi.mock('../../../api/comfyui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/comfyui')>()),
  getSystemVRAM: vi.fn(async () => 16),
  readComfyFolderLists: vi.fn(async () => ({})),
  refreshComfyModels: vi.fn(async () => {}),
}))
vi.mock('../../../lib/hardware', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../lib/hardware')>()),
  getMaxVramGb: vi.fn(async () => 16),
  getTotalRamGb: vi.fn(async () => 64),
}))
vi.mock('../CivitaiSearchPanel', () => ({ CivitaiSearchPanel: () => null }))
vi.mock('../../chat/LuEngineSwitchBar', () => ({ LuEngineSwitchBar: () => null }))

import { DiscoverModels } from '../DiscoverModels'

const FRAMEPACK = 'FramePack F1 (Image to Video)'
const tile = (name: string) => document.querySelector(`[data-bundle-tile="${name}"]`)

beforeEach(() => {
  cleanup()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('the Get new search', () => {
  it('the FramePack bundle is filed under Unfiltered, which is the premise of the report', () => {
    expect(getVideoBundles().find((b) => b.name === FRAMEPACK)?.uncensored).toBe(true)
  })

  it('THE REPORT: "framepack" finds the card while Mainstream is the open tab', async () => {
    render(<DiscoverModels category="video" search="framepack" />)
    await waitFor(() => expect(tile(FRAMEPACK)).toBeTruthy())
  })

  it('without a search the open tab still decides', async () => {
    render(<DiscoverModels category="video" />)
    await waitFor(() => expect(document.querySelector('[data-bundle-tile]')).toBeTruthy())
    expect(tile(FRAMEPACK)).toBeNull()
  })

  it('the rule itself: a search matches name or description in both tabs', () => {
    const list = [
      { name: 'A', description: 'plain', uncensored: false },
      { name: 'B', description: 'next frame prediction', uncensored: true },
    ]
    expect(bundlesForTabAndSearch(list, 'mainstream', '').map((b) => b.name)).toEqual(['A'])
    expect(bundlesForTabAndSearch(list, 'uncensored', '').map((b) => b.name)).toEqual(['B'])
    expect(bundlesForTabAndSearch(list, 'mainstream', 'FRAME').map((b) => b.name)).toEqual(['B'])
    expect(bundlesForTabAndSearch(list, 'mainstream', '   ').map((b) => b.name)).toEqual(['A'])
  })
})
