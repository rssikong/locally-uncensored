// @vitest-environment jsdom
/**
 * K5 (DIE-301-LISTE.md, Discord "Storage", Rang B, 13.09.2026):
 * "everytime I try to force the app to go to my E drive it always takes up
 * space on my C drive". Opus Gesamtabnahme (review-gesamt.md, Abschnitt 7.3,
 * Auflage 3) measured the actual gap: `trainer_root` already redirects
 * pip/HF/torch caches once it is customized (`apply_trainer_cache_env` in
 * commands/trainer.rs), and `install_character_trainer` already accepts an
 * `installPath` argument that persists it, but the ONE production caller in
 * SpecialIntentControls.tsx called `installCharacterTrainer()` with no
 * argument. `trainer_root_is_customized()` could therefore never read true
 * for a customer, and the redirect never fired for anyone.
 *
 * This file nails the missing half: a typed install path in the pre-install
 * gate reaches `installCharacterTrainer`, and leaving it empty keeps the
 * existing default (no override written) so nobody's working setup changes
 * underneath them.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/k5-trainer-install-path-reaches-backend.test.tsx
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const backendCall = vi.fn(async () => ({ status: 'ok' }))
// 3.0.8 D20: the Train tab reads the card's memory for the Low VRAM hint;
// this file is about the trainer setup, so no card is reported.
vi.mock('../../../../hooks/useGraphicsMemory', () => ({ useGraphicsCardGb: () => null }))
vi.mock('../../../../api/backend', () => ({
  isTauri: () => true,
  isMacOS: () => false,
  isWindows: () => true,
  isLinux: () => false,
  backendCall: (...a: unknown[]) => backendCall(...(a as [])),
}))

const installCharacterTrainer = vi.fn(async () => ({ status: 'installing' }))
vi.mock('../../../../api/trainer', async () => {
  const actual = await vi.importActual<typeof import('../../../../api/trainer')>('../../../../api/trainer')
  return {
    ...actual,
    characterTrainerStatus: vi.fn(async () => ({
      envReady: false,
      basesReady: false,
      dit: null,
      textEncoder: null,
      vae: null,
      root: '',
      customized: false,
      suggestedRoot: null,
      install: { status: 'idle', logs: [] },
    })),
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

const quelle = readFileSync(resolve(__dirname, '..', 'SpecialIntentControls.tsx'), 'utf8')

beforeEach(() => {
  cleanup()
  installCharacterTrainer.mockClear()
  useCreateStore.setState({ backend: 'local', characterTab: 'train' })
})

describe('K5: der Installationspfad des Trainers erreicht den Aufruf', () => {
  it('THE FIX: ein eingetragener Pfad wird an installCharacterTrainer uebergeben', async () => {
    render(<SpecialControls intent="character" />)
    const feld = await screen.findByPlaceholderText('e.g. D:\\LU-Trainer')
    fireEvent.change(feld, { target: { value: '  D:\\LU-Trainer  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Set up trainer' }))
    expect(installCharacterTrainer).toHaveBeenCalledWith('D:\\LU-Trainer')
  })

  it('GEGENPROBE: ein leeres Feld traegt keinen Pfad weiter, der Standard bleibt', async () => {
    render(<SpecialControls intent="character" />)
    await screen.findByPlaceholderText('e.g. D:\\LU-Trainer')
    fireEvent.click(screen.getByRole('button', { name: 'Set up trainer' }))
    expect(installCharacterTrainer).toHaveBeenCalledWith(undefined)
  })

  it('DIE ROTE ZAHL: ohne das Feld ruft die Oberflaeche installCharacterTrainer() ohne jedes Argument', () => {
    // Genau das war der gemeldete Windows-Fall: der einzige Aufrufer liess
    // installPath immer weg, trainer_root_is_customized() konnte nie wahr
    // werden. Nagelt fest, dass der Aufruf jetzt IMMER ein (moeglicherweise
    // leeres) Argument mitgibt, nicht die alte parameterlose Form.
    //
    // B1-Korrektur (Final Review Teil 17, review-teil17-lintfix.md): der
    // eigentliche Aufruf sitzt jetzt in `runInstall(path)`, gemeinsam fuer
    // das Erstsetup-Gate (`installPath`) und den Reinstall-Dialog (der NIE
    // den Vorschlag schickt, siehe trainer-install-path-derived-state.test.tsx).
    expect(quelle).not.toContain('installCharacterTrainer()')
    expect(quelle).toContain('installCharacterTrainer(path.trim() || undefined)')
  })

  it('das Feld ist die kleinste vorhandene Form: dieselbe Musterzeile wie der ComfyUI-Pfad', () => {
    const settings = readFileSync(
      resolve(__dirname, '../../../settings/SettingsPage.tsx'),
      'utf8',
    )
    // Keine neue Bedienidee: dasselbe "Pfad eintragen, er wird zum
    // Installationsziel" wie Settings > ComfyUI, nicht ein zweites
    // Bedienkonzept fuer denselben Zweck.
    expect(settings).toContain("runInstall(customPath.trim() || status?.path || '')")
    expect(quelle).toContain("path.trim() || undefined")
  })
})
