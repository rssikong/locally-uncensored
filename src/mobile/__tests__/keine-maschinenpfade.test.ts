/**
 * The repository is public. No path of a build machine and no address of
 * somebody's home network belongs in a tracked text file.
 *
 * Review of round 6, finding 10: eight absolute paths with the user name of
 * the build machine stood in mobile-docs, for the second review in a row.
 * Cleaning them up once does not keep them out, so this test reads every
 * tracked text file and names the line.
 *
 * Three rules:
 *  - In the mobile part of the repository a home folder (`/Users/<name>`,
 *    `/home/<name>`, `C:\Users\<name>`) may only carry one of the made-up
 *    names below.
 *  - In every folder the review named, no home folder may carry the name of
 *    whoever runs this test. That is the path of THIS machine, and this is
 *    how the eight got in. (The tests of the desktop use many more made-up
 *    and reported names as examples; those are not judged by a list here.)
 *  - A private IPv4 address may only be one of the example addresses below.
 *    Held to the mobile part, where the device runs write their evidence:
 *    that is where a real address gets in.
 *
 * Run: npx vitest run src/mobile/__tests__/keine-maschinenpfade.test.ts
 */
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { userInfo } from 'node:os'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../..')

/** The folders the review named: the name of this machine's user is looked for in all of them. */
const WIDE_SCOPE = ['mobile-docs', 'mobile-tests', 'scripts', 'src', 'e2e']
/** The mobile part: every home folder and every private address is judged here. */
const MOBILE_SCOPE = ['mobile-docs', 'mobile-tests', 'scripts/mobile', 'e2e/mobile', 'src/mobile']

const TEXT = /\.(md|txt|ts|tsx|js|jsx|mjs|cjs|json|sh|zsh|yml|yaml|toml|html|css|svg|xml|plist|kt|kts|swift|rs|gradle|tsv|csv)$/i
const MAX_BYTES = 4 * 1024 * 1024

/** Made-up names of a home folder. Short on purpose: a new one is a decision. */
const EXAMPLE_USERS = new Set([
  'me', 'dev', 'x', 'd', 'a', 'you', 'someone', 'david', 'kein-echtes-heim', 'runner', '<user>', '<name>', '$USER', '...',
])

/** Example addresses. Whole blocks first, then single addresses the tests use. */
const EXAMPLE_BLOCKS = [/^192\.168\.1\.\d+$/, /^10\.0\.0\.\d+$/]
const EXAMPLE_ADDRESSES = new Set([
  // The alias of the host machine inside the Android emulator, the same on every machine.
  '10.0.2.2',
  '192.168.0.12', '192.168.77.5', '192.168.7.20', '192.168.178.20', '172.16.4.4', '100.101.102.103', '100.72.1.1',
])

const HOME = /(?:\/Users\/|\/home\/|[A-Za-z]:\\{1,2}Users\\{1,2})([^/\\\s"'`<>)(,;:*|]+|<[a-z]+>)/g
const PRIVATE_V4 = /(?<![\d.])(?:10\.\d{1,3}|192\.168|172\.(?:1[6-9]|2\d|3[01])|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7]))\.\d{1,3}\.\d{1,3}(?![\d.]*\d)/g

/** Pure: the user names of the home folders a text names, the made-up ones left out. */
export function machineUsers(text: string, alsoForbidden: readonly string[] = []): string[] {
  const found: string[] = []
  for (const match of text.matchAll(HOME)) {
    const name = match[1]
    if (alsoForbidden.includes(name) || !EXAMPLE_USERS.has(name)) found.push(name)
  }
  return found
}

/** Pure: the private addresses a text names, the example ones left out. */
export function privateAddresses(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(PRIVATE_V4)) {
    const address = match[0]
    // The name of a whole range (192.168.0.0/16, 10.0.0.0/8) is no machine.
    if (/\.0\.0$/.test(address) || /\.255\.255$/.test(address)) continue
    if (EXAMPLE_ADDRESSES.has(address) || EXAMPLE_BLOCKS.some((block) => block.test(address))) continue
    found.push(address)
  }
  return found
}

