/**
 * The seams of the logic layer are connected, and each exactly once.
 *
 * mobile-docs/geruest-wuensche/logik-an-shell.md lists what the shell has to
 * call. A call that is missing fails silently on a phone only (nothing is
 * saved on the way to the background, a sign in never comes back); a call
 * that happens twice arms two timers. Both are invisible in a browser, so
 * the source is read here.
 */
import { describe, expect, it } from 'vitest'
import { MOBILE_DIR, sourceFiles, stripComments } from './scan'

const files = sourceFiles(MOBILE_DIR, ['.ts', '.tsx']).map((f) => ({ rel: f.rel, code: stripComments(f.text) }))

function filesCalling(re: RegExp): string[] {
  return files.filter((f) => re.test(f.code)).map((f) => f.rel).sort()
}

function count(rel: string, re: RegExp): number {
  const file = files.find((f) => f.rel === rel)
  if (!file) throw new Error(`${rel} is gone`)
  return (file.code.match(re) ?? []).length
}

describe('each seam of the logic layer has one caller', () => {
  it('useCloudAuth is mounted in MobileRoot and nowhere else (every instance arms its own interval)', () => {
    expect(filesCalling(/\buseCloudAuth\s*\(/)).toEqual(['mobile/MobileRoot.tsx'])
    expect(count('mobile/MobileRoot.tsx', /\buseCloudAuth\s*\(/g)).toBe(1)
  })

  it('the services of the settings strand (expired session, notes of a new version) run from MobileRoot, not from a screen', () => {
    expect(filesCalling(/\buseSettingsServices\s*\(/)).toEqual(['mobile/MobileRoot.tsx', 'mobile/screens/settings/parts/services.ts'])
    expect(count('mobile/MobileRoot.tsx', /\buseSettingsServices\s*\(/g)).toBe(1)
  })

  it('the phone lifecycle is installed in boot/wiring.ts and nowhere else', () => {
    expect(filesCalling(/\binstallMobileLifecycle\s*\(/)).toEqual(['mobile/boot/wiring.ts'])
    expect(filesCalling(/\bemitNativeLifecycle\s*\(/)).toEqual(['mobile/boot/wiring.ts'])
  })

  it('no screen starts recoverInterruptedRuns or resumePendingCloudJobs on its own: installMobileLifecycle does both', () => {
    expect(filesCalling(/\brecoverInterruptedRuns\s*\(/)).toEqual([])
    expect(filesCalling(/\bresumePendingCloudJobs\s*\(/)).toEqual([])
  })

  it('the setters of the logic layer are called from boot/wiring.ts only', () => {
    for (const setter of ['setMobileShareHandler', 'setMobileContextCap', 'setEmbedderFitCheck', 'setMobileKeychainAvailable', 'onCloudJobsResumed']) {
      expect(filesCalling(new RegExp(`\\b${setter}\\s*\\(`)), setter).toEqual(['mobile/boot/wiring.ts'])
    }
  })

  it('links from the system go through reportIncomingUrl in nav/deeplink.ts only', () => {
    expect(filesCalling(/\breportIncomingUrl\s*\(/)).toEqual(['mobile/nav/deeplink.ts'])
    // No exception: a sign in link is never finished by hand in the shell (review N3).
    expect(filesCalling(/\bhandleOAuthCallbackUrl\s*\(/)).toEqual([])
    expect(filesCalling(/\bfinishAuthOffer\s*\(/)).toEqual([])
  })

  it('the start connects everything once, after the router and before the links', () => {
    const boot = files.find((f) => f.rel === 'mobile/boot/index.tsx')!.code
    expect((boot.match(/\bwireLogic\s*\(/g) ?? []).length).toBe(1)
    expect((boot.match(/\bprobeKeychain\s*\(/g) ?? []).length).toBe(1)
    const order = ['probeKeychain(', 'hydrateProviderKeys(', 'installNav(', 'wireLogic(', 'installDeepLinks(']
    const at = order.map((needle) => boot.indexOf(needle))
    expect(at.every((index) => index >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(filesCalling(/\bwireLogic\s*\(/)).toEqual(['mobile/boot/index.tsx', 'mobile/boot/wiring.ts'])
  })

  it('the frame mounts the fallbacks and the notes exactly once', () => {
    for (const tag of ['<StorageFallback', '<ModelNotes', '<ToastHost', '<AppServices']) {
      expect(count('mobile/MobileRoot.tsx', new RegExp(tag, 'g')), tag).toBe(1)
    }
  })

  it('the out of credits signal opens the sheet of strand 5', () => {
    const root = files.find((f) => f.rel === 'mobile/MobileRoot.tsx')!.code
    expect(root).toContain('CREDITS_EXHAUSTED_EVENT')
    expect(root).toMatch(/openSheet\('credits'/)
  })

  it('the bridge of the native layer is loaded in platform/bridge.ts only', () => {
    expect(filesCalling(/lu-native/)).toEqual(['mobile/platform/bridge.ts'])
  })
})

describe('the store building blocks are wired once and cannot be loosened', () => {
  it('the preset of a build is read in policy/storePolicy.ts and nowhere else', () => {
    expect(filesCalling(/VITE_LU_STORE_PRESET/)).toEqual(['mobile/policy/storePolicy.ts'])
  })

  it('no source outside the policy folder forces a preset', () => {
    const callers = filesCalling(/\bsetStorePresetForTests\s*\(/).filter((rel) => !rel.includes('__tests__'))
    // dev/test-hook.ts is the hook of the acceptance build; a store build does not contain the file (abnahme-haken.test.ts).
    expect(callers).toEqual(['mobile/dev/test-hook.ts', 'mobile/policy/storePolicy.ts'])
    expect(filesCalling(/\bapplyDevStorePreset\s*\(/)).toEqual(['mobile/boot/index.tsx', 'mobile/policy/storePolicy.ts'])
  })

  it('the developer switch for the preset is tied to a developer build', () => {
    const boot = files.find((f) => f.rel === 'mobile/boot/index.tsx')!.code
    expect(boot).toMatch(/applyDevStorePreset\(\s*location\.search\s*,\s*import\.meta\.env\.DEV\s*\)/)
  })

  it('the age question wraps the whole app in MobileRoot', () => {
    expect(filesCalling(/<AgeGate\b/)).toEqual(['mobile/MobileRoot.tsx'])
    const root = files.find((f) => f.rel === 'mobile/MobileRoot.tsx')!.code
    const open = root.indexOf('<AgeGate>')
    const close = root.indexOf('</AgeGate>')
    for (const inside of ['<AppServices />', '<Frame boot={boot} />']) {
      const at = root.indexOf(inside)
      expect(at > open && at < close, inside).toBe(true)
    }
  })

  it('waiting reports are sent from boot, once', () => {
    expect(filesCalling(/\binstallReports\s*\(/)).toEqual(['mobile/boot/index.tsx', 'mobile/policy/report.ts'])
    expect(count('mobile/boot/index.tsx', /\binstallReports\s*\(/g)).toBe(1)
  })

  it('the consent is saved by the sheet only and the report address is read in one place', () => {
    expect(filesCalling(/\banswerAiConsent\s*\(/).filter((rel) => !rel.includes('__tests__'))).toEqual(['mobile/policy/ConsentSheet.tsx', 'mobile/policy/consent.ts'])
    expect(filesCalling(/VITE_LU_REPORT_URL/)).toEqual(['mobile/policy/report.ts'])
  })
})
