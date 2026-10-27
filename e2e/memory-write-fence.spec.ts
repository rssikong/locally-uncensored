import { expect, test } from '@playwright/test'
import { DEFAULT_MODEL_NAME } from './support/tauri-mock'
import { appModules, type AppWindow } from './support/ui'

// The app's own port, from the configured baseURL, so a second config on another port still works.
const appPort = () => new URL(test.info().project.use.baseURL ?? 'http://localhost:5273').port

test('deleting through Memory Settings survives a late automatic extraction and reload', async ({ page }) => {
  await page.route('**/*', route => new URL(route.request().url()).port === appPort() ? route.continue() : route.abort())
  await page.goto('/e2e/memory-sensitive-proof.html')
  await appModules(page, ['/src/stores/memoryStore.ts', '/src/stores/modelStore.ts', '/src/stores/settingsStore.ts', '/src/api/providers/index.ts', '/src/hooks/useMemory.ts'])
  await page.evaluate(async (modelName) => {
    const memory = (window as unknown as AppWindow).__APP__['/src/stores/memoryStore.ts'] as typeof import('../src/stores/memoryStore')
    const model = (window as unknown as AppWindow).__APP__['/src/stores/modelStore.ts'] as typeof import('../src/stores/modelStore')
    const settings = (window as unknown as AppWindow).__APP__['/src/stores/settingsStore.ts'] as typeof import('../src/stores/settingsStore')
    const providers = (window as unknown as AppWindow).__APP__['/src/api/providers/index.ts'] as typeof import('../src/api/providers')
    const hook = (window as unknown as AppWindow).__APP__['/src/hooks/useMemory.ts'] as typeof import('../src/hooks/useMemory')
    await model.useModelStore.persist.rehydrate()
    await settings.useSettingsStore.persist.rehydrate()
    model.useModelStore.setState({ activeModel: modelName })
    settings.useSettingsStore.getState().updateSettings({ contextWindowOverride: 8192 })
    memory.useMemoryStore.getState().updateMemorySettings({ autoExtractEnabled: true, autoExtractInAllModes: true })
    memory.useMemoryStore.getState().addMemory({ title: 'Private original', content: 'Private original fact', description: '', type: 'user', tags: [], source: 'manual' })
    const { provider } = providers.getProviderForModel(modelName)
    const original = provider.chatStream
    const gate = new Promise<void>(resolve => { Reflect.set(window, 'releaseMemoryExtraction', resolve) })
    provider.chatStream = async function* () {
      document.body.dataset.extraction = 'waiting'
      await gate
      yield { content: JSON.stringify({ shouldSave: true, memories: [{ type: 'user', title: 'Private restored', content: 'Private original fact', description: '', tags: [] }] }), done: true }
    }
    const pending = (async () => {
      try {
        for (let i = 0; i < 3; i++) await hook.extractMemoriesFromPair('Remember this fact', 'Synthetic response. '.repeat(20), 'proof-conversation', {})
      } finally { provider.chatStream = original }
    })()
    Reflect.set(window, 'pendingMemoryExtraction', pending)
  }, DEFAULT_MODEL_NAME)
  await expect(page.locator('body')).toHaveAttribute('data-extraction', 'waiting')
  await page.getByTitle('Delete this memory', { exact: true }).click()
  await page.getByTitle('Click again to delete', { exact: true }).click()
  await page.evaluate(async () => {
    const release: unknown = Reflect.get(window, 'releaseMemoryExtraction')
    if (typeof release !== 'function') throw new Error('Missing fixture release')
    release()
    await Reflect.get(window, 'pendingMemoryExtraction')
  })
  await expect(page.getByTitle('Delete this memory', { exact: true })).toHaveCount(0)
  // Ordinary Zustand persistence is asynchronous. Observe the committed
  // value before testing reload, rather than racing navigation against it.
  await appModules(page, ['/src/lib/idbStorage.ts'])
  await expect.poll(() => page.evaluate(async () => {
    const { idbStorage } = (window as unknown as AppWindow).__APP__['/src/lib/idbStorage.ts'] as typeof import('../src/lib/idbStorage')
    const raw = await idbStorage.getItem('locally-uncensored-memory')
    if (!raw) return -1
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return -1
    const state: unknown = Reflect.get(parsed, 'state')
    if (typeof state !== 'object' || state === null) return -1
    const entries: unknown = Reflect.get(state, 'entries')
    return Array.isArray(entries) ? entries.length : -1
  })).toBe(0)
  await page.reload()
  await expect(page.getByTitle('Delete this memory', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Preview AI memory context' }).click()
  await expect(page.locator('#result')).toHaveText('No eligible memories')
})
