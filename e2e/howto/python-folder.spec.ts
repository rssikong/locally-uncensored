import { test, expect } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// The Voice and Python folder (3.0.7): Settings, AI Backends, Model Storage.
// Captions are the row's own statements:
//  - components/settings/RuntimeFolderSetting.tsx: "Where LU keeps the voice
//    engine, the read-aloud voices and its own Python. Leave it empty and LU
//    uses its app data folder. Choosing a folder moves nothing: new installs
//    go there, and what is installed keeps working where it is until you move
//    it." Buttons "Browse…", "Reset", "Move to this folder", "Move now".
//  - lib/runtime-folder.ts: runtimeEntryNote ("Installed in the old folder
//    ... It keeps working there until you move it.", "Installed here",
//    "Installed in a folder chosen earlier ... It keeps working there."),
//    moveConfirmText (copies, checks the copy, starts it once, only then the
//    old files go to the Recycle Bin, nothing is deleted for good).
//  - src-tauri runtime_root.rs locations(): with no folder chosen (Reset) a
//    new install goes to the app data folder again (fix d4413d6ff); an install
//    in an earlier folder is still found and used there.
//
// FIXTURES (said in the report too), all in one initScript that wraps
// __TAURI_INTERNALS__.invoke, because the rig answers none of these:
//  - pick_folder answers D:\LU Runtime: the system folder dialog cannot be
//    shown in the rig. The path is an example.
//  - runtime_folder_status, set_runtime_folder and move_runtime_folder keep a
//    small state the way runtime_folder.rs builds it (entries in the order
//    voice, python, piperVoices; at_target = the path is the first location).
//    Paths are the Windows default shape (data_local_dir\lu-labs and the
//    Tauri app data folder for piper_voices) with an example user name;
//    sizes are examples. The move answers after 1.6 s with every entry
//    moved; nothing is copied.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test('python-folder', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  const rec = await Rec.boot(page, 'python-folder', 'Voice and Python on another drive', {
    mode: 'local',
    initScript: () => {
      type Bridge = { invoke: (cmd: string, args: { path?: string } | undefined) => Promise<unknown> }
      const bridge = (window as unknown as { __TAURI_INTERNALS__: Bridge }).__TAURI_INTERNALS__
      const invoke = bridge.invoke
      const local = 'C:\\Users\\demo\\AppData\\Local\\lu-labs'
      const roaming = 'C:\\Users\\demo\\AppData\\Roaming\\com.purpledoubled.locally-uncensored'
      const kinds = ['voice', 'python', 'piperVoices'] as const
      const sub = { voice: 'voice', python: 'python', piperVoices: 'piper_voices' }
      const bytes = { voice: 2_410_000_000, python: 118_000_000, piperVoices: 63_500_000 }
      const defaults = { voice: `${local}\\voice`, python: `${local}\\python`, piperVoices: `${roaming}\\piper_voices` }
      const where: Record<string, string> = { ...defaults }
      let chosen: string | null = null
      const status = () => ({
        chosen,
        defaultFolder: local,
        moving: false,
        entries: kinds.map((kind) => {
          const target = chosen ? `${chosen}\\${sub[kind]}` : defaults[kind]
          return { kind, path: where[kind], installed: true, atTarget: where[kind] === target, bytes: bytes[kind] }
        }),
      })
      bridge.invoke = async (cmd, args) => {
        if (cmd === 'pick_folder') return 'D:\\LU Runtime'
        if (cmd === 'runtime_folder_status') return status()
        if (cmd === 'set_runtime_folder') {
          const p = (args?.path ?? '').trim()
          chosen = p || null
          return status()
        }
        if (cmd === 'move_runtime_folder') {
          await new Promise((r) => setTimeout(r, 1600))
          return kinds.map((kind) => {
            const from = where[kind]
            const to = `${chosen}\\${sub[kind]}`
            where[kind] = to
            return { kind, from, to, status: 'moved', detail: '' }
          })
        }
        return invoke(cmd, args)
      }
    },
  })

  // Into Settings, AI Backends, with Providers folded and Model Storage open.
  // Done before the film starts, through the real controls.
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('button', { name: 'AI Backends', exact: true }).first().click()
  const providers = page.getByRole('button', { name: /^Providers/ }).first()
  if ((await providers.getAttribute('aria-expanded')) === 'true') await providers.click()
  const storage = page.getByRole('button', { name: /Model Storage/ }).first()
  if ((await storage.getAttribute('aria-expanded')) === 'false') await storage.click()
  const row = page.getByTestId('runtime-folder-setting')
  const field = page.getByLabel('Voice and Python folder')
  const entries = page.getByTestId('runtime-folder-entries')
  await expect(field).toHaveAttribute('placeholder', /LU's app data folder: C:/)
  await expect(entries).toContainText('Installed here')
  await row.scrollIntoViewIfNeeded()
  await page.mouse.move(1400, 860)
  await page.waitForTimeout(600)

  await rec.key()
  rec.scene('Voice and Python folder holds the voice engine, the read-aloud voices and LU\'s own Python.')
  await rec.cam(row, 1.5)
  await rec.move(field, { dur: 0.7, at: { fx: 0.4 } })
  rec.hold(1.6)

  rec.scene('Browse… picks a folder. Choosing it moves nothing, what is installed keeps working.')
  await rec.click(row.getByRole('button', { name: 'Browse…' }), {
    dur: 0.6, after: 0.6,
    until: () => expect(entries).toContainText('Installed in the old folder'),
  })
  await rec.move(entries, { dur: 0.6, at: { fx: 0.9, fy: 0.3 }, real: false })
  rec.hold(1.4)

  rec.scene('Move to this folder copies the files, checks the copy and starts it once there.')
  await rec.click(page.getByTestId('runtime-folder-move'), {
    dur: 0.6, after: 0.3,
    until: () => expect(page.getByTestId('runtime-folder-confirm')).toBeVisible(),
  })
  // The button the cursor was on is gone; park it beside the confirmation.
  await rec.move(row.getByRole('button', { name: 'Move now' }), { dur: 0.5, at: { fx: 1, dx: 220 }, real: false })
  rec.hold(1.2)

  rec.scene('Only then do the old files go to the Recycle Bin. Nothing is deleted for good.')
  await rec.click(row.getByRole('button', { name: 'Move now' }), {
    dur: 0.5, after: 1.6,
    until: () => expect(page.getByTestId('runtime-folder-outcomes')).toContainText('Voice engine: moved to D:\\LU Runtime\\voice.'),
  })
  await expect(entries).toContainText('Installed here')

  rec.scene('Reset sends new installs to the app data folder again. Moved ones keep working.')
  await rec.click(row.getByRole('button', { name: 'Reset', exact: true }), {
    dur: 0.5, after: 0.4,
    until: () => expect(entries).toContainText('Installed in a folder chosen earlier'),
  })
  await rec.move(entries, { dur: 0.6, at: { fx: 0.9, fy: 0.3 }, real: false })
  rec.hold(1.6)
  rec.finish(1.2)
})
