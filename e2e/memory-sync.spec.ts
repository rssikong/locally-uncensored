import { expect, test, type Page } from '@playwright/test'
import type { SyncedMemoryRecord } from '../src/api/cloud/memory-sync'
import { isRecord } from './support/recorded'
import { appModules, type AppWindow } from './support/ui'

// The app's own port, from the configured baseURL, so a second config on another port still works.
const appPort = () => new URL(test.info().project.use.baseURL ?? 'http://localhost:5273').port

async function accountFixture(page: Page) {
  await appModules(page, ['/src/stores/cloudAuthStore.ts', '/src/api/cloud/supabase.ts'])
  await page.evaluate(() => {
    const { useCloudAuthStore } = (window as unknown as AppWindow).__APP__['/src/stores/cloudAuthStore.ts'] as typeof import('../src/stores/cloudAuthStore')
    const { supabaseCloud } = (window as unknown as AppWindow).__APP__['/src/api/cloud/supabase.ts'] as typeof import('../src/api/cloud/supabase')
    const auth = supabaseCloud().auth
    Reflect.set(auth, 'getSession', async () => ({ data: { session: { access_token: 'synthetic-proof-token', user: { id: 'owner-a' } } } }))
    Reflect.set(auth, 'getUser', async () => ({ data: { user: { id: 'owner-a' } }, error: null }))
    Reflect.set(auth, 'onAuthStateChange', () => ({ data: { subscription: { unsubscribe() {} } } }))
    useCloudAuthStore.getState().setSignedIn({ id: 'owner-a' }, { licenseActive: false, tier: null, access: true, quota: null })
  })
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
}

