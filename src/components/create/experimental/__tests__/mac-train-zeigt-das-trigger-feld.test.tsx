// @vitest-environment jsdom
/**
 * GH #194 (M5 Pro, 3.0.7, clean install): Create → Character → Train new on
 * a Mac showed no trigger word field. The standard Mac setup brings the image
 * engine with SD-Turbo, not Z-Image Turbo, and without Z-Image the Train tab
 * swapped its whole surface for one grey line. The photo strip stayed, so the
 * tab read as a flow with its input missing, not as a step still to take.
 *
 * Now the inputs stay and the missing step sits above them with its button,
 * the way the Windows trainer shows "Download base files". Create asks the
 * same question before it stages a photo. A Mac with too little memory still
 * gets the refusal alone: it can never train.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/mac-train-zeigt-das-trigger-feld.test.tsx
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'

const io = vi.hoisted(() => ({ train: null as null | Record<string, unknown> }))
vi.mock('../../../../api/mlx-image', async (orig) => ({ ...(await orig<typeof import('../../../../api/mlx-image')>()), isMlxImageHost: () => true }))
vi.mock('../../../../api/mlx-train', async (orig) => ({
  ...(await orig<typeof import('../../../../api/mlx-train')>()),
  getMacTrainStatus: vi.fn(async () => io.train),
}))

import { SpecialControls } from '../SpecialIntentControls'
import { useCreateStore } from '../../../../stores/createStore'
import { useUIStore } from '../../../../stores/uiStore'
import { useModelStore } from '../../../../stores/modelStore'
import { macTrainMissing } from '../../../../api/mlx-train'

const READY = { engineReady: true, base: 'z-image-turbo-4bit', adapterReady: true, adapterBytes: 340_194_488, minRamGB: 24, memoryRefusal: null, running: false }

function arrange() {
  useCreateStore.setState({ backend: 'local', error: null, triggerWord: '', trainImages: [] } as never)
  const s = useCreateStore.getState()
  s.setIntent('character')
  s.setCharacterTab('train')
}

afterEach(() => cleanup())

describe('Train new on a Mac without Z-Image Turbo (GH #194)', () => {
  it('shows the trigger word field and the steps', async () => {
    io.train = { ...READY, engineReady: false, base: null }
    arrange()
    render(<SpecialControls intent="character" />)
    const field = await screen.findByPlaceholderText('Trigger word, e.g. davechar')
    fireEvent.change(field, { target: { value: 'davechar' } })
    expect(useCreateStore.getState().triggerWord).toBe('davechar')
    expect(screen.getByTestId('mac-train-controls')).toBeTruthy()
  })

  it('names the missing step and opens the Model Manager on the image models', async () => {
    io.train = { ...READY, base: null }
    arrange()
    useUIStore.getState().setView('create')
    render(<SpecialControls intent="character" />)
    expect((await screen.findByTestId('mac-train-note')).textContent).toMatch(/needs Z-Image Turbo/)
    fireEvent.click(screen.getByRole('button', { name: 'Install Z-Image Turbo' }))
    expect(useUIStore.getState().currentView).toBe('models')
    expect(useModelStore.getState().categoryFilter).toBe('image')
  })

  it('COUNTER-CHECK: with Z-Image Turbo there is no install line', async () => {
    io.train = READY
    arrange()
    render(<SpecialControls intent="character" />)
    await screen.findByTestId('mac-train-hint')
    expect(screen.queryByTestId('mac-train-note')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Install Z-Image Turbo' })).toBeNull()
  })

  it('COUNTER-CHECK: a Mac with too little memory gets the refusal, no half flow', async () => {
    io.train = { ...READY, memoryRefusal: 'Training a character needs a Mac with 24 GB of memory, and this one has 16 GB.' }
    arrange()
    render(<SpecialControls intent="character" />)
    expect((await screen.findByTestId('mac-train-note')).textContent).toMatch(/24 GB/)
    expect(screen.queryByPlaceholderText('Trigger word, e.g. davechar')).toBeNull()
  })
})

describe('what is missing before a Mac can train', () => {
  it('is Z-Image Turbo, whether the engine or the pack is absent', () => {
    expect(macTrainMissing({ engineReady: false, base: null })).toMatch(/needs Z-Image Turbo/)
    expect(macTrainMissing({ engineReady: true, base: null })).toMatch(/needs Z-Image Turbo/)
    expect(macTrainMissing({ engineReady: false, base: 'z-image-turbo-4bit' })).toMatch(/needs Z-Image Turbo/)
    expect(macTrainMissing({ engineReady: true, base: 'z-image-turbo-4bit' })).toBeNull()
  })

  it('is asked by Create before a photo is staged', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'hooks', 'useCreate.ts'), 'utf8')
    const training = src.slice(src.indexOf('const runCharacterTraining = useCallback('), src.indexOf('const runOnce = useCallback('))
    const ask = training.indexOf('macTrainMissing(')
    expect(ask).toBeGreaterThan(0)
    expect(training.indexOf('await stageTrainingImage(')).toBeGreaterThan(ask)
  })
})
