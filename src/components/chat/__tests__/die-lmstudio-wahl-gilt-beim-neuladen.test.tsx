// @vitest-environment jsdom
/**
 * GH #168: "256K · max" picked for an LM Studio model, the main model switched
 * away (LM Studio unloaded it) and back: LU loaded it with 16384.
 *
 * The whole way through, with LM Studio as an attrappe: the pick in the
 * context picker, then the load the model list starts when the model is
 * picked again (`lmsAutoLoadContext`, the size handed to `lms load -c`).
 *
 * Run: npx vitest run src/components/chat/__tests__/die-lmstudio-wahl-gilt-beim-neuladen.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ActiveContext } from '../../../hooks/useActiveContextWindow'

const loadLmStudioModel = vi.fn(async (..._a: unknown[]) => undefined)
vi.mock('../../../api/lmstudio', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/lmstudio')>()),
  loadLmStudioModel: (...a: unknown[]) => loadLmStudioModel(...a),
}))

let ctx: ActiveContext
vi.mock('../../../hooks/useActiveContextWindow', () => ({
  useActiveContextWindow: () => ctx,
  useActiveWindowUse: () => 'chat',
}))

import { ContextDropdown } from '../ContextDropdown'
import { lmsAutoLoadContext } from '../../models/ModelSelector'
import { savedLmStudioContext } from '../../../lib/lmstudio-context-pick'
import { useModelStore } from '../../../stores/modelStore'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { AIModel } from '../../../types/models'

const LMS = 'openai::gemma-4-31b-it-2'
// The row as the model list may carry it: its context a guess from the name.
const row = { name: LMS, model: 'gemma-4-31b-it-2', size: 0, type: 'text', provider: 'openai', providerName: 'LM Studio', contextLength: 8192 } as unknown as AIModel

beforeEach(() => {
  cleanup()
  loadLmStudioModel.mockClear()
  ctx = {
    provider: 'lmstudio', contextWindow: 16384, modelMax: 262144, sendWindow: 16384,
    isTrue: true, adjustable: true, source: 'probe', windowKey: '',
  }
  useModelStore.setState({ activeModel: LMS })
  useSettingsStore.getState().updateSettings({ contextWindowOverride: 0, contextWindowByModel: {} })
})

describe('the LM Studio pick survives a switch away and back', () => {
  it('is saved for the model and used by the next load LU starts', async () => {
    render(<ContextDropdown />)
    fireEvent.click(screen.getByRole('button', { name: /^Context window/ }))
    fireEvent.click(screen.getByRole('button', { name: /^256K · max/ }))
    await waitFor(() => expect(loadLmStudioModel).toHaveBeenCalledWith('gemma-4-31b-it-2', 262144))

    // The switch away unloads it (or not, see the group test). Picking it
    // again loads it, and this is the size that load asks for.
    const settings = useSettingsStore.getState().settings
    expect(lmsAutoLoadContext(row, savedLmStudioContext(settings, LMS))).toBe(262144)
  })

  it('does not change the num_ctx of every Ollama model on the way', async () => {
    render(<ContextDropdown />)
    fireEvent.click(screen.getByRole('button', { name: /^Context window/ }))
    fireEvent.click(screen.getByRole('button', { name: /^256K · max/ }))
    await waitFor(() => expect(loadLmStudioModel).toHaveBeenCalled())
    expect(useSettingsStore.getState().settings.contextWindowOverride).toBe(0)
  })

  it('Auto takes the pick back, and the next load asks for the auto size again', async () => {
    useSettingsStore.getState().updateSettings({ contextWindowByModel: { 'lmstudio|gemma-4-31b-it-2': 262144 } })
    render(<ContextDropdown />)
    fireEvent.click(screen.getByRole('button', { name: /^Context window/ }))
    fireEvent.click(screen.getByRole('button', { name: /^Auto/ }))
    await waitFor(() => expect(loadLmStudioModel).toHaveBeenCalledWith('gemma-4-31b-it-2', undefined))
    const settings = useSettingsStore.getState().settings
    expect(lmsAutoLoadContext(row, savedLmStudioContext(settings, LMS))).toBe(8192)
  })
})
