/**
 * setEngineContextWindow: the setting and the reload of the running model in
 * one call.
 *
 * Run: npx vitest run src/lib/__tests__/engine-context.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const engine = vi.hoisted(() => ({
  status: null as { running: boolean; model_path?: string } | null,
  swapped: [] as string[],
  swapFails: false,
  ctxAtSwap: -1,
}))

vi.mock('../../api/engine', () => ({
  bundledEngineStatus: async () => engine.status,
  swapBundledModel: async (path: string) => {
    const { useSettingsStore } = await import('../../stores/settingsStore')
    engine.ctxAtSwap = useSettingsStore.getState().settings.builtinEngine.ctx
    if (engine.swapFails) throw new Error('out of memory')
    engine.swapped.push(path)
  },
}))

import { setEngineContextWindow } from '../engine-context'
import { useSettingsStore } from '../../stores/settingsStore'
import { DEFAULT_SETTINGS } from '../constants'

const tuning = () => useSettingsStore.getState().settings.builtinEngine

beforeEach(() => {
  engine.status = { running: true, model_path: '/models/a.gguf' }
  engine.swapped = []
  engine.swapFails = false
  engine.ctxAtSwap = -1
  useSettingsStore.setState({ settings: { ...DEFAULT_SETTINGS, builtinEngine: { ...DEFAULT_SETTINGS.builtinEngine, ctx: 0, ctxChosen: false } } })
})

describe('setEngineContextWindow', () => {
  it('writes the size first and then loads the running model again', async () => {
    expect(await setEngineContextWindow(2048)).toBe('reloaded')
    expect(tuning()).toMatchObject({ ctx: 2048, ctxChosen: true })
    expect(engine.swapped).toEqual(['/models/a.gguf'])
    expect(engine.ctxAtSwap).toBe(2048)
  })

  it('0 goes back to automatic', async () => {
    await setEngineContextWindow(4096)
    expect(await setEngineContextWindow(0)).toBe('reloaded')
    expect(tuning()).toMatchObject({ ctx: 0, ctxChosen: false })
  })

  it('without a running model the size is saved for the next load', async () => {
    engine.status = { running: false }
    expect(await setEngineContextWindow(1024)).toBe('saved')
    expect(tuning().ctx).toBe(1024)
    expect(engine.swapped).toEqual([])
    engine.status = null
    expect(await setEngineContextWindow(2048)).toBe('saved')
  })

  it('the same size again does nothing', async () => {
    await setEngineContextWindow(2048)
    engine.swapped = []
    expect(await setEngineContextWindow(2048)).toBe('unchanged')
    expect(engine.swapped).toEqual([])
  })

  it('a stored size that was not chosen by the user counts as automatic', async () => {
    useSettingsStore.getState().updateSettings({ builtinEngine: { ...tuning(), ctx: 4096, ctxChosen: false } })
    expect(await setEngineContextWindow(0)).toBe('unchanged')
    expect(await setEngineContextWindow(4096)).toBe('reloaded')
    expect(tuning().ctxChosen).toBe(true)
  })

  it('a reload that fails is thrown, with the setting written', async () => {
    engine.swapFails = true
    await expect(setEngineContextWindow(4096)).rejects.toThrow('out of memory')
    expect(tuning()).toMatchObject({ ctx: 4096, ctxChosen: true })
  })

  it('nonsense is read as automatic', async () => {
    await setEngineContextWindow(2048)
    await setEngineContextWindow(Number.NaN)
    expect(tuning()).toMatchObject({ ctx: 0, ctxChosen: false })
    await setEngineContextWindow(2048.9)
    expect(tuning().ctx).toBe(2048)
  })
})
