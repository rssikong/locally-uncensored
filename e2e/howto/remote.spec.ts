import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'
import { qrPngBase64 } from './remote-fx'

// Setting up Remote Access: the parts a user would not find alone. Captions
// come from Sidebar.tsx (Remote tab, Dispatch, LAN / Internet, folder pick,
// LIVE panel, QR modal), remoteStore.ts, RemoteAccessSettings.tsx and
// src-tauri/src/commands/remote.rs.
//
// FIXTURES (said in the report too). The rig has no Rust side, so every
// Remote command would come back empty and Dispatch would stop at the folder
// pick. One initScript wraps window.__TAURI_INTERNALS__.invoke for exactly
// these commands and hands every other one to the rig's mock unchanged:
//  - pick_folder: the system folder dialog cannot be filmed; it answers as if
//    the example folder /Users/alex/projects/notes-app had been chosen.
//  - set_chat_workspace_override: accepts that folder, as the Rust side does
//    for an allowed project folder.
//  - start_remote_server: answers like remote.rs does after a start, with the
//    example LAN address 192.168.1.20, port 11435, an example passcode and an
//    expiry 15 minutes ahead (PASSCODE_TTL_SECS = 900), permissions all off.
//  - remote_qr_code: a real QR of http://192.168.1.20:11435/mobile, drawn by
//    ./remote-fx.ts. Like remote.rs it holds the address only, no passcode.
//  - remote_connected_devices: no phone paired yet (empty list), so the LIVE
//    panel stays up as it does until a phone signs in.
//  - remote_server_status: reports the running example server and the four
//    permissions off, the way the Rust default (all false) reads.
// The phone page is not in the film.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test('remote', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  // FIXTURE: the QR picture for remote_qr_code, put on window before the app
  // loads so the invoke wrapper below can hand it out.
  await page.addInitScript((qr) => { (window as unknown as { __HOWTO_QR__: string }).__HOWTO_QR__ = qr }, qrPngBase64('http://192.168.1.20:11435/mobile'))
  const rec = await Rec.boot(page, 'remote', 'Set up Remote Access', {
    mode: 'local',
    // FIXTURE: the Remote commands listed at the top of this file.
    initScript: () => {
      const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (cmd: string, args: unknown) => Promise<unknown> }; __HOWTO_QR__: string }
      const inner = w.__TAURI_INTERNALS__.invoke.bind(w.__TAURI_INTERNALS__)
      const lan = 'http://192.168.1.20:11435'
      const code = '482913'
      const perms = { filesystem: false, downloads: false, process_control: false, shell: false }
      let running = false
      let expires = 0
      w.__TAURI_INTERNALS__.invoke = (cmd: string, args: unknown) => {
        switch (cmd) {
          case 'pick_folder': return Promise.resolve('/Users/alex/projects/notes-app')
          case 'set_chat_workspace_override': return Promise.resolve(null)
          case 'start_remote_server':
            running = true
            expires = Math.floor(Date.now() / 1000) + 900
            return Promise.resolve({ port: 11435, passcode: code, passcodeExpiresAt: expires, lanUrl: lan, mobileUrl: `${lan}/mobile`, permissions: perms })
          case 'remote_qr_code': return Promise.resolve({ qr_png_base64: w.__HOWTO_QR__, url: `${lan}/mobile`, passcode: code })
          case 'remote_connected_devices': return Promise.resolve([])
          case 'remote_server_status':
            return Promise.resolve({
              running, lifecycleBusy: false, port: 11435,
              passcode: running ? code : '', passcodeExpiresAt: running ? expires : 0,
              lanUrl: running ? lan : '', mobileUrl: running ? `${lan}/mobile` : '',
              tunnelActive: false, tunnelUrl: '', permissions: perms,
            })
        }
        return inner(cmd, args)
      }
    },
  })

  // Before the film: the sidebar opened from its rail through its own button.
  await page.getByRole('button', { name: 'Expand sidebar' }).click()
  await page.waitForTimeout(600)
  const side = page.locator('aside').first()
  const remoteTab = side.getByRole('button', { name: /^Remote$/ })
  await expect(remoteTab).toBeVisible({ timeout: 15_000 })

  await rec.key()
  rec.scene('Remote access starts in the Remote tab of the sidebar.')
  await rec.cam({ x: 200, y: 300 }, 1.5)
  await rec.click(remoteTab, { dur: 0.8, after: 0.6 })

  rec.scene('Dispatch splits in two: LAN for your own network, Internet for anywhere.')
  const dispatch = side.getByRole('button', { name: 'Dispatch' })
  await rec.cam(dispatch, 1.6)
  await rec.click(dispatch, { dur: 0.8, after: 0.9 })
  rec.hold(0.4)

  rec.scene('You pick a working folder, then a LIVE panel shows a QR code and a six-digit passcode.')
  await rec.click(side.getByRole('button', { name: 'LAN', exact: true }), {
    dur: 0.6, after: 0.2,
    until: () => expect(side.getByText('LIVE', { exact: true })).toBeVisible({ timeout: 15_000 }),
  })
  await rec.cam(side.getByText('LIVE', { exact: true }), 1.6)
  rec.hold(2.2)

  rec.scene('The QR only carries the address; the passcode is typed on the phone.')
  await rec.click(side.getByRole('img', { name: 'QR' }), {
    dur: 0.6, after: 0.2,
    until: () => expect(page.getByText('Scan the QR or enter the 6-digit code on your phone.')).toBeVisible(),
  })
  await rec.cam('full')
  rec.hold(2.0)

  rec.scene('Under Settings, Voice & Remote, four permission switches start off and apply to every paired device.')
  await rec.click(page.getByRole('button', { name: 'Close', exact: true }).nth(1), { dur: 0.5, after: 0.1 })
  await rec.click(page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }), { dur: 0.6, after: 0.2 })
  await rec.click(page.getByRole('button', { name: 'Voice & Remote' }).first(), { dur: 0.6, after: 0.2 })
  const section = page.getByRole('button', { name: 'Remote Access', exact: true })
  await rec.click(section, {
    dur: 0.6, after: 0.2,
    until: () => expect(page.getByText('Shell & Code Execution')).toBeVisible(),
  })
  // Labels on the left, switches on the right: the camera sits between them.
  await rec.cam({ x: 850, y: 640 }, 1.4)
  rec.hold(2.4)
  rec.finish(1.0)
})
