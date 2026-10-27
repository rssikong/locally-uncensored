import { test, expect, type Locator } from '@playwright/test'
import { Rec, HOWTO_OUT } from './rec'

// Where models go: Settings, AI Backends, Storage and the ComfyUI path.
// Captions are the panel's own statements (components/settings/SettingsPage.tsx):
//  - HfDownloadPathSetting: "LU downloads GGUFs here ... Leave it empty and LU
//    uses its own folder", the placeholder "LU's own folder: <path>"
//    (lib/model-storage-rows.ts), "Browse…" (pick_folder) and "Reset" (empties
//    the setting, nothing else).
//  - ImportLocalModels: "Scan for local models", "Link them into LU without
//    downloading or copying anything." The link is a hard link into the LU
//    Engine folder and needs both on one drive (src-tauri engine.rs
//    import_model_file and its error text), which is why the folder is reset
//    before the import here.
//  - ComfyUI section: "Installs to your home folder by default. Set Path above
//    (e.g. D:\ComfyUI) to install on another drive."
//
// FIXTURES (said in the report too), all in one initScript that wraps
// __TAURI_INTERNALS__.invoke:
//  - pick_folder answers D:\LU-Models: the system folder dialog cannot be
//    shown in the rig. The path is an example.
//  - list_bundled_models adds the `dirs` the real scan reports (the rig sends
//    none), so the empty field can name LU's own folder. Folder path is the
//    Windows default shape with an example user name.
//  - list_importable_models answers two example models, one per source, in
//    the stores the real scan reads (.ollama/models, .lmstudio/models).
//    Names, paths and sizes are examples.
//  - import_local_model answers success; no file is linked.
//  - runtime_folder_status (the "Voice and Python folder" row that 3.0.7 adds
//    to Storage) answers what runtime_folder.rs reports on a machine
//    where none of the three is installed yet: no folder chosen, the default
//    data folder, and the voice engine, LU's own Python and the read-aloud
//    voices each "Not installed". Without it the rig never answers and the
//    row would stand at "Looking for what is installed…". The user name in
//    the paths is an example.
test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

