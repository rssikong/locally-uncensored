/**
 * Point 1 of the mobile groundwork: the app asks what the device can do, not
 * which platform it is.
 *
 * Before this, "is there ComfyUI here?" was spelled `!isMacOS()`, so an
 * Android phone pinged ComfyUI on every model refresh, and an iPhone was told
 * by the agent prompt that it runs macOS with bash and Finder.
 *
 * Every assertion has a desktop twin: the three desktops must answer exactly
 * what the old platform checks answered.
 *
 * Run: npx vitest run src/lib/__tests__/mobile-capabilities.test.ts
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { DESKTOPS, DEVICES, HANDHELDS, standOn } from '../../test-support/devices'
import {
  hasComfy, hasFileDialog, hasForeignBackends, hasKeychain, hasLocalVoice, hasMlx,
  hasShell, pathsFoldCase, setMobileKeychainAvailable, singleModelSlot, usesCommandKey,
} from '../capabilities'
import { hostPlatform, platformPromptLine, MOBILE_PLATFORM_LINE } from '../host-platform'
import { isMlxImageHost } from '../../api/mlx-image'
import { samePath } from '../../api/engine'

const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8')

afterEach(() => {
  vi.unstubAllGlobals()
  setMobileKeychainAvailable(false)
})

describe('capabilities on a phone or tablet', () => {
  for (const device of HANDHELDS) {
    it(`${device}: nothing of the desktop exists`, () => {
      standOn(device)
      expect(hasComfy()).toBe(false)
      expect(hasMlx()).toBe(false)
      expect(hasShell()).toBe(false)
      expect(hasFileDialog()).toBe(false)
      expect(hasKeychain()).toBe(false)
      expect(hasLocalVoice()).toBe(false)
      expect(hasForeignBackends()).toBe(false)
      expect(singleModelSlot()).toBe(true)
    })
  }

  it('the keychain answers yes on a phone only after the native side said so', () => {
    standOn('android')
    expect(hasKeychain()).toBe(false)
    setMobileKeychainAvailable(true)
    expect(hasKeychain()).toBe(true)
  })

  it('an iPhone is not an MLX host', () => {
    standOn('iphone')
    expect(isMlxImageHost()).toBe(false)
    standOn('ipad')
    expect(isMlxImageHost()).toBe(false)
  })

  it('Android does not fold path case, its file system tells Models from models', () => {
    standOn('android')
    expect(pathsFoldCase()).toBe(false)
    expect(samePath('/data/user/0/app/Models', '/data/user/0/app/models')).toBe(false)
    expect(samePath('/data/user/0/app/models/', '/data/user/0/app/models')).toBe(true)
  })
})

describe('capabilities on the desktop are the old platform checks', () => {
  it('ComfyUI everywhere but the Mac, MLX only on the Mac', () => {
    standOn('mac')
    expect([hasComfy(), hasMlx(), isMlxImageHost()]).toEqual([false, true, true])
    standOn('windows')
    expect([hasComfy(), hasMlx(), isMlxImageHost()]).toEqual([true, false, false])
    standOn('linux')
    expect([hasComfy(), hasMlx(), isMlxImageHost()]).toEqual([true, false, false])
  })

  for (const device of DESKTOPS) {
    it(`${device}: shell, dialog, keychain, local voice and foreign backends exist`, () => {
      standOn(device)
      expect(hasShell()).toBe(true)
      expect(hasFileDialog()).toBe(true)
      expect(hasKeychain()).toBe(true)
      expect(hasLocalVoice()).toBe(true)
      expect(hasForeignBackends()).toBe(true)
      expect(singleModelSlot()).toBe(false)
    })
  }

  it('the keychain seam cannot switch the desktop keychain off', () => {
    standOn('windows')
    setMobileKeychainAvailable(false)
    expect(hasKeychain()).toBe(true)
  })

  it('paths fold on Windows and the Mac and not on Linux, as Rust does', () => {
    standOn('windows')
    expect(samePath('C:\\Models\\', 'c:/models')).toBe(true)
    standOn('mac')
    expect(samePath('/Users/a/Models', '/users/a/models')).toBe(true)
    standOn('linux')
    expect(samePath('/mnt/Models', '/mnt/models')).toBe(false)
  })

  it('Command is the app modifier on Apple keyboards only', () => {
    standOn('mac'); expect(usesCommandKey()).toBe(true)
    standOn('ipad'); expect(usesCommandKey()).toBe(true)
    standOn('windows'); expect(usesCommandKey()).toBe(false)
    standOn('linux'); expect(usesCommandKey()).toBe(false)
  })
})

describe('the agent is told which device it stands on', () => {
  it('a phone is a phone, not macOS and not Linux', () => {
    expect(hostPlatform(DEVICES.iphone)).toBe('ios')
    expect(hostPlatform(DEVICES.ipad)).toBe('ios')
    expect(hostPlatform(DEVICES.android)).toBe('android')
  })

  it('the desktops read as before', () => {
    expect(hostPlatform(DEVICES.mac)).toBe('macos')
    expect(hostPlatform(DEVICES.windows)).toBe('windows')
    expect(hostPlatform(DEVICES.linux)).toBe('linux')
  })

  it('the mobile line names no shell and no desktop verb', () => {
    for (const p of ['ios', 'android'] as const) {
      const line = platformPromptLine(p)
      expect(line).toBe(MOBILE_PLATFORM_LINE)
      expect(line).not.toMatch(/shell_execute|bash|PowerShell|Finder|Explorer|xdg-open|this computer|this machine/i)
      expect(line).toMatch(/phone or tablet/)
      expect(line).toMatch(/working folder/)
      // House rule for every text a user or a model reads.
      expect(line).not.toMatch(/[\u2013\u2014]/)
    }
  })

  it('the desktop lines are word for word what they were', () => {
    expect(platformPromptLine('macos')).toBe(
      'This machine runs macOS and shell_execute runs bash. Open a file or folder with `open <path>`, reveal it in Finder with `open -R <path>`, start an application with `open -a "<App Name>"`.',
    )
    expect(platformPromptLine('windows')).toBe(
      'This machine runs Windows and shell_execute runs PowerShell. Open a file or folder with `Invoke-Item <path>`, reveal it in Explorer with `explorer "/select,<path>"` (one argument, the comma matters), start an application with `Start-Process "<App Name>"`.',
    )
    expect(platformPromptLine('linux')).toBe(
      'This machine runs Linux and shell_execute runs bash. Open a file or folder with `xdg-open <path>`, start an application with `gtk-launch <name>`. There is no reveal, so open the containing folder instead.',
    )
  })
})

describe('the call sites ask the capability, not the platform', () => {
  it('useModels gates the ComfyUI probe and its retry on hasComfy', () => {
    const s = src('hooks/useModels.ts')
    expect(s).toContain('if (!hasComfy()) return')
    expect(s).toContain('const comfyOk = hasComfy() && (await checkComfyConnection())')
    expect(s).not.toMatch(/isMacOS\(\)/)
  })

  it('the two private copies of the Mac check are gone', () => {
    expect(src('stores/settingsStore.ts')).not.toMatch(/Mac\|iPhone\|iPad/)
    expect(src('hooks/useKeyboardShortcuts.ts')).not.toMatch(/Mac\|iPhone\|iPad/)
  })
})
