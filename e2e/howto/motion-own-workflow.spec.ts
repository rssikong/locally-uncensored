import { test, expect } from '@playwright/test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { Rec, HOWTO_OUT } from './rec'

// Your own ComfyUI workflow in Motion Control (3.0.7). Recorded on integ/307
// (ddeccc9ce), Local mode, platform windows. Facts, all from that head:
//  - components/create/experimental/Composer.tsx: on Video, Animate and
//    Motion Control (OWN_WORKFLOW_INTENTS) the workflow button carries the
//    words "Use your own ComfyUI workflow" and opens the Workflows view.
//  - components/create/WorkflowsModal.tsx: "Choose files"; a file in the
//    regular ComfyUI save format says "Converted from the regular ComfyUI
//    format (...)"; "Compatibility tags" per workflow, a shared tag pairs
//    workflow and model.
//  - api/workflows.ts parseImportedWorkflow / detectModelTypes: a Wan Animate
//    graph is filed as a video workflow of the Wan Animate family; the model
//    is read from the GGUF loader, the clip from Video Helper Suite's Load
//    Video (commit 003959f4a; test wan-animate-example-imports-and-fills).
//  - components/create/experimental/AdvancedDrawer.tsx: on Motion Control the
//    Workflow picker and Workflow parameters belong to the Motion Control
//    model (resolveLocalOpPick); WorkflowFinder.tsx files it under Video.
//  - hooks/useCreate.ts (localOp 'motion', laneWf) and api/workflows.ts
//    injectLaneParameters: the picked workflow runs instead of LU's graph;
//    LU fills in model, prompt, seed, character picture and driving video and
//    leaves the rest as saved, then applies the values changed under Workflow
//    parameters (applyParamOverrides, commit adaf10fda).
//  - CHANGELOG 3.0.7: checked with tests on the Wan 2.2 Animate example
//    workflow, not yet in a real run against ComfyUI. So the film shows the
//    controls and makes no run.
//
// Fixtures (nothing on the page is altered; all answers come before the app
// loads):
//  1. localStorage create-store: Local backend, as an earlier session leaves
//     it. Not real.
//  2. localStorage workflow-store: one tag "Wan Animate", already given to the
//     model Wan2.2-Animate-14B-Q4_K_M.gguf on the Models view; no workflow
//     installed. Not real.
//  3. ComfyUI (port 8188, through the Tauri command proxy_localhost, as in
//     character-local.spec.ts): /system_stats one 24 GB GPU; /object_info the
//     app's test fixture src/api/__tests__/fixtures/comfy-ui/object-info.json,
//     plus the GGUF loader listing Wan2.2-Animate-14B-Q4_K_M.gguf, plus, for
//     the node types of the workflow file, definitions built from the sockets
//     the file itself lists, the way
//     src/api/__tests__/wan-animate-example-imports-and-fills.test.ts builds
//     them (that test says what this does and does not prove). Not real: no
//     ComfyUI runs, no file exists, no node pack is installed.
//  4. detect_gpus and sniff_model_files: one 24 GB card, no header sniffing.
//  5. The file handed to Choose files is the Wan 2.2 Animate example workflow
//     of the app's import fixtures (fixtures/wan-animate/wan-animate-native.ui.json,
//     unchanged, see its SOURCE.md), saved as "Wan 2.2 Animate.json" so the
//     original file name stays out of the picture.
test.use({ viewport: { width: 1200, height: 1020 }, deviceScaleFactor: 2 })

const FIX = join(process.cwd(), 'src/api/__tests__/fixtures')
const MODEL = 'Wan2.2-Animate-14B-Q4_K_M.gguf'

type Socket = { name: string; type: string; widget?: unknown; shape?: number }

/** Node definitions as the file's own sockets describe them (the test's defsFromFile). */
function defsFromFile(file: { nodes: Array<{ type: string; inputs?: Socket[] }> }): Record<string, unknown> {
  const OUTPUT = new Set(['VHS_VideoCombine', 'PreviewAnimation', 'PreviewImage', 'SaveImage'])
  const CANVAS = new Set(['Reroute', 'SetNode', 'GetNode', 'Note', 'MarkdownNote', 'PrimitiveNode'])
  const defs: Record<string, unknown> = {}
  for (const node of file.nodes) {
    if (CANVAS.has(node.type) || defs[node.type]) continue
    const required: Record<string, unknown> = {}
    const optional: Record<string, unknown> = {}
    const inputs = node.inputs ?? []
    const upload = inputs.some((i) => /UPLOAD$/.test(i.type))
    let firstCombo = true
    for (const input of inputs) {
      if (/UPLOAD$/.test(input.type)) continue
      const opts: Record<string, unknown> = {}
      if (upload && input.widget && input.type === 'COMBO' && firstCombo) { opts.image_upload = true; firstCombo = false }
      const spec = input.widget ? [input.type, opts] : [input.type]
      if (!input.widget && input.shape === 7) optional[input.name] = spec
      else required[input.name] = spec
    }
    defs[node.type] = { input: { required, optional }, output_node: OUTPUT.has(node.type) }
  }
  return defs
}

