/**
 * Wo die Anleitung zum Malen der Maske steht.
 *
 * Entscheid des Inhabers, 19.09.2026: "Bei Edit Image will ich, dass du die
 * Meldung 'Paint a mask on the image above' zu einer einmal wegklickbaren Info
 * machst, wenn man die Paint Mask oeffnet. Komplett raus aus dem Promptfenster."
 *
 * Geprueft wird genau das: im Promptfenster steht sie nicht mehr, im
 * Maskeneditor steht sie, und sie laesst sich wegklicken und bleibt weg. Der
 * Ort ist hier die Aussage, und den sieht ein DOM-Test nicht - deshalb liest
 * dieser Fall den Quelltext, wie prompt-history-clear.test.ts daneben.
 *
 * Run: npx vitest run components/create/experimental/__tests__/mask-hint.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const here = dirname(fileURLToPath(import.meta.url))
const COMPOSER = readFileSync(join(here, '..', 'Composer.tsx'), 'utf8')
const MASK_EDITOR = readFileSync(join(here, '..', 'MaskEditor.tsx'), 'utf8')

describe('the mask instruction', () => {
  it('is gone from the prompt window', () => {
    expect(COMPOSER).not.toContain('Paint a mask on the image above')
    expect(COMPOSER).not.toContain('Paint over the object in the image above')
    // Und nicht nur der Satz: auch der gelbe Kasten, der ihn trug.
    expect(COMPOSER).not.toMatch(/text-amber-\d00 dark:text-amber/)
  })

  // P8-Notiz: dieser Fall gehoerte inhaltlich zu Paket P7 (Composer.tsx war dort
  // exklusiv). P7s Bericht bestaetigt, dass der Ersatztext fuer den Radiergummi
  // inzwischen in Composer.tsx steht. P9 fuehrt P7 und P8 zusammen, hier
  // scharfgeschaltet.
  it('still says something for a run that has no prompt field at all', () => {
    // Sonst stuende beim Radiergummi ein leerer Kasten ueber der Leiste.
    expect(COMPOSER).toContain('Mask ready. Hit Create.')
    expect(COMPOSER).toContain('Paint over what should go, then hit Create.')
  })

  it('lives in the mask editor now, and can be dismissed for good', () => {
    expect(MASK_EDITOR).toContain('Apply mask when you are done, then describe the edit below')
    // Erase has no prompt field, so its hint ends at Create.
    expect(MASK_EDITOR).toContain("'Apply mask when you are done, then hit Create.'")
    // Kein zweiter Aufguss der Fusszeile: die sagt schon dauerhaft, was Rot
    // bedeutet und wo gemalt wird.
    expect(MASK_EDITOR).toContain('Red = will be regenerated.')
    expect(MASK_EDITOR).toContain("localStorage.setItem(MASK_HINT_KEY, '1')")
    expect(MASK_EDITOR).toContain("localStorage.getItem(MASK_HINT_KEY) === '1'")
    // Ein privates Fenster wirft beim Zugriff. Der Hinweis darf den Editor
    // nicht mitreissen, also steht jeder Zugriff in einem try.
    const zugriffe = MASK_EDITOR.match(/localStorage\.(get|set)Item/g) ?? []
    expect(zugriffe.length).toBe(2)
    for (const stelle of zugriffe) {
      const i = MASK_EDITOR.indexOf(stelle)
      expect(MASK_EDITOR.slice(Math.max(0, i - 120), i)).toContain('try {')
    }
  })

  it('is rendered by the editor, not just declared in it', () => {
    expect(MASK_EDITOR).toContain('<MaskHint />')
  })
})
