import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { tauriMockInit, DEFAULT_ASSISTANT_REPLY, DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { seedOnboardingDone } from './support/cloud-mock'

/**
 * GitHub wish #8 in the running app: an imported workflow shows its values
 * under "Workflow parameters" in the advanced settings of Create (Windows,
 * local; a Mac runs MLX and shows no workflow rows at all).
 *
 * The workflow is seeded into the persisted workflow store and assigned to
 * every model type, so whichever image model the mock offers uses it.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const GRAPH = JSON.parse(readFileSync(join(HERE, '../src/api/__tests__/fixtures/workflow-params/sdxl-lora-vae.api.json'), 'utf8'))
const OBJECT_INFO = JSON.parse(readFileSync(join(HERE, '../src/api/__tests__/fixtures/comfy-ui/object-info.json'), 'utf8'))
OBJECT_INFO.CheckpointLoaderSimple = { input: { required: { ckpt_name: [['juggernautXL.safetensors']] } } }
const TYPES = ['flux', 'flux2', 'krea2', 'zimage', 'sdxl', 'sd15', 'sd3', 'chroma', 'unknown']

async function seedWorkflow(page: Page) {
  await page.addInitScript(({ graph, types }) => {
    const template = {
      id: 'wf-e2e', name: 'My SDXL', description: '', source: 'manual', modelTypes: ['sdxl'], mode: 'image',
      workflow: graph,
      parameterMap: {
        model: { nodeId: '4', inputKey: 'ckpt_name', loaderType: 'checkpoint' },
        positivePrompt: { nodeId: '6', inputKey: 'text' }, negativePrompt: { nodeId: '7', inputKey: 'text' },
        seed: { nodeId: '3', inputKey: 'seed' }, steps: { nodeId: '3', inputKey: 'steps' },
        cfgScale: { nodeId: '3', inputKey: 'cfg' }, sampler: { nodeId: '3', inputKey: 'sampler_name' },
        scheduler: { nodeId: '3', inputKey: 'scheduler' }, width: { nodeId: '5', inputKey: 'width' },
        height: { nodeId: '5', inputKey: 'height' }, batchSize: { nodeId: '5', inputKey: 'batch_size' },
      },
      installedAt: 1,
    }
    window.localStorage.setItem('workflow-store', JSON.stringify({
      state: {
        installedWorkflows: [template],
        modelTypeAssignments: Object.fromEntries(types.map((t: string) => [t, 'wf-e2e'])),
        modelNameAssignments: {}, tags: [], workflowTags: {}, modelTags: {},
        civitaiHost: 'civitai.com', managerNoticeSeen: true, paramOverrides: {},
      },
      version: 0,
    }))
  }, { graph: GRAPH, types: TYPES })
}

/** A ComfyUI that answers through proxy_localhost, as in lora-stack-follows-the-folder.spec.ts. */
async function fakeComfy(page: Page) {
  await page.addInitScript((all: Record<string, unknown>) => {
    localStorage.setItem('create-store', JSON.stringify({ state: { backend: 'local', imageModel: 'juggernautXL.safetensors' }, version: 2 }))
    const w = window as unknown as { __TAURI_INTERNALS__: { invoke: (c: string, a: { url?: string }) => Promise<unknown> } }
    const bridge = w.__TAURI_INTERNALS__
    const invoke = bridge.invoke
    bridge.invoke = (command, args) => {
      if (command === 'sniff_model_files') return Promise.resolve([])
      if (command !== 'proxy_localhost' || !args?.url?.includes(':8188')) return invoke(command, args)
      const url = args.url
      if (url.includes('/system_stats')) return Promise.resolve(JSON.stringify({ devices: [{ name: 'RTX 3060', type: 'cuda', vram_total: 12 * 1024 ** 3 }] }))
      const one = /\/object_info\/([^/?]+)/.exec(url)
      if (one) return Promise.resolve(JSON.stringify(one[1] in all ? { [one[1]]: all[one[1]] } : {}))
      if (url.includes('/object_info')) return Promise.resolve(JSON.stringify(all))
      return Promise.resolve('{}')
    }
  }, OBJECT_INFO)
}

function drawer(page: Page) {
  return page.locator('aside').filter({ hasText: 'Advanced settings' })
}

test('an imported workflow lists its values, a change shows, Reset clears it', async ({ page }) => {
  await page.addInitScript(tauriMockInit, { assistantReply: DEFAULT_ASSISTANT_REPLY, modelName: DEFAULT_MODEL_NAME, platform: 'windows' as const })
  await seedOnboardingDone(page)
  await seedWorkflow(page)
  await fakeComfy(page)
  await page.goto('/')
  await page.getByRole('button', { name: /^Create$/ }).first().click()
  await page.getByRole('radio', { name: 'Image', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced settings' }).click()

  const list = drawer(page).getByRole('region', { name: 'Workflow parameters' })
  await expect(list).toBeVisible({ timeout: 15_000 })
  await list.getByRole('button', { name: /Detail LoRA/ }).click()
  await list.getByLabel('Strength model').fill('0.4')
  await expect(list.getByText('1 changed').first()).toBeVisible()
  await list.getByRole('button', { name: /^Sampler/ }).click()
  await expect(list.getByText('Set by LU: Seed, Steps, CFG, Sampler, Scheduler')).toBeVisible()
  await list.scrollIntoViewIfNeeded()
  await page.screenshot({ path: process.env.LU_SHOT ?? 'test-results/workflow-params.png' })

  await list.getByRole('button', { name: /Reset/ }).click()
  await expect(list.getByLabel('Strength model')).toHaveValue('0.8')
})