function tracked(scope: readonly string[]): string[] {
  const out = execFileSync('git', ['ls-files', '-z', '--', ...scope], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  return out.split('\0').filter((file) => file && TEXT.test(file))
}

function linesOf(file: string): string[] {
  const path = resolve(ROOT, file)
  try {
    if (statSync(path).size > MAX_BYTES) return []
    return readFileSync(path, 'utf8').split('\n')
  } catch {
    // Tracked and deleted in the working tree: nothing to read.
    return []
  }
}

// The examples of this very file are put together here, so the file passes its own rule.
const join = (...parts: string[]) => parts.join('')
const SELF = 'src/mobile/__tests__/keine-maschinenpfade.test.ts'

describe('the rules', () => {
  it('a home folder with a real name is found on every system, a made-up one is not', () => {
    expect(machineUsers(join('cd "/Users', '/jane/Desktop/LU"'))).toEqual(['jane'])
    expect(machineUsers(join('/home', '/build-07/repo and C:\\Users', '\\Jane\\repo'))).toEqual(['build-07', 'Jane'])
    expect(machineUsers(join('C:\\\\Users', '\\\\jane\\\\x'))).toEqual(['jane'])
    expect(machineUsers('/Users/dev/projects and /Users/me/repo and /home/you and C:\\Users\\<user>\\.ssh')).toEqual([])
    // A folder that is only named, with nobody in it.
    expect(machineUsers("prompt('/Users/') and '/home' and C:\\Users")).toEqual([])
    // The name of whoever runs the test is never an example, whatever the list says.
    expect(machineUsers('/Users/dev/x', ['dev'])).toEqual(['dev'])
  })

  it('a private address is found, an example address and the name of a range are not', () => {
    expect(privateAddresses(join('http://192.168', '.0.160:8799/file'))).toEqual([join('192.168', '.0.160')])
    expect(privateAddresses(join('10.11', '.12.13 and 172.20', '.3.4 and 100.99', '.1.2'))).toHaveLength(3)
    expect(privateAddresses('192.168.1.20:11435, 10.0.0.5, 10.0.2.2, 192.168.0.12, 100.101.102.103')).toEqual([])
    expect(privateAddresses('192.168.0.0/16, 10.0.0.0/8, 172.16.0.0/12, 100.64.0.0/10, 10.255.255.255')).toEqual([])
    // Public addresses and version numbers are none of this rule's business.
    expect(privateAddresses('8.8.8.8, 172.15.1.1, 172.32.1.1, 100.63.1.1, 100.128.1.1, 193.168.1.1')).toEqual([])
    expect(privateAddresses('tauri 2.10.0.1 and 110.0.5.1 and v10.0')).toEqual([])
  })
})

describe('the tracked text files', () => {
  it('mobile part: name no home folder but the made-up ones', () => {
    const hits: string[] = []
    for (const file of tracked(MOBILE_SCOPE)) {
      if (file === SELF) continue
      linesOf(file).forEach((line, index) => {
        if (!line.includes('Users') && !line.includes('/home/')) return
        for (const name of machineUsers(line)) hits.push(`${file}:${index + 1}: home folder of "${name}"`)
      })
    }
    expect(hits, 'replace these with a path relative to the repository').toEqual([])
  })

  it('everywhere: name no home folder of the machine this runs on', () => {
    const me = (() => { try { return userInfo().username } catch { return '' } })()
    // Somebody who is called like an example has nothing to find here.
    if (!me || EXAMPLE_USERS.has(me)) return
    const hits: string[] = []
    for (const file of tracked(WIDE_SCOPE)) {
      if (file === SELF) continue
      linesOf(file).forEach((line, index) => {
        if (!line.includes(me)) return
        for (const match of line.matchAll(HOME)) {
          if (match[1] === me) hits.push(`${file}:${index + 1}`)
        }
      })
    }
    expect(hits, 'the path of this machine: replace it with a path relative to the repository').toEqual([])
  })

  it('mobile part: name no private address but the example ones', () => {
    const hits: string[] = []
    for (const file of tracked(MOBILE_SCOPE)) {
      if (file === SELF) continue
      linesOf(file).forEach((line, index) => {
        for (const address of privateAddresses(line)) hits.push(`${file}:${index + 1}: ${address}`)
      })
    }
    expect(hits, 'replace these with an example address such as 192.168.1.20').toEqual([])
  })
})
