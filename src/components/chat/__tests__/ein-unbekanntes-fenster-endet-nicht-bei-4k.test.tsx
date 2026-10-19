// @vitest-environment jsdom
/**
 * GH #166: the context picker of a model whose server names no length.
 *
 * KoboldCpp behind its Ollama emulation, started with 262144, and 262144 set
 * as "Context window (Ollama)". The picker offered "Auto · 4K" and "4K · max"
 * and nothing else, because the stand in 4096 was taken for the model's
 * maximum. The hook runs for real here; only the server is faked.
 *
 * Run: npx vitest run src/components/chat/__tests__/ein-unbekanntes-fenster-endet-nicht-bei-4k.test.tsx
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { ContextDropdown } from '../ContextDropdown'
import { useActiveContextWindow } from '../../../hooks/useActiveContextWindow'
import { forgetSentWindows } from '../../../api/ollama'
import { useModelStore } from '../../../stores/modelStore'
import { useSettingsStore } from '../../../stores/settingsStore'

const KOBOLD_SHOW = { model_info: {}, parameters: '', template: '' }

function serve(routes: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const path = String(url).replace(/^https?:\/\/[^/]+/, '')
    if (path in routes) {
      return new Response(JSON.stringify(routes[path]), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    return new Response('404 page not found', { status: 404 })
  }))
}

const rows = () => screen.getAllByRole('button').map((b) => b.textContent?.trim() ?? '')

let n = 0
beforeEach(() => {
  cleanup()
  forgetSentWindows()
  // A fresh name per test: the hook keeps the last window per model.
  n += 1
  useModelStore.setState({ activeModel: `koboldcpp/gemma4-${n}` })
  useSettingsStore.getState().updateSettings({ contextWindowOverride: 0 })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('a model whose server names no context length', () => {
  it('reads KoboldCpp, and the picker goes up to what it runs with', async () => {
    serve({ '/api/show': KOBOLD_SHOW, '/api/extra/true_max_context_length': { value: 262144 } })
    const { result } = renderHook(() => useActiveContextWindow())
    await waitFor(() => expect(result.current.provider).toBe('ollama'))
    // The old hook said 4096.
    expect(result.current.modelMax).toBe(262144)

    render(<ContextDropdown />)
    await waitFor(() => expect(screen.getByRole('button', { name: /^Context window/ }).textContent).toMatch(/ctx/))
    fireEvent.click(screen.getByRole('button', { name: /^Context window/ }))
    await waitFor(() => expect(rows()).toContain('256K · max'))
    expect(rows()).toContain('128K')
  })

  it('without any source: no 4K ceiling, the set value is listed, and the picker says it cannot check', async () => {
    serve({ '/api/show': KOBOLD_SHOW, '/api/ps': { models: [] } })
    useSettingsStore.getState().updateSettings({ contextWindowOverride: 262144 })
    const { result } = renderHook(() => useActiveContextWindow())
    await waitFor(() => expect(result.current.provider).toBe('ollama'))
    expect(result.current.modelMax).toBe(0)
    expect(result.current.contextWindow).toBe(262144)

    render(<ContextDropdown />)
    fireEvent.click(screen.getByRole('button', { name: /^Context window/ }))
    await waitFor(() => expect(rows()).toContain('128K'))
    expect(rows()).toContain('256K')
    expect(rows().some((r) => r.includes('· max'))).toBe(false)
    // Auto still sends the small stand in, and says so.
    expect(rows()).toContain('Auto · 4K')
    expect(screen.getByText(/did not report the model's context length/)).toBeTruthy()
  })
})
