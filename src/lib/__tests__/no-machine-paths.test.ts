/**
 * Review N10: the repository is public. A home folder of a developer and the
 * address of a machine in somebody's home network do not belong into it.
 *
 * Held here for the code (src, src-tauri/src, the plugin, e2e, scripts). The
 * documents under mobile-docs still carry both and are listed in the review.
 *
 * Run: npx vitest run src/lib/__tests__/no-machine-paths.test.ts
 */
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..')
const SKIP = new Set(['node_modules', 'target', 'gen', 'build', 'dist', '.gradle', '.tauri', 'bin', 'icons', 'test-results'])

function files(dir: string): string[] {
  const out: string[] = []
  let names: string[] = []
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (SKIP.has(name) || name.startsWith('.')) continue
    const full = join(dir, name)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...files(full))
    else if (stat.size < 2_000_000 && /\.(ts|tsx|js|mjs|cjs|rs|kt|swift|sh|json|toml|md|html|css)$/.test(name)) out.push(full)
  }
  return out
}

// Built from pieces, so this file does not contain what it looks for.
const HOME = new RegExp(['', 'Users', 'purple'].join('/'))
const LAN = new RegExp(['192', '168', '0', '160'].join('\\.'))

describe('no machine path and no home network address in the code', () => {
  it('src, src-tauri/src, the plugin, e2e and scripts are free of both', () => {
    const roots = ['src', 'src-tauri/src', 'src-tauri/plugins', 'e2e', 'scripts']
    const all = roots.flatMap((r) => files(join(ROOT, r)))
    expect(all.length).toBeGreaterThan(500)
    const hits = all.filter((file) => {
      const text = readFileSync(file, 'utf8')
      return HOME.test(text) || LAN.test(text)
    }).map((file) => file.slice(ROOT.length + 1))
    expect(hits).toEqual([])
  })
})
