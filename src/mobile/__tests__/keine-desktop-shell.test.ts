/**
 * The mobile shell does not load the desktop shell.
 *
 * components/layout holds AppShell, sidebar, header and the window chrome;
 * components/onboarding is the desktop onboarding window. Both probe local
 * engines, open windows and assume a pointer. The phone has its own shell
 * (MobileRoot) and its own onboarding (screens/onboarding).
 */
import { describe, expect, it } from 'vitest'
import { MOBILE_DIR, importsOf, sourceFiles } from './scan'

const FORBIDDEN: readonly { dir: string; why: string }[] = [
  { dir: 'components/layout', why: 'desktop shell' },
  { dir: 'components/onboarding', why: 'desktop onboarding window' },
]
/** Single files of the desktop start that probe local engines or own the windows. */
const FORBIDDEN_FILES: readonly string[] = ['App', 'lib/host-window', 'lib/window-chrome', 'lib/tray']

describe('src/mobile stays away from the desktop shell', () => {
  const files = sourceFiles(MOBILE_DIR, ['.ts', '.tsx'])

  it('finds the mobile sources', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it('imports nothing from components/layout or the onboarding window', () => {
    const hits: string[] = []
    for (const file of files) {
      for (const hit of importsOf(file)) {
        if (hit.target === null) continue
        const target = hit.target.replace(/\.(tsx?|js)$/, '')
        const dir = FORBIDDEN.find((f) => target === f.dir || target.startsWith(`${f.dir}/`))
        if (dir) hits.push(`${file.rel} imports ${hit.spec} (${dir.why})`)
        if (FORBIDDEN_FILES.includes(target)) hits.push(`${file.rel} imports ${hit.spec}`)
      }
    }
    expect(hits).toEqual([])
  })
})
