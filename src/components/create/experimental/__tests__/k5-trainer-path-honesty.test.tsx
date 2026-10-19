// @vitest-environment jsdom
/**
 * K5 Nachbesserung (Opus review of `4fda5a0a`, bau/review-teil8.md): three
 * blockers in the install-path field the previous round added.
 *
 *   Blocker 1: the Mac/Linux placeholder suggested a `~` Rust never expands.
 *   Blocker 2: the field stayed blank and the caption kept claiming the app
 *     data default even once a customized `trainer_root` was already active
 *     -- there was no way to see, or get back from, a customized install.
 *   Blocker 3: nothing in the setup said that base model downloads follow a
 *     DIFFERENT setting (the configured model folder) than this field.
 *
 * This file exercises the fixes at the component level; the pure logic
 * (`trainerRootHint`, `trainerPathPlaceholder`) has its own unit tests.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/k5-trainer-path-honesty.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

// 3.0.8 D20: the Train tab reads the card's memory for the Low VRAM hint;
// this file is about the trainer setup, so no card is reported.
vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => null }))
vi.mock('../../../../api/backend', () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => false,
  isLinux: () => true,
  backendCall: vi.fn(async () => ({ status: 'ok' })),
}))

const installCharacterTrainer = vi.fn(async () => ({ status: 'installing' }))
let mockedStatus: Record<string, unknown> = {}
vi.mock('../../../../api/trainer', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/trainer')>('../../../../api/trainer')
  return {
    ...actual,
    characterTrainerStatus: vi.fn(async () => mockedStatus),
    installCharacterTrainer: (...a: unknown[]) => installCharacterTrainer(...(a as [])),
  }
})
vi.mock('../../../../api/comfyui', () => ({ getLoraModels: vi.fn(async () => []) }))
vi.mock('../../../../api/cloud/loras', () => ({ listLoras: vi.fn(async () => []), deleteLora: vi.fn() }))
vi.mock('../../../../api/discover', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/discover')>('../../../../api/discover')
  return {
    ...actual,
    startModelDownload: vi.fn(async () => {}),
    getDownloadProgress: vi.fn(async () => ({})),
  }
})

import { SpecialControls } from '../SpecialIntentControls'
import { useCreateStore } from '../../../../stores/createStore'

function baseStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    envReady: false,
    basesReady: false,
    dit: null,
    textEncoder: null,
    vae: null,
    root: '/data/lu/musubi',
    customized: false,
    suggestedRoot: null,
    install: { status: 'idle', logs: [] },
    ...overrides,
  }
}

beforeEach(() => {
  cleanup()
  installCharacterTrainer.mockClear()
  useCreateStore.setState({ backend: 'local', characterTab: 'train' })
})

describe('K5 Nachbesserung: Blocker 1, kein Tilde-Platzhalter', () => {
  it('THE FIX: Linux zeigt einen absoluten Beispielpfad, keine Tilde', async () => {
    mockedStatus = baseStatus()
    render(<SpecialControls intent="character" />)
    expect(await screen.findByPlaceholderText(/^e\.g\. \//)).toBeTruthy()
    expect(screen.queryByPlaceholderText('e.g. ~/LU-Trainer')).toBeNull()
  })
})

describe('K5 Nachbesserung: Blocker 2, das Feld zeigt immer den gueltigen Pfad', () => {
  it('THE FIX: ein bereits angepasster Pfad wird ins Feld vorbelegt', async () => {
    mockedStatus = baseStatus({ root: 'E:\\LU-Trainer', customized: true })
    render(<SpecialControls intent="character" />)
    const feld = (await screen.findByDisplayValue('E:\\LU-Trainer')) as HTMLInputElement
    expect(feld.value).toBe('E:\\LU-Trainer')
  })

  it('GEGENPROBE: ohne Anpassung bleibt das Feld leer (der bisherige Standardweg aendert sich nicht)', async () => {
    mockedStatus = baseStatus({ customized: false })
    render(<SpecialControls intent="character" />)
    await screen.findByRole('button', { name: 'Set up trainer' })
    const feld = screen.getByPlaceholderText(/^e\.g\. \//) as HTMLInputElement
    expect(feld.value).toBe('')
  })

  it('THE FIX: die Bildunterschrift nennt den echten Pfad, nicht die pauschale Standardaussage', async () => {
    mockedStatus = baseStatus({ root: 'E:\\LU-Trainer', customized: true })
    render(<SpecialControls intent="character" />)
    await screen.findByDisplayValue('E:\\LU-Trainer')
    expect(screen.getByText(/Installs to E:\\LU-Trainer/)).toBeTruthy()
    expect(screen.queryByText(/Installs to your app data folder by default/)).toBeNull()
  })

  it('THE FIX: ein geleertes Feld ist der Weg zurueck und installCharacterTrainer erhaelt kein Argument', async () => {
    mockedStatus = baseStatus({ root: 'E:\\LU-Trainer', customized: true })
    render(<SpecialControls intent="character" />)
    const feld = await screen.findByDisplayValue('E:\\LU-Trainer')
    fireEvent.change(feld, { target: { value: '' } })
    expect(screen.getByText(/installs to your app data folder instead/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Set up trainer' }))
    expect(installCharacterTrainer).toHaveBeenCalledWith(undefined)
  })
})

describe('K5 Nachbesserung: Blocker 3, ehrliche Zielangabe', () => {
  it('THE FIX: das Setup-Gate sagt, dass Basismodelle woanders hinlaufen', async () => {
    mockedStatus = baseStatus()
    render(<SpecialControls intent="character" />)
    await screen.findByRole('button', { name: 'Set up trainer' })
    expect(screen.getByText(/configured model folder/)).toBeTruthy()
  })

  it('THE FIX: die Basisdatei-Anzeige nennt denselben Zielort ausdruecklich', async () => {
    mockedStatus = baseStatus({ envReady: true, basesReady: false })
    render(<SpecialControls intent="character" />)
    await screen.findByRole('button', { name: 'Download base files' })
    expect(screen.getByText(/Goes to your configured model folder/)).toBeTruthy()
  })
})

describe('Teil 10, Punkt 3: der Vorschlag fuellt das Feld sichtbar vor, statt nur ein Platzhalter zu sein', () => {
  it('THE FIX: kein Trainer, kein eigener Ordner, ein Vorschlag -- das Feld traegt den echten, editierbaren Wert', async () => {
    mockedStatus = baseStatus({ suggestedRoot: '/mnt/e/LU-Trainer' })
    render(<SpecialControls intent="character" />)
    const feld = (await screen.findByDisplayValue('/mnt/e/LU-Trainer')) as HTMLInputElement
    expect(feld.value).toBe('/mnt/e/LU-Trainer')
  })

  it('THE FIX: darunter steht der Grund fuer den Vorschlag', async () => {
    mockedStatus = baseStatus({ suggestedRoot: '/mnt/e/LU-Trainer' })
    render(<SpecialControls intent="character" />)
    await screen.findByDisplayValue('/mnt/e/LU-Trainer')
    expect(screen.getByText(/Your model folder is on another drive/)).toBeTruthy()
  })

  it('THE FIX: das vorbelegte Feld ist editierbar und leerbar', async () => {
    mockedStatus = baseStatus({ suggestedRoot: '/mnt/e/LU-Trainer' })
    render(<SpecialControls intent="character" />)
    const feld = (await screen.findByDisplayValue('/mnt/e/LU-Trainer')) as HTMLInputElement
    fireEvent.change(feld, { target: { value: '' } })
    expect(feld.value).toBe('')
    fireEvent.click(screen.getByRole('button', { name: 'Set up trainer' }))
    expect(installCharacterTrainer).toHaveBeenCalledWith(undefined)
  })

  it('GEGENPROBE: ein eigener, bereits angepasster Ordner uebersteuert den Vorschlag', async () => {
    // Punkt (b) der Bedingung: ein gesetzter eigener Trainer-Ordner ist
    // wichtiger als ein Vorschlag, der auf ComfyUI zeigt.
    mockedStatus = baseStatus({ root: 'E:\\LU-Trainer', customized: true, suggestedRoot: '/mnt/e/LU-Trainer' })
    render(<SpecialControls intent="character" />)
    const feld = (await screen.findByDisplayValue('E:\\LU-Trainer')) as HTMLInputElement
    expect(feld.value).toBe('E:\\LU-Trainer')
    expect(screen.queryByDisplayValue('/mnt/e/LU-Trainer')).toBeNull()
  })

  it('GEGENPROBE: kein Vorschlag bekannt, das Feld bleibt leer wie zuvor', async () => {
    mockedStatus = baseStatus({ suggestedRoot: null })
    render(<SpecialControls intent="character" />)
    await screen.findByRole('button', { name: 'Set up trainer' })
    const feld = screen.getByPlaceholderText(/^e\.g\. \//) as HTMLInputElement
    expect(feld.value).toBe('')
  })

  it('GEGENPROBE: eine bestehende Installation ausser Sicht bleibt unangetastet -- kein stilles Umziehen', async () => {
    // Bedingung (a): ist envReady wahr, rendert dieses Tor ueberhaupt nicht,
    // also gibt es kein Feld, das den Vorschlag je vorbelegen koennte.
    mockedStatus = baseStatus({ envReady: true, basesReady: true, dit: 'x', textEncoder: 'x', vae: 'x', suggestedRoot: '/mnt/e/LU-Trainer' })
    render(<SpecialControls intent="character" />)
    expect(screen.queryByDisplayValue('/mnt/e/LU-Trainer')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Set up trainer' })).toBeNull()
  })
})
