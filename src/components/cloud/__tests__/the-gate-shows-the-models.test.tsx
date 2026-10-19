// @vitest-environment jsdom
/**
 * The gate pop-up for somebody without an account (3.0.7): three dropdowns,
 * Chat, Code and Create, in the app's own Cloud mode picker. A row is not
 * usable here; its click is counted, remembered, and opens the two ways in,
 * each one button to the checkout with the model.
 *
 * Run: npx vitest run src/components/cloud/__tests__/the-gate-shows-the-models.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'

const openExternal = vi.fn(async () => {})
const backendCall = vi.fn(async () => undefined)
vi.mock('../../../api/backend', () => ({ openExternal, backendCall, isMacOS: () => false }))
vi.mock('../../../hooks/useGraphicsMemory', () => ({ useGraphicsMemoryGb: () => 12 }))
const getPublicCatalog = vi.fn()
vi.mock('../../../api/cloud/public-catalog', () => ({ getPublicCatalog }))

const { CloudGateModal } = await import('../CloudGateModal')
const { useCloudAuthStore } = await import('../../../stores/cloudAuthStore')
const { useUIStore } = await import('../../../stores/uiStore')
const { useCloudGateStore } = await import('../../../stores/cloudGateStore')
const { parseGateCatalog } = await import('../../../lib/cloud-gate')

const live = parseGateCatalog({
  version: 1,
  categories: {
    chat: [
      { id: 'moonshotai/Kimi-K3', label: 'Kimi K3' },
      { id: 'google/gemma-4-31b-it', label: 'Gemma 4 31B' },
      { id: 'meta/Llama-3.1-8B-Turbo', label: 'Llama 3.1 8B' },
    ],
    code: [{ id: 'moonshotai/Kimi-K3', label: 'Kimi K3' }],
    create: [
      { id: 'flux-dev', label: 'Flux Dev', kind: 'image' },
      { id: 'wan-2.2-720p', label: 'Wan 2.2', kind: 'video' },
      { id: 'qwen-image-2.1-edit', label: 'Qwen Image 2.1', kind: 'edit' },
    ],
  },
  offers: {
    plans: [{ tier: 'hosted', interval: 'month', eur: 19, images: 3000, clips: 112 }],
    packs: [{ id: 'pack-15', eur: 15, images: 1500, clips: 56 }],
  },
})!

async function openGate() {
  useCloudAuthStore.getState().setSignedOut()
  useUIStore.getState().setCloudGateOpen(true)
  await act(async () => { render(<CloudGateModal />) })
}

const events = () => backendCall.mock.calls.map((c) => (c as unknown[])[1] as { event: string }).map((a) => a.event)

beforeEach(() => {
  getPublicCatalog.mockResolvedValue(live)
  useCloudGateStore.setState({ catalog: null, pick: null })
})
afterEach(() => {
  cleanup()
  openExternal.mockClear()
  backendCall.mockClear()
  useUIStore.getState().setCloudGateOpen(false)
})

describe('the gate shows the models behind the switch', () => {
  it('has one dropdown each for Chat, Code and Create, in the real picker', async () => {
    await openGate()
    for (const c of ['chat', 'code', 'create']) expect(screen.getByTestId(`gate-dropdown-${c}`)).toBeTruthy()
    fireEvent.click(screen.getByTestId('gate-dropdown-chat'))
    const menu = screen.getByTestId('gate-menu-chat')
    expect(menu.className).toContain('lu-picker')
    expect(within(menu).getByTestId('model-picker-search')).toBeTruthy()
    expect(within(menu).getByText('Kimi K3')).toBeTruthy()
  })

  it('marks a model too big for the card, and not one that fits', async () => {
    await openGate()
    fireEvent.click(screen.getByTestId('gate-dropdown-chat'))
    const menu = screen.getByTestId('gate-menu-chat')
    const notes = [...menu.querySelectorAll('[data-note="quiet"]')].map((n) => n.textContent)
    expect(notes).toEqual(['Runs in LU Cloud, too big for your GPU'])
    const gemma = within(menu).getByText('Gemma 4 31B').closest('[role="option"]')!
    expect(gemma.textContent).toContain('too big for your GPU')
    const llama = within(menu).getByText('Llama 3.1 8B').closest('[role="option"]')!
    expect(llama.textContent).not.toContain('too big')
  })

  it('splits Create into Image, Video and Edit', async () => {
    await openGate()
    fireEvent.click(screen.getByTestId('gate-dropdown-create'))
    const menu = screen.getByTestId('gate-menu-create')
    expect(within(menu).getByText('Flux Dev')).toBeTruthy()
    expect(within(menu).queryByText('Wan 2.2')).toBeNull()
    fireEvent.click(menu.querySelector('[data-chip="edit"]')!)
    expect(within(screen.getByTestId('gate-menu-create')).getByText('Qwen Image 2.1')).toBeTruthy()
  })

  it('a click is counted, kept, and opens the two ways with results and one button each', async () => {
    await openGate()
    fireEvent.click(screen.getByTestId('gate-dropdown-create'))
    fireEvent.click(within(screen.getByTestId('gate-menu-create')).getByText('Flux Dev'))
    expect(events()).toEqual(['cloud_gate_model_click'])
    expect(useCloudGateStore.getState().pick).toMatchObject({ model: 'flux-dev', category: 'create', kind: 'image' })

    const win = screen.getByTestId('gate-buy-window')
    expect(within(win).getByText('Subscription')).toBeTruthy()
    expect(within(win).getByText('Credits')).toBeTruthy()
    expect(screen.getByTestId('gate-offer-sub').textContent).toBe('€19 a month, about 3,000 images or 112 clips each month')
    expect(screen.getByTestId('gate-offer-credits').textContent).toBe('€15 once, about 1,500 images or 56 clips')

    fireEvent.click(screen.getByTestId('gate-checkout-sub'))
    fireEvent.click(screen.getByTestId('gate-checkout-credits'))
    expect(events()).toEqual(['cloud_gate_model_click', 'cloud_gate_pick_sub', 'cloud_gate_pick_credits'])
    const [sub, pack] = openExternal.mock.calls.map((c) => new URL((c as unknown[])[0] as string))
    expect(sub.pathname).toBe('/checkout/start')
    expect(sub.searchParams.get('plan')).toBe('hosted')
    expect(sub.searchParams.get('src')).toBe('app-gate')
    expect(sub.searchParams.get('model')).toBe('flux-dev')
    expect(pack.searchParams.get('pack')).toBe('pack-15')
    expect(pack.searchParams.get('model')).toBe('flux-dev')
  })

  // Negative control: offline the lists come from the snapshot and the
  // window names no figure.
  it('offline shows the snapshot and no figures', async () => {
    getPublicCatalog.mockResolvedValue(null)
    await openGate()
    fireEvent.click(screen.getByTestId('gate-dropdown-chat'))
    const rows = screen.getByTestId('gate-menu-chat').querySelectorAll('[role="option"]')
    expect(rows.length).toBeGreaterThan(10)
    fireEvent.click(rows[0].querySelector('button')!)
    expect(screen.queryByTestId('gate-offer-sub')).toBeNull()
    expect(screen.queryByTestId('gate-offer-credits')).toBeNull()
    expect(screen.getByTestId('gate-checkout-sub')).toBeTruthy()
  })
})
