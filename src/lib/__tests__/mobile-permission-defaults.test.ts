/**
 * The permission defaults of a phone live in a file without imports, so
 * api/mcp/types.ts and lib/mobile-tools.ts do not import each other.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_PERMISSIONS } from '../../api/mcp/types'
import { MOBILE_BLOCKED_CATEGORIES, mobilePermissionDefaults } from '../mobile-permission-defaults'
import { mobilePermissionDefaults as viaMobileTools } from '../mobile-tools'

const LIB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('mobilePermissionDefaults', () => {
  it('blocks the four categories without tools on a phone and leaves the rest', () => {
    const out = mobilePermissionDefaults(DEFAULT_PERMISSIONS)
    for (const category of MOBILE_BLOCKED_CATEGORIES) expect(out[category]).toBe('blocked')
    for (const [category, level] of Object.entries(DEFAULT_PERMISSIONS)) {
      if (!(MOBILE_BLOCKED_CATEGORIES as readonly string[]).includes(category)) expect(out[category as keyof typeof out]).toBe(level)
    }
    expect(out).not.toBe(DEFAULT_PERMISSIONS)
  })

  it('is the same function under its old address', () => {
    expect(viaMobileTools).toBe(mobilePermissionDefaults)
  })

  it('imports nothing, and the type file does not import mobile-tools (the two circles of npm run cycles)', () => {
    const own = fs.readFileSync(path.join(LIB, 'mobile-permission-defaults.ts'), 'utf8')
    expect(own).not.toMatch(/^\s*import\s/m)
    const types = fs.readFileSync(path.join(LIB, '..', 'api', 'mcp', 'types.ts'), 'utf8')
    expect(types).not.toMatch(/from '\.\.\/\.\.\/lib\/mobile-tools'/)
  })
})
