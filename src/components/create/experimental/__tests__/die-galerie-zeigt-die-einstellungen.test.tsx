// @vitest-environment jsdom
/**
 * D9 (3.0.7): Prompt und Einstellungen eines Bildes oder Videos in der Galerie.
 *
 * Jeder Galerie-Eintrag traegt seit jeher negativen Prompt, Schritte, CFG,
 * Sampler, Seed und Groesse. Gezeigt wurden davon nur Groesse, Seed und
 * Modell in der Zeile unter dem Ergebnis, der Prompt stand zugeklappt unter
 * "Prompt". Wer ein Bild nachbauen wollte, musste den Rest raten.
 *
 * Diese Datei nagelt fest: das Feld heisst "Prompt and settings", zeigt die
 * Werte, die am Lauf teilhatten, und keine erfundenen (0 bleibt weg, ein
 * Werkzeug hat keine Schritte), und ein Knopf kopiert alles. In der
 * Grossansicht (Lightbox) steht es aufgeklappt.
 *
 * Run: npx vitest run src/components/create/experimental/__tests__/die-galerie-zeigt-die-einstellungen.test.tsx
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

vi.mock('../CreateContext', () => ({
  useCreateExp: () => ({ quota: null, enhanceVideo: vi.fn() }),
}))
vi.mock('../useComfyMedia', () => ({
  useComfyMedia: () => ({ src: 'blob:media', onError: vi.fn() }),
}))

import type { GalleryItem } from '../../../../stores/createStore'
import { PromptDetails } from '../PromptDetails'
import { Lightbox } from '../Lightbox'
import { runSettings, runSettingsText, ranNegativePrompt } from '../../../../lib/render/run-settings'

afterEach(() => { cleanup() })

const ITEM = (extra: Partial<GalleryItem> = {}): GalleryItem => ({
  id: 'a', type: 'image', filename: '', subfolder: '', prompt: 'a red fox in the snow',
  negativePrompt: 'blurry, low quality', model: 'sd_xl_base_1.0.safetensors', modelType: 'sdxl',
  seed: 4242, steps: 25, cfgScale: 7, sampler: 'dpmpp_2m', scheduler: 'karras',
  width: 1024, height: 768, batchSize: 1, createdAt: 1, intent: 'image', ...extra,
})

describe('die Einstellungen eines Laufs', () => {
  it('ein Bild nennt Modell, Schritte, CFG, Sampler, Seed und Groesse', () => {
    expect(runSettings(ITEM())).toEqual([
      { label: 'Model', value: 'sd xl base 1.0' },
      { label: 'Steps', value: '25' },
      { label: 'CFG', value: '7' },
      { label: 'Sampler', value: 'dpmpp_2m' },
      { label: 'Seed', value: '4242' },
      { label: 'Size', value: '1024×768' },
    ])
    expect(ranNegativePrompt(ITEM())).toBe('blurry, low quality')
  })

  it('ein CFG steht, wie er gesetzt war', () => {
    expect(runSettings(ITEM({ cfgScale: 3.5 })).find((s) => s.label === 'CFG')?.value).toBe('3.5')
    expect(runSettings(ITEM({ cfgScale: 1.2500000001 })).find((s) => s.label === 'CFG')?.value).toBe('1.25')
  })

  it('eine 0 ist kein Wert: ein Lauf ohne Regler (Studio-Modell der Cloud) nennt keine Schritte', () => {
    const studio = runSettings(ITEM({ steps: 0, cfgScale: 0, sampler: '', negativePrompt: '' }))
    expect(studio.map((s) => s.label)).toEqual(['Model', 'Seed', 'Size'])
  })

  it('ein Werkzeug nennt nur sein eigenes Modell und die Groesse, nie Schritte oder Seed', () => {
    const cutout = ITEM({ intent: 'removebg', toolModel: 'RMBG-2.0' })
    expect(runSettings(cutout)).toEqual([
      { label: 'Model', value: 'RMBG-2.0' },
      { label: 'Size', value: '1024×768' },
    ])
    expect(ranNegativePrompt(cutout)).toBe('')
    expect(runSettings(ITEM({ intent: 'upscale' })).map((s) => s.label)).toEqual(['Size'])
  })

  it('die Bahnen ohne Regler nennen weder Schritte noch negativen Prompt', () => {
    for (const intent of ['music', 'lipsync', 'extend', 'motion'] as const) {
      const labels = runSettings(ITEM({ intent, type: 'video' })).map((s) => s.label)
      expect(labels, intent).not.toContain('Steps')
      expect(labels, intent).not.toContain('CFG')
      expect(ranNegativePrompt(ITEM({ intent })), intent).toBe('')
    }
    // Ein Track nennt sein Modell und seinen Seed, mit dem er sich wiederholen laesst.
    expect(runSettings(ITEM({ type: 'audio', intent: 'music' }))).toEqual([{ label: 'Model', value: 'sd xl base 1.0' }, { label: 'Seed', value: '4242' }])
    expect(runSettings(ITEM({ type: 'audio', intent: 'music', seed: 0 }))).toEqual([{ label: 'Model', value: 'sd xl base 1.0' }])
  })

  it('ein Video hat dieselben Zeilen wie ein Bild', () => {
    const video = ITEM({ type: 'video', intent: 'video', model: 'wan2.2_t2v.safetensors', steps: 30, cfgScale: 5, width: 1024, height: 576 })
    expect(runSettings(video).map((s) => `${s.label}=${s.value}`)).toEqual([
      'Model=wan2.2 t2v', 'Steps=30', 'CFG=5', 'Sampler=dpmpp_2m', 'Seed=4242', 'Size=1024×576',
    ])
  })

  it('ein Ergebnis aus dem Chat bringt nur seinen Prompt mit und hat keine Einstellungen', () => {
    expect(runSettings({})).toEqual([])
  })

  it('der Text fuer die Zwischenablage hat alles, eine Zeile je Wert', () => {
    expect(runSettingsText(ITEM())).toBe([
      'Prompt: a red fox in the snow',
      'Negative prompt: blurry, low quality',
      'Model: sd xl base 1.0',
      'Steps: 25',
      'CFG: 7',
      'Sampler: dpmpp_2m',
      'Seed: 4242',
      'Size: 1024×768',
    ].join('\n'))
  })
})

describe('das Feld am Ergebnis', () => {
  const clipboard = () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    return writeText
  }

  it('heisst "Prompt and settings" und zeigt negativen Prompt und Werte', () => {
    render(<PromptDetails item={ITEM()} open />)
    expect(screen.getByText('Prompt and settings')).toBeTruthy()
    expect(screen.getByText('Negative prompt')).toBeTruthy()
    expect(screen.getByText('blurry, low quality')).toBeTruthy()
    const box = screen.getByTestId('run-settings')
    for (const v of ['Steps', '25', 'CFG', '7', 'Seed', '4242', 'Size', '1024×768', 'Model', 'sd xl base 1.0']) {
      expect(box.textContent).toContain(v)
    }
  })

  it('der Knopf kopiert Prompt und Einstellungen, der negative Prompt hat seinen eigenen', async () => {
    const writeText = clipboard()
    render(<PromptDetails item={ITEM()} open />)
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt and settings' }))
    expect(writeText).toHaveBeenLastCalledWith(runSettingsText(ITEM()))
    fireEvent.click(screen.getByRole('button', { name: 'Copy negative prompt' }))
    expect(writeText).toHaveBeenLastCalledWith('blurry, low quality')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy prompt and settings' }).textContent).toBe('Copied'))
  })

  it('ohne negativen Prompt steht keine leere Zeile dafuer', () => {
    render(<PromptDetails item={ITEM({ negativePrompt: '  ' })} open />)
    expect(screen.queryByText('Negative prompt')).toBeNull()
  })

  it('ein Ergebnis aus dem Chat heisst weiter nur "Prompt"', () => {
    render(<PromptDetails item={{ prompt: 'a red fox in the snow' }} open />)
    expect(screen.getByText('Prompt')).toBeTruthy()
    expect(screen.queryByTestId('run-settings')).toBeNull()
  })
})

describe('die Grossansicht', () => {
  // Discord (20.10.2026): zugeklappt wie unter der Buehne von
  // Create; in Edit oeffnete jedes Bild aus der Galerie mit aufgeklapptem Prompt.
  it('zeigt Prompt und Einstellungen eines Bildes zugeklappt', () => {
    render(<Lightbox item={ITEM()} onClose={() => {}} />)
    const details = screen.getByTestId('prompt-details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(screen.getByText('Prompt and settings')).toBeTruthy()
    expect(screen.getByTestId('run-settings').textContent).toContain('4242')
  })

  it('und eines Videos', () => {
    render(<Lightbox item={ITEM({ type: 'video', intent: 'video', steps: 30 })} onClose={() => {}} />)
    expect((screen.getByTestId('prompt-details') as HTMLDetailsElement).open).toBe(false)
    expect(screen.getByTestId('run-settings').textContent).toContain('30')
  })
})
