/**
 * The store preset of a BUILD.
 *
 * policy.test.ts checks the presets inside the test runner, where nothing is
 * built. This file runs the bundler: it builds policy/storePolicy.ts the way
 * `vite build` does, once per value of VITE_LU_STORE_PRESET, loads what came
 * out and asks it. So it is the built code that says "play", and the built
 * code that ignores ?store= in an address.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { build } from 'vite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STORE_POLICY = path.resolve(HERE, '..', 'storePolicy.ts')

interface Built {
  /** import.meta.env.DEV as the bundle sees it. */
  dev: boolean
  /** The preset before any address was looked at. */
  preset: string
  purchase: string
  ageGate: string
  /** What the developer switch answered for an address that asks for another preset. */
  switched: string | null
  /** The preset after that address. */
  presetAfterAddress: string
  /** The preset after the test hook asked for another one, and after an address handed in as "developer build". */
  presetAfterHook: string
  presetAfterLie: string
  /** One switch of round 4 after all of that, to see that the table went with the preset. */
  remoteAfterAll: boolean
  /** The source of the bundle, to look for what must not be in it. */
  code: string
}

let dir = ''
let seq = 0

async function buildWith(value: string | undefined, askFor: string, kind: 'production' | 'development' = 'production', abnahme = false): Promise<Built> {
  const before = process.env.VITE_LU_STORE_PRESET
  const abnahmeBefore = process.env.VITE_LU_ABNAHME
  if (abnahme) process.env.VITE_LU_ABNAHME = '1'
  else delete process.env.VITE_LU_ABNAHME
  const nodeEnv = process.env.NODE_ENV
  if (value === undefined) delete process.env.VITE_LU_STORE_PRESET
  else process.env.VITE_LU_STORE_PRESET = value
  // `vite build` runs with NODE_ENV=production; the test runner sets "test", which a build would take for a developer build.
  process.env.NODE_ENV = kind
  try {
    seq += 1
    const entry = path.join(dir, `entry-${seq}.ts`)
    // The same call the boot of the shell makes (boot/index.tsx, held there by geruest-verdrahtung.test.ts).
    fs.writeFileSync(
      entry,
      [
        `import { applyDevStorePreset, setStorePresetForTests, storePolicy } from ${JSON.stringify(STORE_POLICY)}`,
        'export const dev = import.meta.env.DEV',
        'export const preset = storePolicy().preset',
        'export const purchase = storePolicy().purchase',
        'export const ageGate = storePolicy().ageGate',
        `export const switched = applyDevStorePreset(${JSON.stringify(`?store=${askFor}`)}, import.meta.env.DEV)`,
        'export const presetAfterAddress = storePolicy().preset',
        // The two other ways in: the test hook, and a caller that claims to be a developer build.
        `setStorePresetForTests(${JSON.stringify(askFor)})`,
        'export const presetAfterHook = storePolicy().preset',
        `applyDevStorePreset(${JSON.stringify(`?store=${askFor}`)}, true)`,
        'export const presetAfterLie = storePolicy().preset',
        'export const remoteAfterAll = storePolicy().remoteDesktop',
        '',
      ].join('\n'),
    )
    const result = await build({
      configFile: false,
      root: dir,
      envDir: dir,
      mode: kind,
      logLevel: 'silent',
      build: { write: false, minify: false, lib: { entry, formats: ['es'], fileName: 'out' } },
    })
    const outputs = Array.isArray(result) ? result : [result]
    const chunk = outputs.flatMap((o) => ('output' in o ? o.output : [])).find((o) => o.type === 'chunk')
    if (!chunk || chunk.type !== 'chunk') throw new Error('the build produced no code')
    const file = path.join(dir, `out-${seq}.mjs`)
    fs.writeFileSync(file, chunk.code)
    const loaded = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as Omit<Built, 'code'>
    return { ...loaded, code: chunk.code }
  } finally {
    if (before === undefined) delete process.env.VITE_LU_STORE_PRESET
    else process.env.VITE_LU_STORE_PRESET = before
    process.env.NODE_ENV = nodeEnv
    if (abnahmeBefore === undefined) delete process.env.VITE_LU_ABNAHME
    else process.env.VITE_LU_ABNAHME = abnahmeBefore
  }
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lu-store-preset-'))
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('VITE_LU_STORE_PRESET decides the preset of a build', () => {
  it('a build with play is play', async () => {
    const built = await buildWith('play', 'open')
    expect(built.dev).toBe(false)
    expect(built).toMatchObject({ preset: 'play', purchase: 'text-only', ageGate: 'declare-18' })
  }, 60_000)

  it('a build with appstore is appstore', async () => {
    const built = await buildWith('appstore', 'open')
    expect(built).toMatchObject({ preset: 'appstore', purchase: 'none', ageGate: 'declare-18' })
  }, 60_000)

  it('a build without the variable, or with something else in it, is open', async () => {
    expect((await buildWith(undefined, 'play')).preset).toBe('open')
    expect((await buildWith('nonsense', 'play')).preset).toBe('open')
    expect((await buildWith('', 'play')).preset).toBe('open')
  }, 120_000)

  it('the value is written into the code, nothing reads it at run time', async () => {
    const built = await buildWith('play', 'open')
    expect(built.code).not.toContain('VITE_LU_STORE_PRESET')
    expect(built.code).not.toContain('import.meta.env')
  }, 60_000)
})

describe('?store= works in a developer build only', () => {
  it('a built app ignores the address: play stays play, appstore stays appstore, open stays open', async () => {
    const play = await buildWith('play', 'open')
    expect(play.switched).toBeNull()
    expect(play.presetAfterAddress).toBe('play')
    const appstore = await buildWith('appstore', 'open')
    expect(appstore.switched).toBeNull()
    expect(appstore.presetAfterAddress).toBe('appstore')
    const open = await buildWith(undefined, 'appstore')
    expect(open.switched).toBeNull()
    expect(open.presetAfterAddress).toBe('open')
  }, 120_000)

  it('a developer build takes it, which is what makes the line above a finding', async () => {
    const dev = await buildWith('play', 'appstore', 'development')
    expect(dev.dev).toBe(true)
    expect(dev.preset).toBe('play')
    expect(dev.switched).toBe('appstore')
    expect(dev.presetAfterAddress).toBe('appstore')
  }, 60_000)
})

describe('nothing switches the preset of a shipped build at run time', () => {
  it('not the test hook, and not a caller that claims to be a developer build', async () => {
    for (const [value, askFor] of [['appstore', 'open'], ['play', 'open'], [undefined, 'appstore']] as const) {
      const built = await buildWith(value, askFor)
      const preset = value ?? 'open'
      expect(built.presetAfterHook, preset).toBe(preset)
      expect(built.presetAfterLie, preset).toBe(preset)
      expect(built.remoteAfterAll, preset).toBe(preset !== 'appstore')
    }
  }, 180_000)

  it('the built code asks no storage, no address and no global for a preset', async () => {
    const built = await buildWith('appstore', 'open')
    expect(built.code).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/)
    expect(built.code).not.toMatch(/__LU_TEST__|__LU_STORE|globalThis|window\./)
    // The line that reads the address on the developer server is not in a shipped build.
    expect(built.code).not.toMatch(/location\.search/)
  }, 60_000)

  it('the source of the switches reads no storage either', () => {
    const source = fs.readFileSync(STORE_POLICY, 'utf8')
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|cookie|__LU_TEST__/)
    expect(source.match(/location\./g) ?? []).toHaveLength(1)
  })

  it('the acceptance build is the one shipped kind that may switch, by the hook only', async () => {
    const built = await buildWith('appstore', 'open', 'production', true)
    expect(built.dev).toBe(false)
    expect(built.preset).toBe('appstore')
    expect(built.switched).toBeNull()
    expect(built.presetAfterHook).toBe('open')
  }, 60_000)
})