test('motion-own-workflow', async ({ page }) => {
  test.skip(!HOWTO_OUT, 'set LU_HOWTO_OUT')
  test.setTimeout(150_000)
  // Fixture 5.
  const dir = process.env.LU_HOWTO_TMP ?? '/private/tmp/claude-501/howto-motion-own-workflow-files'
  mkdirSync(dir, { recursive: true })
  const text = readFileSync(join(FIX, 'wan-animate/wan-animate-native.ui.json'), 'utf8')
  const wfFile = join(dir, 'Wan 2.2 Animate.json')
  writeFileSync(wfFile, text)
  // Fixture 3: the app's object_info fixture, the file's own node types on top.
  const defs = {
    ...JSON.parse(readFileSync(join(FIX, 'comfy-ui/object-info.json'), 'utf8')),
    ...defsFromFile(JSON.parse(text)),
  } as Record<string, unknown>
  defs.UnetLoaderGGUF = { input: { required: { unet_name: [[MODEL]] } }, output: ['MODEL'], output_node: false }
  await page.addInitScript((d) => { (window as unknown as { __howtoDefs: unknown }).__howtoDefs = d }, defs)

  const rec = await Rec.boot(page, 'motion-own-workflow', 'Your own workflow in Motion Control', {
    mode: 'local',
    tauri: { platform: 'windows' },
    initScript: () => {
      const M = 'wan2.2-animate-14b-q4_k_m.gguf'
      // Fixtures 1 and 2.
      if (!localStorage.getItem('create-store')) {
        localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', imageModel: 'sd_xl_base_1.0.safetensors', imageModelType: 'sdxl' }, version: 2 }))
      }
      if (!localStorage.getItem('workflow-store')) {
        localStorage.setItem('workflow-store', JSON.stringify({
          state: {
            tags: [{ id: 'tag-wan-animate', name: 'Wan Animate', createdAt: 1760000000000 }],
            modelTags: { [`video:${M}`]: ['tag-wan-animate'] },
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
        if (command === 'detect_gpus') return Promise.resolve([{ index: 0, vendor: 'nvidia', name: 'GPU', memory_mib: 24576, source: 'fixture' }])
        if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
        const url = args.url
        if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'GPU', type: 'cuda', vram_total: 24 * 1024 ** 3 }] }))
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
  await rec.openCreate('Motion Control')
  const own = page.getByRole('button', { name: 'Use your own ComfyUI workflow' })
  await expect(own).toBeVisible({ timeout: 20_000 })
  const chip = page.locator('button[aria-haspopup="listbox"]').filter({ hasText: /Animate/ })
  await expect(chip).toBeVisible({ timeout: 20_000 })
  await page.mouse.move(980, 520)

  await rec.key(700)
  rec.hold(0.3)
  rec.scene('On Motion Control, Use your own ComfyUI workflow opens Workflows.')
  await rec.cam(own, 1.4)
  await rec.move(own, { dur: 0.8 })
  rec.hold(0.5)
  await rec.click(own, { dur: 0.3, settle: 700, after: 0.2 })
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Install a workflow')).toBeVisible()
  await rec.cam('full', 1, 0.8)

  rec.scene('Import your Wan 2.2 Animate workflow as ComfyUI saved it.')
  const choose = dialog.getByRole('button', { name: 'Choose files' })
  const chooser = page.waitForEvent('filechooser')
  await rec.click(choose, { dur: 0.7, settle: 60, after: 0.1 })
  await (await chooser).setFiles(wfFile)
  const ok = dialog.getByText(/Installed "Wan 2\.2 Animate"/)
  await expect(ok).toBeVisible({ timeout: 15_000 })
  await rec.key(600)
  await rec.cam(ok, 1.35, 0.8)
  await rec.move(ok, { dur: 0.6, at: { fx: 0.5, dy: 20 }, real: false })
  rec.hold(1.2)

  rec.scene('Give it the tag of your Wan Animate model.')
  const row = dialog.locator('article').filter({ hasText: 'Wan 2.2 Animate' })
  await row.scrollIntoViewIfNeeded()
  await rec.key(400)
  const tag = row.getByRole('button', { name: 'Wan Animate', exact: true })
  await rec.cam(tag, 1.4, 0.8)
  await rec.click(tag, { dur: 0.7, settle: 500, after: 0.3 })
  await expect(tag).toHaveAttribute('aria-pressed', 'true')
  rec.hold(0.6)

  rec.scene('In Advanced settings, pick it under Workflow for the Motion Control model.')
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
  await rec.click(page.getByRole('option', { name: /Wan 2\.2 Animate/ }), { dur: 0.6, settle: 700, after: 0.3 })
  const params = page.getByRole('region', { name: 'Workflow parameters' })
  await expect(params).toBeVisible({ timeout: 15_000 })

  rec.scene('LU fills in model, seed, picture and clip, the rest runs as saved. A value you change here goes in too.')
  const search = params.getByRole('searchbox', { name: 'Search workflow parameters' })
  await page.waitForTimeout(800)
  await search.scrollIntoViewIfNeeded()
  await rec.key(500)
  await rec.cam(search, 1.35, 0.8)
  await rec.click(search, { dur: 0.6, settle: 200, after: 0.05 })
  await rec.type(search, 'strength', { cps: 14, band: { up: 120, down: 260 } })
  const strength = params.getByLabel('Strength model')
  await expect(strength).toBeVisible()
  await rec.click(strength, { dur: 0.5, settle: 200, after: 0.05 })
  await strength.selectText()
  await rec.type(strength, '0.8', { cps: 8, band: { up: 120, down: 120 } })
  await expect(strength).toHaveValue('0.8')
  await expect(params.getByLabel('changed')).toBeVisible()
  rec.hold(1.6)
  rec.finish(0.8)
})
