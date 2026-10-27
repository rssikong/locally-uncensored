/**
 * The StoreKit configuration file for local tests of the in-app purchase
 * (round 17) is in no package and in no scheme.
 *
 * Such a file makes the simulator answer for the store. In a build a
 * customer gets it would be a file with made-up products and prices inside
 * the app, and a scheme that names it would run the release against the
 * played store. So: the file lies outside everything project.yml names as a
 * source, and neither the shared scheme nor the project mentions it.
 *
 * Run: npx vitest run src/mobile/__tests__/iap-storekit-datei.test.ts
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const APPLE = path.resolve(__dirname, '..', '..', '..', 'src-tauri', 'gen', 'apple')
const FILE = path.join(APPLE, 'StoreKit', 'LU-Beispiel.storekit')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'build' || entry.name === 'Externals' || entry.name === 'xcuserdata') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else out.push(full)
  }
  return out
}

describe('the StoreKit configuration file', () => {
  it('holds example consumables and nothing that reads like a real product', () => {
    const config = JSON.parse(fs.readFileSync(FILE, 'utf8')) as { products: Array<{ type: string; productID: string; referenceName: string }>; subscriptionGroups: unknown[]; nonRenewingSubscriptions: unknown[] }
    expect(config.products.length).toBeGreaterThan(0)
    for (const product of config.products) {
      expect(product.type).toBe('Consumable')
      expect(product.productID).toMatch(/\.example\./)
      expect(product.referenceName).toMatch(/local test only/)
    }
    expect(config.subscriptionGroups).toEqual([])
    expect(config.nonRenewingSubscriptions).toEqual([])
  })

  it('is the only one, and lies outside every folder the project builds from', () => {
    const found = walk(APPLE).filter((file) => file.endsWith('.storekit'))
    expect(found).toEqual([FILE])
    const yml = fs.readFileSync(path.join(APPLE, 'project.yml'), 'utf8')
    const sources = [...yml.matchAll(/^\s*- path: (\S+)/gm)].map((hit) => hit[1])
    expect(sources.length).toBeGreaterThan(3)
    for (const source of sources) expect(source.toLowerCase().startsWith('storekit'), source).toBe(false)
    expect(yml).not.toMatch(/storekit/i)
  })

  it('no scheme and no project file names it: the release never runs against a played store', () => {
    const schemes = walk(APPLE).filter((file) => file.endsWith('.xcscheme'))
    expect(schemes.length).toBeGreaterThan(0)
    for (const file of [...schemes, path.join(APPLE, 'locally-uncensored.xcodeproj', 'project.pbxproj'), path.join(APPLE, 'ExportOptions.plist')]) {
      const text = fs.readFileSync(file, 'utf8')
      expect(text, path.basename(file)).not.toMatch(/storekit/i)
      expect(text, path.basename(file)).not.toMatch(/StoreKitConfigurationFileReference/)
    }
  })
})
