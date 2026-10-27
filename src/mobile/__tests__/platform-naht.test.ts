/**
 * Everything native goes through src/mobile/platform.
 *
 * A screen that calls Tauri, opens a window or reaches for the clipboard on
 * its own works in the browser and breaks on one of the two phones. The seam
 * has the fallback and the one place where the native command goes in.
 */
import { describe, expect, it } from 'vitest'
import { MOBILE_DIR, importsOf, sourceFiles, stripComments } from './scan'

const CALLS: readonly { name: string; re: RegExp }[] = [
  { name: 'window.open', re: /\bwindow\s*\.\s*open\s*\(/ },
  { name: 'navigator.clipboard', re: /\bnavigator\s*\.\s*clipboard\b/ },
  { name: 'navigator.share', re: /\bnavigator\s*\.\s*(share|canShare)\b/ },
  { name: 'navigator.vibrate', re: /\bnavigator\s*\.\s*vibrate\b/ },
  { name: '__TAURI__', re: /__TAURI(_INTERNALS)?__/ },
]

describe('native calls stay inside src/mobile/platform', () => {
  const outside = sourceFiles(MOBILE_DIR, ['.ts', '.tsx']).filter((f) => !f.rel.startsWith('mobile/platform/'))

  it('no Tauri package is imported outside the seam', () => {
    const hits: string[] = []
    for (const file of outside) {
      for (const hit of importsOf(file)) {
        if (hit.spec.startsWith('@tauri-apps/')) hits.push(`${file.rel} imports ${hit.spec}`)
      }
    }
    expect(hits).toEqual([])
  })

  it('no direct browser or Tauri call outside the seam', () => {
    const hits: string[] = []
    for (const file of outside) {
      const code = stripComments(file.text)
      for (const call of CALLS) {
        if (call.re.test(code)) hits.push(`${file.rel} uses ${call.name}`)
      }
    }
    expect(hits).toEqual([])
  })
})