test('storage', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(120_000)
  // Scrolls the settings page so the element sits in the middle of the window.
  const center = (l: Locator) => l.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const rec = await Rec.boot(page, 'storage', 'Models on another drive', {
    mode: 'local',
    initScript: () => {
      type Bridge = { invoke: (cmd: string, args: { extraDirs?: string[] } | undefined) => Promise<unknown> }
      const bridge = (window as unknown as { __TAURI_INTERNALS__: Bridge }).__TAURI_INTERNALS__
      const invoke = bridge.invoke
      const own = 'C:\\Users\\demo\\AppData\\Roaming\\Locally Uncensored\\models'
      bridge.invoke = async (cmd, args) => {
        if (cmd === 'pick_folder') return 'D:\\LU-Models'
        if (cmd === 'list_bundled_models') {
          const res = (await invoke(cmd, args)) as Record<string, unknown>
          const extra = (args?.extraDirs ?? []).map((path) => ({ path, status: 'ok' }))
          return { ...res, dirs: [{ path: own, status: 'ok' }, ...extra] }
        }
        if (cmd === 'list_importable_models') {
          return {
            candidates: [
              { name: 'llama3.1:8b', source: 'ollama', path: 'C:\\Users\\demo\\.ollama\\models\\blobs\\sha256-example', size: 4_920_000_000, already_imported: false },
              { name: 'Mistral-7B-Instruct-v0.3.Q4_K_M', source: 'lmstudio', path: 'C:\\Users\\demo\\.lmstudio\\models\\example\\Mistral-7B-Instruct-v0.3.Q4_K_M.gguf', size: 4_370_000_000, already_imported: false },
            ],
          }
        }
        if (cmd === 'import_local_model') return { path: own + '\\llama3.1-8b.gguf' }
        if (cmd === 'runtime_folder_status') {
          const data = 'C:\\Users\\demo\\AppData\\Local\\lu-labs'
          const appData = 'C:\\Users\\demo\\AppData\\Roaming\\com.purpledoubled.locally-uncensored'
          const none = (kind: string, path: string) => ({ kind, path, installed: false, atTarget: true, bytes: 0 })
          return {
            chosen: null, defaultFolder: data, moving: false,
            entries: [none('voice', data + '\\voice'), none('python', data + '\\python'), none('piperVoices', appData + '\\piper_voices')],
          }
        }
        return invoke(cmd, args)
      }
    },
  })

  // Into Settings, AI Backends, with Providers folded and Storage open.
  // Done before the film starts, through the real controls.
  await page.getByRole('button', { name: 'Settings' }).first().click()
  await page.getByRole('button', { name: 'AI Backends', exact: true }).first().click()
  const providers = page.getByRole('button', { name: /^Providers/ }).first()
  if ((await providers.getAttribute('aria-expanded')) === 'true') await providers.click()
  const storage = page.getByRole('button', { name: /Storage/ }).first()
  if ((await storage.getAttribute('aria-expanded')) === 'false') await storage.click()
  const folder = page.getByLabel('LU Engine folder')
  await expect(folder).toHaveAttribute('placeholder', /LU's own folder: C:/)
  await page.mouse.move(1300, 700)
  await page.waitForTimeout(600)

  await rec.key()
  rec.scene('The LU Engine folder is where chat models download. Empty means LU\'s own folder.')
  await rec.cam(folder, 1.5)
  await rec.move(folder, { dur: 0.7, at: { fx: 0.4 } })
  rec.hold(1.5)

  rec.scene('Browse… picks a folder on another drive. Reset goes back to LU\'s own folder.')
  await rec.click(page.getByRole('button', { name: 'Browse…' }).first(), {
    dur: 0.6, after: 0.9,
    until: () => expect(folder).toHaveValue('D:\\LU-Models'),
  })
  await rec.click(page.getByRole('button', { name: 'Reset', exact: true }).first(), {
    dur: 0.5, after: 0.5,
    until: () => expect(folder).toHaveValue(''),
  })

  rec.scene('Scan for local models finds models you already have in Ollama or LM Studio.')
  const scan = page.getByRole('button', { name: 'Scan for local models' })
  // The Voice and Python folder row (3.0.7) pushes the scan to the foot of
  // the window: the page scrolls it to the middle (a cut, then a new photo),
  // so the models it finds show below it.
  await center(scan)
  await rec.key(300)
  await rec.cam(scan, 1.45)
  await rec.click(scan, {
    dur: 0.7, after: 0.8,
    until: () => expect(page.getByText('llama3.1:8b')).toBeVisible(),
  })

  rec.scene('Import links the file in, without a download or a copy. Both must be on one drive.')
  await rec.click(page.getByRole('button', { name: 'Import', exact: true }).first(), {
    dur: 0.6, after: 1.4,
    until: () => expect(page.getByText('Imported', { exact: true })).toBeVisible(),
  })

  // The ComfyUI section, opened with its own header.
  const comfy = page.getByRole('button', { name: /ComfyUI \(Image & Video\)/ }).first()
  await rec.cam('full', 1, 0.7)
  // The header sits below the window now: scrolled to the middle first.
  await center(comfy)
  await rec.key(300)
  if ((await comfy.getAttribute('aria-expanded')) === 'false') {
    await rec.click(comfy, { dur: 0.6, after: 0.2 })
  }
  rec.scene('For ComfyUI, type a Path on another drive before Install ComfyUI.')
  const path = page.getByPlaceholder(/ComfyUI/).last()
  // Path and the install line under it both in the middle of the window.
  await center(page.getByText('Installs to your home folder by default.'))
  await rec.key(400)
  await rec.cam(path, 1.45)
  await rec.click(path, { dur: 0.6, at: { fx: 0.2 }, after: 0.05 })
  await rec.move({ x: 1300, y: 760 }, { dur: 0.3, real: false })
  await rec.type(path, 'D:\\ComfyUI', { cps: 20 })
  await rec.move(page.getByText('Installs to your home folder by default.'), { dur: 0.6, at: { fx: 0.9, dy: 14 }, real: false })
  rec.hold(1.4)
  rec.finish(1.2)
})