test('foreground cancellation stops a held pull and leaving the collection cancels the next run', async ({ page }) => {
  let finish: (() => Promise<void>) | undefined
  let hold = true
  let reads = 0
  await page.route('**/*', route => new URL(route.request().url()).port === appPort() ? route.continue() : route.abort())
  await page.route('**/api/memory/sync**', async route => {
    expect(route.request().method()).toBe('GET')
    reads++
    const respond = () => route.fulfill({ json: { ownerId: 'owner-a', records: [], next: null } })
    if (hold) {
      await new Promise<void>(resolve => { finish = async () => { await respond().catch(() => {}); resolve() } })
    } else await respond()
  })
  await page.goto('/e2e/memory-sensitive-proof.html')
  await page.evaluate(() => {
    const original = window.fetch.bind(window)
    Reflect.set(window, 'memoryProofAborts', 0)
    window.fetch = (input, init) => {
      if (String(input).includes('/api/memory/sync')) init?.signal?.addEventListener('abort', () => {
        Reflect.set(window, 'memoryProofAborts', Number(Reflect.get(window, 'memoryProofAborts')) + 1)
      }, { once: true })
      return original(input, init)
    }
  })
  await accountFixture(page)
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  const sync = page.getByRole('button', { name: 'Sync account memories', exact: true })
  await sync.click()
  await expect.poll(() => reads).toBe(1)
  await page.getByRole('button', { name: 'Cancel synchronization', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Memory synchronization cancelled. Some changes may already be saved.')
  await expect(sync).toBeEnabled()
  expect(await page.evaluate(() => Reflect.get(window, 'memoryProofAborts'))).toBe(1)
  await finish!()
  finish = undefined
  await sync.click()
  await expect.poll(() => reads).toBe(2)
  await page.getByRole('button', { name: 'Use local memories', exact: true }).click()
  await page.getByRole('button', { name: 'Use account memories', exact: true }).click()
  expect(await page.evaluate(() => Reflect.get(window, 'memoryProofAborts'))).toBe(2)
  await finish!()
  hold = false
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(reads).toBe(3)
  await expect(page.getByRole('button', { name: 'Cancel synchronization', exact: true })).toHaveCount(0)
})

test('explicit UI sync uploads, downloads, preserves conflicts and persists shared deletion', async ({ page }, testInfo) => {
  let records: SyncedMemoryRecord[] = []
  let writes = 0
  await page.route('**/*', route => new URL(route.request().url()).port === appPort() ? route.continue() : route.abort())
  await page.route('**/api/memory/sync**', async route => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-proof-token')
    if (route.request().method() === 'POST') {
      const body: unknown = route.request().postDataJSON()
      if (!isRecord(body) || typeof body.memoryId !== 'string' || typeof body.expectedRevision !== 'number') throw new Error('Malformed fixture request')
      const previous = records.find(record => record.memory_id === body.memoryId)
      if (body.expectedRevision !== (previous?.revision ?? 0)) return route.fulfill({ status: 409, json: {} })
      if (body.payload !== null && !isRecord(body.payload)) throw new Error('Malformed fixture payload')
      const record = { memory_id: body.memoryId, revision: body.expectedRevision + 1, deleted: body.deleted === true,
        payload: body.payload, updated_at: '2026-09-09T00:00:00Z' }
      records = [record]
      writes++
      return route.fulfill({ json: { ownerId: 'owner-a', record } })
    }
    return route.fulfill({ json: { ownerId: 'owner-a', records, next: null } })
  })
  await page.goto('/e2e/memory-sensitive-proof.html')
  await accountFixture(page)
  const sync = page.getByRole('button', { name: 'Sync account memories', exact: true })
  await expect(sync).toBeDisabled()
  await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
  await page.getByPlaceholder('What should I remember?').fill('Account preference')
  await page.getByPlaceholder('Details… (required)').fill('Synthetic preference')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  expect(writes).toBe(0)
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await page.getByLabel('Sensitive: exclude from AI requests', { exact: true }).check()
  await sync.click()
  // R2-37 (ed57f1d1, shipped 3.0.1): a sensitive memory without explicit
  // upload consent no longer aborts the whole sync. It is left out of the
  // push, the harmless pull half still runs, and the count of skipped
  // entries shows up in the status line. The entry itself stays local, it
  // is not uploaded and not deleted.
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 0 downloads. 0 conflicting memories left unchanged. 1 sensitive memory was left out (not uploaded).')
  expect(writes).toBe(0)
  expect(records).toHaveLength(0)
  await expect(page.getByText('Account preference', { exact: true })).toBeVisible()
  await page.getByLabel('Sensitive: exclude from AI requests', { exact: true }).uncheck()
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(writes).toBe(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: testInfo.outputPath('memory-sync.png'), fullPage: true })
  records = records.map(record => ({ ...record, revision: 2, payload: { ...record.payload, title: 'Cloud revision', content: 'Cloud correction', updatedAt: 2 } }))
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 1 downloads. 0 conflicting memories left unchanged.')
  await expect(page.getByText('Cloud revision', { exact: true })).toBeVisible()
  await appModules(page, ['/src/stores/memoryStore.ts'])
  await page.evaluate(() => {
    const { useMemoryStore } = (window as unknown as AppWindow).__APP__['/src/stores/memoryStore.ts'] as typeof import('../src/stores/memoryStore')
    useMemoryStore.getState().updateMemory(useMemoryStore.getState().entries[0].id, { content: 'Local correction' })
  })
  records = records.map(record => ({ ...record, revision: 3, payload: { ...record.payload, content: 'Concurrent cloud correction', updatedAt: 3 } }))
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 0 downloads. 1 conflicting memories left unchanged.')
  expect(writes).toBe(1)
  const conflict = page.getByRole('group', { name: 'Memory conflict 1', exact: true })
  await conflict.getByText('Compare full memory records', { exact: true }).click()
  await expect(conflict.locator('pre').first()).toContainText('Local correction')
  await expect(conflict.locator('pre').last()).toContainText('Concurrent cloud correction')
  await appModules(page, ['/src/lib/memory-persistence.ts'])
  const persistedReview = await page.evaluate(() => {
    return ((window as unknown as AppWindow).__APP__['/src/lib/memory-persistence.ts'] as typeof import('../src/lib/memory-persistence')).flushMemoryPersist()
  })
  expect(persistedReview).not.toContain('Concurrent cloud correction')
  await conflict.screenshot({ path: testInfo.outputPath('memory-conflict.png') })
  // Another device changes the cloud record after review. The old choice
  // must not overwrite that new revision.
  records = records.map(record => ({ ...record, revision: 4, payload: { ...record.payload, content: 'Newer cloud correction', updatedAt: 4 } }))
  await page.getByRole('button', { name: 'Keep local version', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('This conflict changed. Sync again before choosing a version.')
  expect(writes).toBe(1)
  await sync.click()
  await expect(conflict).toBeVisible()
  await page.getByRole('button', { name: 'Use cloud version', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Synced 0 uploads and 1 downloads. 0 conflicting memories left unchanged.')
  await expect(page.getByText('Newer cloud correction', { exact: true })).toBeVisible()
  await appModules(page, ['/src/stores/memoryStore.ts'])
  await page.evaluate(() => {
    const { useMemoryStore } = (window as unknown as AppWindow).__APP__['/src/stores/memoryStore.ts'] as typeof import('../src/stores/memoryStore')
    useMemoryStore.getState().updateMemory(useMemoryStore.getState().entries[0].id, { content: 'Final local correction' })
  })
  records = records.map(record => ({ ...record, revision: 5, payload: { ...record.payload, content: 'Another cloud correction', updatedAt: 5 } }))
  await sync.click()
  await expect(conflict).toBeVisible()
  await page.getByRole('button', { name: 'Keep local version', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(records[0]).toMatchObject({ revision: 6, payload: { content: 'Final local correction' } })
  await appModules(page, ['/src/stores/memoryStore.ts'])
  await page.evaluate(() => {
    const { useMemoryStore } = (window as unknown as AppWindow).__APP__['/src/stores/memoryStore.ts'] as typeof import('../src/stores/memoryStore')
    useMemoryStore.getState().updateMemory(useMemoryStore.getState().entries[0].id, { content: 'Delete this local fact' })
  })
  records = records.map(record => ({ ...record, revision: 7, payload: { ...record.payload, content: 'Delete this cloud fact', updatedAt: 7 } }))
  await sync.click()
  await expect(conflict).toBeVisible()
  await page.getByTitle('Delete this memory', { exact: true }).click()
  await page.getByTitle('Click again to delete', { exact: true }).click()
  // The Undo bar of a delete is a status line of its own (3.0.8); OK closes it.
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(page.getByRole('group', { name: 'Memory conflict 1', exact: true })).toHaveCount(0)
  await sync.click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(records[0]).toMatchObject({ deleted: true, payload: null, revision: 8 })
  await page.reload()
  await accountFixture(page)
  await expect(page.getByTitle('Delete this memory', { exact: true })).toHaveCount(0)
  await appModules(page, ['/src/stores/memoryStore.ts'])
  const baseline = await page.evaluate(() => {
    const { useMemoryStore } = (window as unknown as AppWindow).__APP__['/src/stores/memoryStore.ts'] as typeof import('../src/stores/memoryStore')
    return Object.values(useMemoryStore.getState().memorySyncBaselines['owner-a'])
  })
  expect(baseline).toEqual([{ revision: 8, hash: null }])
})

for (const responseMode of ['lost', 'cancelled'] as const) {
test(`a ${responseMode} first-upload response cannot revive a locally deleted memory after reload`, async ({ page }) => {
  let records: SyncedMemoryRecord[] = []
  let lostResponse = false
  let finish: (() => Promise<void>) | undefined
  await page.route('**/*', route => new URL(route.request().url()).port === appPort() ? route.continue() : route.abort())
  await page.route('**/api/memory/sync**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { ownerId: 'owner-a', records, next: null } })
    const body: unknown = route.request().postDataJSON()
    if (!isRecord(body) || typeof body.memoryId !== 'string' || typeof body.expectedRevision !== 'number' ||
      (body.payload !== null && !isRecord(body.payload))) throw new Error('Malformed fixture request')
    expect(body.expectedRevision).toBe(records[0]?.revision ?? 0)
    const record = { memory_id: body.memoryId, revision: body.expectedRevision + 1, payload: body.payload,
      deleted: body.deleted === true, updated_at: '2026-09-09T00:00:00Z' }
    records = [record]
    if (!lostResponse) {
      lostResponse = true
      if (responseMode === 'lost') return route.abort('failed')
      return new Promise<void>(resolve => {
        finish = async () => {
          await route.fulfill({ json: { ownerId: 'owner-a', record } }).catch(() => {})
          resolve()
        }
      })
    }
    return route.fulfill({ json: { ownerId: 'owner-a', record } })
  })
  await page.goto('/e2e/memory-sensitive-proof.html')
  await accountFixture(page)
  await page.getByRole('button', { name: 'Add Memory', exact: true }).click()
  await page.getByPlaceholder('What should I remember?').fill('Uncertain upload')
  await page.getByPlaceholder('Details… (required)').fill('Synthetic private content')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await page.getByRole('button', { name: 'Sync account memories', exact: true }).click()
  if (responseMode === 'cancelled') {
    await expect.poll(() => Boolean(finish)).toBe(true)
    await page.getByRole('button', { name: 'Cancel synchronization', exact: true }).click()
    await expect(page.getByRole('status')).toHaveText('Memory synchronization cancelled. Some changes may already be saved.')
    await finish!()
  }
  await expect(page.getByRole('status')).toContainText('Some changes may already be saved')
  expect(records[0].deleted).toBe(false)
  await page.getByTitle('Delete this memory', { exact: true }).click()
  await page.getByTitle('Click again to delete', { exact: true }).click()
  await appModules(page, ['/src/lib/memory-persistence.ts'])
  await page.evaluate(async () => {
    await ((window as unknown as AppWindow).__APP__['/src/lib/memory-persistence.ts'] as typeof import('../src/lib/memory-persistence')).flushMemoryPersist()
  })
  await page.reload()
  await accountFixture(page)
  await appModules(page, ['/src/stores/memoryStore.ts'])
  const pending = await page.evaluate(() => {
    const { useMemoryStore } = (window as unknown as AppWindow).__APP__['/src/stores/memoryStore.ts'] as typeof import('../src/stores/memoryStore')
    return { entries: useMemoryStore.getState().entries.length, pending: Object.keys(useMemoryStore.getState().memorySyncPending['owner-a']).length }
  })
  expect(pending).toEqual({ entries: 0, pending: 1 })
  await page.getByLabel('Allow cloud storage for this account collection', { exact: true }).check()
  await page.getByRole('button', { name: 'Sync account memories', exact: true }).click()
  await expect(page.getByRole('status')).toHaveText('Synced 1 uploads and 0 downloads. 0 conflicting memories left unchanged.')
  expect(records[0]).toMatchObject({ revision: 2, payload: null, deleted: true })
  await expect(page.getByTitle('Delete this memory', { exact: true })).toHaveCount(0)
})
}
