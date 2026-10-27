/**
 * Every "Settings > …" a download failure prints has to be a place that exists.
 *
 * Discord #bug-reports 2026-08-28: "the field for the CivitAI
 * API key is gone from the UI". The field came back (CivitaiApiKeySetting), and
 * then it MOVED: the A14 Windows review found a tester saving a folder path as
 * his API key, because the key sat directly under the Storage folder
 * field, two bare text boxes in a row. A credential and a folder do not belong
 * in one list, so the key got a section of its own.
 *
 * The message a refused CivitAI download prints did not move with it. It kept
 * saying "Settings > AI Backends > Storage", the folder settings, where
 * the key field is not. The one sentence a user gets at the moment he needs the
 * field sent him to the wrong section, which is the same complaint as the
 * original report, one turn later.
 *
 * So the message is held against the app's own section list rather than against
 * a copy of it. Both sides are read from source: the paths out of
 * `download_http_error` in Rust, the section titles out of settings-nav.ts,
 * which itself is pinned to the rendered `<Section title="…">` literals by
 * settings-rail-und-rang.test.ts.
 *
 * Run: npx vitest run src/components/settings/__tests__/die-meldung-zeigt-auf-den-abschnitt-den-es-gibt.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { sectionsFor, type SettingsSectionFlags } from '../settings-nav'

const here = dirname(fileURLToPath(import.meta.url))
const downloadRs = readFileSync(resolve(here, '../../../../src-tauri/src/commands/download.rs'), 'utf8')

/** Every section title the app can show, under any platform and any flag. */
function everySectionTitle(): Set<string> {
  const combos: SettingsSectionFlags[] = []
  for (const gpuPicker of [true, false]) {
    for (const builtinExpert of [true, false]) {
      for (const comfyui of [true, false]) {
        combos.push({
          gpuPicker, builtinExpert, comfyui,
          agentMode: true, agentWorkflows: true, mediaTimeouts: true,
        } as SettingsSectionFlags)
      }
    }
  }
  const out = new Set<string>()
  for (const flags of combos) {
    for (const tab of ['general', 'backends', 'agent', 'voice-remote'] as const) {
      for (const title of sectionsFor(tab, flags)) out.add(title)
    }
  }
  return out
}

/** The `Settings > A > B` paths a message PRINTS. Comment lines are dropped
 *  first, because a doc comment that talks about the rule is not a message, and
 *  only the leaf matters: that is the section the user goes looking for. */
function settingsPathsIn(src: string): string[] {
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')
  // A path ends where the sentence goes on: a full stop, a comma or the line.
  return [...code.matchAll(/Settings > ([^.,"\\\n]+)/g)].map((m) => m[1].trim())
}

describe('a download failure points at a section the app really has', () => {
  it('THE FIX: every Settings path in download.rs ends in a real section', () => {
    const titles = everySectionTitle()
    const paths = settingsPathsIn(downloadRs)
    // A message that names no path at all would pass an "every" silently.
    expect(paths.length).toBeGreaterThanOrEqual(2)
    for (const path of paths) {
      const leaf = path.split('>').pop()!.trim()
      expect(titles, `"Settings > ${path}" · no section is called "${leaf}"`).toContain(leaf)
    }
  })

  it('and the CivitAI refusal names the section the key field is in', () => {
    // Both halves of the message: the key was never entered, and the key was
    // entered and rejected. The second one is the one a user with a wrong key
    // reads, and it has to send him to the field he has to correct.
    const civitai = downloadRs.slice(
      downloadRs.indexOf('if is_civitai_host(url) && refused {'),
      downloadRs.indexOf('http_error_message(status, filename)\n}'),
    )
    expect(civitai).toContain('Settings > AI Backends > CivitAI API key')
    expect(civitai).not.toContain('Settings > AI Backends > Storage')
    expect(sectionsFor('backends', {
      gpuPicker: true, builtinExpert: true, comfyui: true,
      agentMode: true, agentWorkflows: true, mediaTimeouts: true,
    } as SettingsSectionFlags)).toContain('CivitAI API key')
  })

  /**
   * Dieselbe Frage, eine Etage hoeher: nicht der abgelehnte Download, sondern
   * die leere Trefferliste. Die sagte "add your CivitAI API key in the
   * Workflow finder", und der Workflow-Finder ist nicht der Ort, an dem das
   * Feld liegt. Das ist genau der Fehler, den der Rust-Text eine Runde
   * frueher hatte, im zweiten Satz, den ein Nutzer an derselben Stelle liest.
   */
  it('und die leere CivitAI-Trefferliste nennt denselben echten Abschnitt', () => {
    const panel = readFileSync(
      resolve(here, '../../models/CivitaiSearchPanel.tsx'), 'utf8',
    )
    const leer = panel.slice(panel.indexOf('No matches for'))
    for (const pfad of settingsPathsIn(leer.replace(/&gt;/g, '>'))) {
      expect(everySectionTitle()).toContain(pfad.split('>').pop()!.trim())
    }
    expect(leer).toContain('CivitAI API key')
    // NEGATIVKONTROLLE: der alte Wegweiser faellt durch.
    expect(panel).not.toContain('in the Workflow finder')
  })
})
