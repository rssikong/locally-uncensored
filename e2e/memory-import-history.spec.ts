import { expect, test } from '@playwright/test'
test('JSON export and reimport keep superseded facts out of AI context after reload', async ({ page }, testInfo) => {
  await page.goto('/e2e/memory-sensitive-proof.html')
  const seed = Buffer.from(JSON.stringify([
    { id: 'old', title: 'Old memory', content: 'private outdated fact', supersededBy: 'new' },
    { id: 'new', title: 'Current memory', content: 'private current fact', supersedesId: 'old' },
  ]))
  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'seed.json', mimeType: 'application/json', buffer: seed })
  await expect(page.getByText('Imported 2 memories.', { exact: true })).toBeVisible()
  await expect(page.getByText('Show outdated (1)', { exact: true })).toBeVisible()
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: '.json', exact: true }).click()
  const stream = await (await pendingDownload).createReadStream()
  if (!stream) throw new Error('No exported JSON stream')
  const chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  const exported = Buffer.concat(chunks)
  await page.getByRole('button', { name: 'Delete all', exact: true }).click()
  await page.getByRole('button', { name: 'Sure?', exact: true }).click()
  await expect(page.getByText('Current memory', { exact: true })).toHaveCount(0)
  await input.setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: exported })
  await expect(page.getByText('Current memory', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Show outdated (1)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Preview AI memory context' }).click()
  await expect(page.locator('#result')).toContainText('private current fact')
  await expect(page.locator('#result')).not.toContainText('private outdated fact')
  await expect(page.getByText('Old memory', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Toggle outdated memories' }).click()
  await expect(page.getByText('Old memory', { exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('memory-import-history.png') })
})
