// @vitest-environment jsdom
/**
 * Lint-Fix (react-hooks/set-state-in-effect, 19.09.2026,
 * bau/lintfix.md): `LocalTrainControls` used to keep a second state variable
 * (`installPath`) in sync with `status`/`pathTouched` through a `useEffect`
 * that called `setInstallPath(...)`. That is state derived from other state,
 * which belongs in render, not in an effect. The fix replaces the effect
 * with a plain expression computed on every render:
 *
 *   installPath = pathTouched
 *     ? typedPath
 *     : status?.customized ? status.root : (status?.suggestedRoot ?? '')
 *
 * This file pins the truth table for the value that actually reaches
 * `installCharacterTrainer` (via `installPath.trim() || undefined`),
 * specifically through the "Reinstall trainer" dialog, which renders only
 * once `envReady` is already true -- exactly the branch where the old
 * `TrainerPathField` (covered by k5-trainer-path-honesty.test.tsx) is never
 * shown, so the derived value was previously invisible except through this
 * one code path. `k5-trainer-path-honesty.test.tsx` already covers the
 * pre-install-gate half of the same table (customized/suggestedRoot/typed/
 * cleared, all with `pathTouched` reaching `false`/`true` through the
 * visible field); this file covers the two cases that only show up once
 * `envReady` is true and the field itself is gone.
 *
 * B1-Korrektur (Final Review Teil 17, review-teil17-lintfix.md, BLOCKIEREND):
 * the first version of this file expected the Reinstall dialog to send a
 * `suggestedRoot` when the trainer was not customized. That is the same
 * blocker review-trainerconfirm-webdraft.md already flagged once: a plain
 * "confirm" on the reinstall dialog wrote a folder the customer never chose
 * into `trainer_root`, which flips `trainer_root_is_customized()` to true
 * and moves the pip/HF/torch caches away from an install that predates the
 * move -- exactly what the dialog's own text promises will not happen. A
 * suggestion is only ever for the FIRST installation (the setup gate before
 * `envReady`); a reinstall of an existing trainer must never move it. The
 * cases below were corrected to match `confirmReinstall`'s fix: it sends
 * `status.root` only when the trainer is already customized, `undefined`
 * (today's location, unchanged) in every other case -- suggestedRoot never
 * reaches `installCharacterTrainer` through this dialog at all.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/trainer-install-path-derived-state.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// 3.0.8 D20: the Train tab reads the card's memory for the Low VRAM hint;
// this file is about the trainer setup, so no card is reported.
vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => null }))
vi.mock('../../../../api/backend', () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
  isLinux: () => false,
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

function readyStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    envReady: true,
    basesReady: true,
    dit: 'x',
    textEncoder: 'x',
    vae: 'x',
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

async function openAndConfirmReinstall() {
  render(<SpecialControls intent="character" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Reinstall trainer' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Reinstall' }))
}

describe('Lint-Fix Wahrheitstabelle: abgeleiteter installPath ueber den Reinstall-Dialog', () => {
  it('customized: false, kein suggestedRoot -- kein Pfad geht raus (Blocker-Fall)', async () => {
    mockedStatus = readyStatus({ customized: false, suggestedRoot: null, root: 'C:\\test-trainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith(undefined)
  })

  it('customized: true -- der eigene Ordner bleibt erhalten', async () => {
    mockedStatus = readyStatus({ customized: true, suggestedRoot: null, root: 'D:\\CustomTrainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith('D:\\CustomTrainer')
  })

  it('B1-KORREKTUR: customized: false, suggestedRoot gesetzt -- der Reinstall ignoriert den Vorschlag, sendet undefined', async () => {
    // VORHER (Blocker, review-teil17-lintfix.md B1): dieser Fall erwartete
    // `installCharacterTrainer` mit dem Vorschlag -- ein Kunde, der bloss
    // "Reinstall" bestaetigt, haette damit `trainer_root` auf einen Ordner
    // gesetzt, den er nie gewaehlt hat. Ein Vorschlag gilt nur fuer die
    // ERSTE Installation (das Erstsetup-Gate, das hier gar nicht rendert,
    // weil envReady bereits wahr ist).
    mockedStatus = readyStatus({ customized: false, suggestedRoot: '/mnt/e/LU-Trainer', root: 'C:\\test-trainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith(undefined)
  })

  it('GEGENPROBE: customized true UND suggestedRoot gesetzt -- der eigene Ordner gewinnt, nicht der Vorschlag', async () => {
    mockedStatus = readyStatus({ customized: true, suggestedRoot: '/mnt/e/LU-Trainer', root: 'D:\\CustomTrainer' })
    await openAndConfirmReinstall()
    expect(installCharacterTrainer).toHaveBeenCalledWith('D:\\CustomTrainer')
  })
})

describe('B3: ein zurueckgezogener suggestedRoot im laufenden Panel (Erstsetup-Gate, envReady false)', () => {
  it('THE FIX: verschwindet der Vorschlag aus einem spaeteren Status, faellt das Feld auf leer zurueck statt den alten Vorschlag festzuhalten', async () => {
    mockedStatus = {
      envReady: false, basesReady: false, dit: null, textEncoder: null, vae: null,
      root: '/data/lu/musubi', customized: false, suggestedRoot: '/mnt/e/LU-Trainer',
      install: { status: 'idle', logs: [] },
    }
    render(<SpecialControls intent="character" />)
    const feld = (await screen.findByDisplayValue('/mnt/e/LU-Trainer')) as HTMLInputElement
    expect(feld.value).toBe('/mnt/e/LU-Trainer')

    // Ein Klick auf "Set up trainer" startet die 2s-Umfrage in
    // LocalTrainControls, die characterTrainerStatus erneut aufruft -- der
    // einzige Weg im Panel, wie ein spaeterer Status (der Kunde hat ComfyUI
    // in der Zwischenzeit auf dasselbe Laufwerk umgestellt) ueberhaupt
    // ankommt, ohne die Komponente neu zu montieren. Der Mock schliesst die
    // Installation im selben Poll ab ("complete" statt "installing"), damit
    // `busy` wieder auf null faellt und das Feld (das waehrend `busy ===
    // 'install'` ausgeblendet ist) mit dem neuen Status erneut sichtbar
    // wird. Fake Timer erst NACH dem Erstrender, sonst haengt
    // findByDisplayValue an seinem eigenen realen Poll-Intervall.
    mockedStatus = { ...mockedStatus, suggestedRoot: null, install: { status: 'complete', logs: [] } }
    vi.useFakeTimers()
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Set up trainer' }))
      await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    } finally {
      vi.useRealTimers()
    }

    expect(screen.queryByDisplayValue('/mnt/e/LU-Trainer')).toBeNull()
    const feldDanach = screen.getByPlaceholderText('e.g. D:\\LU-Trainer') as HTMLInputElement
    expect(feldDanach.value).toBe('')
  })
})
