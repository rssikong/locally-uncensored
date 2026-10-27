/**
 * GH #191: the AppImage's `.DirIcon` and root `.desktop` are relative links.
 *
 * The tauri bundler before @tauri-apps/cli 2.11.4 (tauri-bundler 2.9.4,
 * tauri-apps/tauri#15596) wrote both as ABSOLUTE symlinks into the build
 * machine's AppDir. Mounted on a customer's machine they dangle, and AppImage
 * installers such as AppManager refuse the file. Two halves keep it fixed:
 *
 *   1. the CLI that bundles is pinned, exactly, at a release with the fix;
 *   2. release.yml looks at the links inside the AppImage it just built, so a
 *      bundler that regresses turns the release red instead of shipping.
 *
 * The second half is not only read, it is run here against two hand-made
 * AppDirs, one with each kind of link.
 */
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { bashInterpreter } from '../../api/__tests__/bash-interpreter'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '../../..')
const read = (rel: string) => readFileSync(resolve(root, rel), 'utf8')

const FIXED_IN: [number, number, number] = [2, 11, 4]

const atLeast = (version: string, floor: [number, number, number]) => {
  const parts = version.split('.').map((p) => Number.parseInt(p, 10))
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== floor[i]) return parts[i] > floor[i]
  }
  return true
}

/** The link check out of release.yml, from its loop to its OK line. */
function linkCheck(): string {
  const yml = read('.github/workflows/release.yml')
  const start = yml.indexOf('for link in "$workdir/squashfs-root/.DirIcon"')
  const end = yml.indexOf('echo "OK: .DirIcon and the .desktop link are relative')
  expect(start, 'release.yml checks the AppImage links').toBeGreaterThan(0)
  expect(end).toBeGreaterThan(start)
  return yml
    .slice(start, yml.indexOf('\n', end))
    .split('\n')
    .map((line) => line.replace(/^ {10}/, ''))
    .join('\n')
}

describe('GH #191: AppImage links', () => {
  it('bundles with a CLI that writes relative links, pinned exactly', () => {
    const pkg = JSON.parse(read('package.json'))
    const wanted: string = pkg.devDependencies['@tauri-apps/cli']
    expect(wanted, 'an exact pin, not a range').toMatch(/^\d+\.\d+\.\d+$/)
    expect(atLeast(wanted, FIXED_IN), `@tauri-apps/cli ${wanted}`).toBe(true)

    const lock = JSON.parse(read('package-lock.json'))
    const locked: string = lock.packages['node_modules/@tauri-apps/cli'].version
    expect(locked).toBe(wanted)
    // The platform binaries are what actually bundles.
    const linux = lock.packages['node_modules/@tauri-apps/cli-linux-x64-gnu'].version
    expect(linux).toBe(wanted)
  })

  it.skipIf(process.platform === 'win32')('release.yml fails an absolute link and passes a relative one', () => {
    const script = `set -euo pipefail\nworkdir="$1"\n${linkCheck()}\n`
    const bash = bashInterpreter()
    const appDir = (kind: 'absolute' | 'relative') => {
      const workdir = mkdtempSync(join(tmpdir(), `lu-gh191-${kind}-`))
      const squash = join(workdir, 'squashfs-root')
      mkdirSync(join(squash, 'usr/share/applications'), { recursive: true })
      writeFileSync(join(squash, 'Locally Uncensored.png'), 'png')
      writeFileSync(join(squash, 'usr/share/applications/Locally Uncensored.desktop'), '[Desktop Entry]')
      if (kind === 'absolute') {
        // What the old bundler wrote: the build machine's AppDir.
        const buildMachine = '/home/runner/work/lu/target/release/bundle/appimage/Locally Uncensored.AppDir'
        symlinkSync(`${buildMachine}/Locally Uncensored.png`, join(squash, '.DirIcon'))
        symlinkSync(`${buildMachine}/usr/share/applications/Locally Uncensored.desktop`, join(squash, 'Locally Uncensored.desktop'))
      } else {
        symlinkSync('Locally Uncensored.png', join(squash, '.DirIcon'))
        symlinkSync('usr/share/applications/Locally Uncensored.desktop', join(squash, 'Locally Uncensored.desktop'))
      }
      return workdir
    }
    const run = (workdir: string) => {
      try {
        return { code: 0, out: execFileSync(bash, ['-c', script, 'gh191', workdir], { encoding: 'utf8', stdio: 'pipe' }) }
      } catch (e) {
        const err = e as { status: number; stderr: string }
        return { code: err.status, out: String(err.stderr) }
      } finally {
        rmSync(workdir, { recursive: true, force: true })
      }
    }

    const absolute = run(appDir('absolute'))
    expect(absolute.code).not.toBe(0)
    expect(absolute.out).toMatch(/absolute path .*\(GH #191\)/)

    const relative = run(appDir('relative'))
    expect(relative.code, relative.out).toBe(0)
    expect(relative.out).toContain('OK: .DirIcon and the .desktop link are relative')
  })
})
