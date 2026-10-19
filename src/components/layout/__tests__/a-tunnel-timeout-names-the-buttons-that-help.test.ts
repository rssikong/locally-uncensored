/**
 * 3.0.7: when no tunnel URL appeared within 15 s, the error said "click
 * Restart". Restart tears the tunnel down and starts only the server
 * (remoteStore.restart sets tunnelActive false and never calls startTunnel),
 * so the advice led nowhere. What builds a tunnel is Dispatch, Internet,
 * after Stop. The text now says that, with the buttons as the Sidebar names
 * them.
 *
 * Run: npx vitest run src/components/layout/__tests__/a-tunnel-timeout-names-the-buttons-that-help.test.ts
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(__dirname, '..', '..', '..', '..')
const RUST = fs.readFileSync(path.join(ROOT, 'src-tauri', 'src', 'commands', 'remote.rs'), 'utf8')
const SIDEBAR = fs.readFileSync(path.join(ROOT, 'src', 'components', 'layout', 'Sidebar.tsx'), 'utf8')
const STORE = fs.readFileSync(path.join(ROOT, 'src', 'stores', 'remoteStore.ts'), 'utf8')

const timeoutText = (() => {
  const a = RUST.indexOf('"Cloudflare tunnel started but no public URL appeared within 15 s')
  const b = RUST.indexOf('",', a)
  if (a < 0 || b < 0) throw new Error('timeout text missing in remote.rs')
  return RUST.slice(a, b)
})()

describe('the tunnel timeout error', () => {
  it('sends the user to Stop, then Dispatch, Internet', () => {
    expect(timeoutText).toContain('click Stop and start again with Dispatch, Internet')
  })

  // Negative control: the advice that did not work is gone, and so is the dash.
  it('no longer says Restart, and has no dash', () => {
    expect(timeoutText).not.toMatch(/Restart/)
    expect(timeoutText).not.toMatch(/[–—]/)
  })

  it('names buttons the Sidebar really has', () => {
    for (const label of ['Stop', 'Dispatch', 'Internet']) {
      expect(SIDEBAR, `no ${label} button in the Sidebar`).toMatch(new RegExp(`>\\s*${label}\\s*<|'${label}'`))
    }
  })

  it('still holds: Restart does not bring the tunnel back', () => {
    const restart = STORE.slice(STORE.indexOf("'restart_remote_server'"), STORE.indexOf('get().fetchQrCode()', STORE.indexOf("'restart_remote_server'")))
    expect(restart).toContain('tunnelActive: false')
    expect(restart).not.toContain('startTunnel')
  })
})
