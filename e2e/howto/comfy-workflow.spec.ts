import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Rec, HOWTO_OUT } from './rec'

// Your own ComfyUI workflow in Create (3.0.7). Recorded on integ/307
// (ddeccc9ce), Local mode, platform windows. Facts, all from that head:
//  - components/create/WorkflowsModal.tsx: the Workflows view ("Workflows &
//    tags") reads "Import a ComfyUI workflow JSON, saved normally or with Save
//    (API Format). A normal save is read through the running ComfyUI, so start
//    it first." Buttons "Choose files" (several at once) and "Choose folder"
//    (every .json of the folder, sorted, each with its own line under
//    "Imported N of M"); a file is named after the file. A converted file says
//    "Converted from the regular ComfyUI format (...)". Every installed
//    workflow has "Compatibility tags"; the HowItWorks text of the same file:
//    a shared tag on a workflow and on a model is the whole pairing.
//  - api/workflow-import.ts readWorkflowText: API format as it is, the regular
//    format through /object_info/<Type> of the running ComfyUI; without an
//    answer COMFY_NOT_RUNNING ("ComfyUI has to be running ...").
//  - components/create/experimental/Composer.tsx: on the Image tab the
//    workflow button is the icon "Workflows and tags" (words only on Video,
//    Animate and Motion Control, OWN_WORKFLOW_INTENTS).
//  - components/create/experimental/AdvancedDrawer.tsx, WorkflowFinder.tsx:
//    Advanced settings, "Workflow": Auto ("Use the built-in workflow") or
//    every workflow whose tags the model carries.
//  - components/create/experimental/WorkflowParams.tsx: "Workflow
//    parameters", one folding row per node, a search, "Reset" ("Back to the
//    values in the workflow file"), a dot "Changed from the workflow file",
//    "Set by LU: ..." per node; api/workflow-params.ts luSetInputs: VAE and
//    text encoder show "Auto (LU picks a match)". Number limits come from the
//    node definition (ModelSamplingAuraFlow shift 0 to 100, step 0.01).
//  - stores/workflowStore.ts: changes are kept per workflow (paramOverrides);
//    hooks/useCreate.ts hands them to every run.
//
// Fixtures (nothing on the page is altered; all answers come before the app
// loads):
//  1. localStorage create-store: Local backend with Z-Image Turbo as the
//     image model, as an earlier session leaves it. Not real.
//  2. localStorage workflow-store: one tag "Z-Image", already given to the
//     model z_image_turbo_bf16.safetensors on the Models view; no workflow
//     installed. Not real: no such session happened.
//  3. ComfyUI (port 8188, reached through the Tauri command proxy_localhost,
//     as in character-local.spec.ts): /system_stats one 16 GB GPU;
//     /object_info the node definitions of the app's own test fixture
//     src/api/__tests__/fixtures/comfy-ui/object-info.json (checkpoints,
//     Z-Image Turbo, Wan 2.2, encoders, VAEs). Not real: no ComfyUI runs, no
//     file exists.
//  4. detect_gpus and sniff_model_files: one 16 GB card, no header sniffing.
//  5. The folder handed to Choose folder holds three workflow files in the
//     regular ComfyUI save format: the app's test fixtures
//     sdxl-txt2img.ui.json, wan22-i2v.ui.json and z-image-turbo.ui.json of
//     src/api/__tests__/fixtures/comfy-ui, unchanged, saved under example
//     names. The folder dialog itself cannot be shown in the rig.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const FIX = join(process.cwd(), 'src/api/__tests__/fixtures/comfy-ui')

test('comfy-workflow', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  // Fixture 5.
  const folder = join(process.env.LU_HOWTO_TMP ?? `/private/tmp/claude-501/howto-comfy-workflow-files`, 'My ComfyUI workflows')
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'SDXL text to image.json'), readFileSync(join(FIX, 'sdxl-txt2img.ui.json')))
  writeFileSync(join(folder, 'Wan 2.2 image to video.json'), readFileSync(join(FIX, 'wan22-i2v.ui.json')))
  writeFileSync(join(folder, 'Z-Image Turbo.json'), readFileSync(join(FIX, 'z-image-turbo.ui.json')))
  const objectInfo = JSON.parse(readFileSync(join(FIX, 'object-info.json'), 'utf8'))
  await page.addInitScript((defs) => { (window as unknown as { __howtoDefs: unknown }).__howtoDefs = defs }, objectInfo)

  const rec = await Rec.boot(page, 'comfy-workflow', 'Your own ComfyUI workflow', {
    mode: 'local',
    tauri: { platform: 'windows' },
    initScript: () => {
      const Z = 'z_image_turbo_bf16.safetensors'
      // Fixtures 1 and 2.
      if (!localStorage.getItem('create-store')) {
        localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', mode: 'image', imageModel: Z, imageModelType: 'zimage' }, version: 2 }))
      }
      if (!localStorage.getItem('workflow-store')) {
        localStorage.setItem('workflow-store', JSON.stringify({
          state: {
            tags: [{ id: 'tag-zimage', name: 'Z-Image', createdAt: 1760000000000 }],
            modelTags: { [`image:${Z}`]: ['tag-zimage'] },
            workflowTags: {}, installedWorkflows: [], managerNoticeSeen: true,
          },
          version: 0,
        }))
      }
      const w = window as unknown as { __howtoDefs: Record<string, unknown>; __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string }) => Promise<unknown> } }
      const nodes = w.__howtoDefs
      const bridge = w.__TAURI_INTERNALS__
      const invoke = bridge.invoke
      bridge.invoke = (command, args) => {
        // Fixture 4.
        if (command === 'sniff_model_files') return Promise.resolve([])
        if (command === 'detect_gpus') return Promise.resolve([{ index: 0, vendor: 'nvidia', name: 'GPU', memory_mib: 16384, source: 'fixture' }])
        if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
        // Fixture 3.
        const url = args.url
        if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'GPU', type: 'cuda', vram_total: 16 * 1024 ** 3 }] }))
        const one = /\/object_info\/([^/?]+)/.exec(url)
        if (one) {
          const type = decodeURIComponent(one[1])
          return Promise.resolve(JSON.stringify(type in nodes ? { [type]: nodes[type] } : {}))
        }
        if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(nodes))
        return Promise.resolve('{}')
      }
    },
  })
  await rec.openCreate('Image')
  const chip = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Z-Image/ })
  await expect(chip).toBeVisible({ timeout: 20_000 })
  const wfButton = page.getByRole('button', { name: 'Workflows and tags' })
  await expect(wfButton).toBeVisible()
  await page.mouse.move(980, 520)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('The workflow button opens Workflows. It takes a file saved with Save or Export in ComfyUI.')
  await rec.cam(wfButton, 1.4)
  await rec.click(wfButton, { dur: 0.8, settle: 700, after: 0.2 })
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Install a workflow')).toBeVisible()
  await rec.cam('full', 1, 0.8)
  const hint = dialog.getByText(/saved normally or with Save \(API Format\)/)
  await rec.move(hint, { dur: 0.7, at: { fx: 0.3, dy: 18 }, real: false })
  rec.hold(1.0)

  rec.scene('Choose folder imports every .json in it, each with its own line. ComfyUI has to run for this.')
  const choose = dialog.getByRole('button', { name: 'Choose folder' })
  const chooser = page.waitForEvent('filechooser')
  await rec.click(choose, { dur: 0.7, settle: 60, after: 0.1 })
  await (await chooser).setFiles(folder)
  const results = page.getByTestId('workflow-import-results')
  await expect(results).toContainText('Imported 3 of 3', { timeout: 15_000 })
  await rec.key(600)
  await rec.cam(results, 1.35, 0.8)
  await rec.move(results, { dur: 0.6, at: { fx: 0.6, fy: 0.9, dy: 14 }, real: false })
  rec.hold(1.4)

  rec.scene('Give the workflow the tag its model has. The shared tag pairs the two.')
  const row = dialog.locator('article').filter({ hasText: 'Z-Image Turbo' })
  await row.scrollIntoViewIfNeeded()
  await rec.key(400)
  const tag = row.getByRole('button', { name: 'Z-Image', exact: true })
  await rec.cam(tag, 1.4, 0.8)
  await rec.click(tag, { dur: 0.7, settle: 500, after: 0.3 })
  await expect(tag).toHaveAttribute('aria-pressed', 'true')
  rec.hold(0.7)

  rec.scene('In Advanced settings, pick it under Workflow instead of Auto.')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await rec.cam('full', 1, 0.8)
  await rec.key(400)
  await rec.click(page.getByRole('button', { name: 'Advanced settings' }), { dur: 0.7, settle: 900, after: 0.2 })
  const finder = page.getByText('Workflow', { exact: true })
  await finder.scrollIntoViewIfNeeded()
  const select = finder.locator('xpath=..').locator('button[aria-haspopup="listbox"]')
  await expect(select).toBeVisible()
  await rec.key(400)
  await rec.cam(select, 1.4, 0.8)
  await rec.click(select, { dur: 0.6, settle: 500, after: 0.2 })
  const option = page.getByRole('option', { name: /Z-Image Turbo/ })
  await rec.click(option, { dur: 0.6, settle: 700, after: 0.3 })
  const params = page.getByRole('region', { name: 'Workflow parameters' })
  await expect(params).toBeVisible({ timeout: 15_000 })

  rec.scene('Workflow parameters lists every node with its values. Change one, here the shift.')
  await params.scrollIntoViewIfNeeded()
  await rec.key(500)
  const shiftNode = params.getByRole('button', { name: /ModelSamplingAuraFlow/ })
  await rec.cam(shiftNode, 1.35, 0.8)
  await rec.click(shiftNode, { dur: 0.7, settle: 500, after: 0.2 })
  const shift = params.getByLabel('Shift')
  await expect(shift).toBeVisible()
  await rec.click(shift, { dur: 0.5, settle: 200, after: 0.05 })
  await shift.selectText()
  await rec.type(shift, '3.5', { cps: 8, band: { up: 120, down: 120 } })
  await expect(params.getByLabel('changed')).toBeVisible()
  await expect(shift).toHaveValue('3.5')
  rec.hold(0.3)

  rec.scene('The change goes into every run of this workflow. Reset goes back to the file.')
  const reset = params.getByRole('button', { name: 'Reset' })
  await rec.move(reset, { dur: 0.6 })
  await rec.key(400)
  rec.hold(1.5)
  rec.finish(0.8)
})
