/**
 * Device memory table for LU Mobile.
 *
 * Pure data. Two things live here:
 *
 * 1. Every iPhone and iPad that runs iOS 17 or iPadOS 17 (and everything newer),
 *    with its RAM, chip and Metal GPU family.
 * 2. A conservative per app memory limit for each RAM class, for iOS (with and
 *    without the `increased-memory-limit` entitlement) and for Android.
 *
 * Apple publishes no RAM figures and no per app limits, so every number names
 * where it comes from: RAM rows carry a `ramSource` key (explained at RamSource),
 * limit rows carry `limitKind` and `limitSource`. A row marked 'assumption'
 * (Annahme) is exactly that and has to be replaced by a measurement after the
 * first run on real hardware.
 *
 * See mobile-docs/GERAETE-PASSUNG.md for the calculation built on this table.
 */

export type MobilePlatform = 'ios' | 'android'

/**
 * Where a RAM figure comes from.
 *
 * xcode       Xcode 26.5 `device_traits.db`, column DevicePerformanceMemoryClass,
 *             read on 2026-10-08. Only cited where the class equals the reported
 *             GB (iPhone 12 Pro and newer, iPads with A14 or M series and newer).
 *             For older devices the column is a class, not GB, and is not used.
 * 9to5mac     9to5Mac RAM lists (teardown based):
 *             https://9to5mac.com/2023/11/18/iphone-ram-list/ and
 *             https://9to5mac.com/2024/05/06/ipad-ram-list/ (iPad list read 2026-10-08).
 * macrumors   MacRumors reports: iPhone 13 line and SE 3 (via IOS-MACHBARKEIT.md 4.1),
 *             iPhone 18 Pro line (2026-09-09, read by them from Xcode 27).
 * measured    Device reported total memory in Stack Overflow answer 15200855
 *             (https://stackoverflow.com/a/15200855), e.g. XR 2813 MB, XS 3754 MB.
 * apple       Apple press release (iPad Air M4, 2026-03: "12GB of unified memory").
 * assumption  Widely reported but not re-verified for this table, or not yet
 *             released. Treat as Annahme.
 */
export type RamSource = 'xcode' | '9to5mac' | 'macrumors' | 'measured' | 'apple' | 'assumption'

/**
 * Metal GPU family, as Apple names them in the Metal feature set tables.
 * Apple3 = A9/A10, Apple5 = A12, Apple6 = A13, Apple7 = A14/M1,
 * Apple8 = A15/A16/M2, Apple9 = A17 Pro/A18/M3/M4, Apple10 = A19/M5.
 * Source for A12 and newer: Xcode 26.5 `device_traits.db`, column
 * GraphicsFeatureSetClass, read on 2026-10-08. A10 and A10X rows carry a
 * placeholder in that file; Apple3 for them is general knowledge (Annahme).
 */
export type MetalFamily = 'Apple3' | 'Apple5' | 'Apple6' | 'Apple7' | 'Apple8' | 'Apple9' | 'Apple10'

export interface AppleDevice {
  /** Marketing name. */
  name: string
  family: 'iphone' | 'ipad'
  /** `hw.machine` values, e.g. "iPhone15,4". Empty when not known yet. */
  identifiers: string[]
  chip: string
  gpuFamily: MetalFamily
  /** Nominal RAM in GB. */
  ramGb: number
  ramSource: RamSource
  /** Set when one identifier ships with two RAM sizes (storage tiers). */
  variant?: string
  note?: string
}

const iphone = (name: string, chip: string, gpuFamily: MetalFamily, ramGb: number, ramSource: RamSource, identifiers: string[], note?: string): AppleDevice =>
  ({ name, family: 'iphone', identifiers, chip, gpuFamily, ramGb, ramSource, ...(note ? { note } : {}) })

const ipad = (name: string, chip: string, gpuFamily: MetalFamily, ramGb: number, ramSource: RamSource, identifiers: string[], variant?: string): AppleDevice =>
  ({ name, family: 'ipad', identifiers, chip, gpuFamily, ramGb, ramSource, ...(variant ? { variant } : {}) })

/**
 * Every iPhone and iPad that runs iOS 17 / iPadOS 17 or newer.
 *
 * iOS 17 starts at iPhone XR, XS and SE (2nd generation). iPadOS 17 starts at
 * iPad (6th generation), iPad mini (5th generation), iPad Air (3rd generation),
 * iPad Pro 10.5-inch, iPad Pro 12.9-inch (2nd generation) and iPad Pro 11-inch.
 * Identifiers: Xcode 26.5 `device_traits.db`, read on 2026-10-08.
 */
export const APPLE_DEVICES: AppleDevice[] = [
  // iPhone
  iphone('iPhone XR', 'A12 Bionic', 'Apple5', 3, 'measured', ['iPhone11,8']),
  iphone('iPhone XS', 'A12 Bionic', 'Apple5', 4, 'measured', ['iPhone11,2']),
  iphone('iPhone XS Max', 'A12 Bionic', 'Apple5', 4, 'measured', ['iPhone11,4', 'iPhone11,6']),
  iphone('iPhone 11', 'A13 Bionic', 'Apple6', 4, 'measured', ['iPhone12,1']),
  iphone('iPhone 11 Pro', 'A13 Bionic', 'Apple6', 4, '9to5mac', ['iPhone12,3']),
  iphone('iPhone 11 Pro Max', 'A13 Bionic', 'Apple6', 4, 'measured', ['iPhone12,5']),
  iphone('iPhone SE (2nd generation)', 'A13 Bionic', 'Apple6', 3, 'assumption', ['iPhone12,8']),
  iphone('iPhone 12 mini', 'A14 Bionic', 'Apple7', 4, 'assumption', ['iPhone13,1']),
  iphone('iPhone 12', 'A14 Bionic', 'Apple7', 4, 'assumption', ['iPhone13,2']),
  iphone('iPhone 12 Pro', 'A14 Bionic', 'Apple7', 6, 'measured', ['iPhone13,3']),
  iphone('iPhone 12 Pro Max', 'A14 Bionic', 'Apple7', 6, 'xcode', ['iPhone13,4']),
  iphone('iPhone 13 mini', 'A15 Bionic', 'Apple8', 4, 'macrumors', ['iPhone14,4']),
  iphone('iPhone 13', 'A15 Bionic', 'Apple8', 4, 'macrumors', ['iPhone14,5']),
  iphone('iPhone 13 Pro', 'A15 Bionic', 'Apple8', 6, 'xcode', ['iPhone14,2']),
  iphone('iPhone 13 Pro Max', 'A15 Bionic', 'Apple8', 6, 'xcode', ['iPhone14,3']),
  iphone('iPhone SE (3rd generation)', 'A15 Bionic', 'Apple8', 4, 'macrumors', ['iPhone14,6']),
  iphone('iPhone 14', 'A15 Bionic', 'Apple8', 6, 'xcode', ['iPhone14,7']),
  iphone('iPhone 14 Plus', 'A15 Bionic', 'Apple8', 6, 'xcode', ['iPhone14,8']),
  iphone('iPhone 14 Pro', 'A16 Bionic', 'Apple8', 6, 'xcode', ['iPhone15,2']),
  iphone('iPhone 14 Pro Max', 'A16 Bionic', 'Apple8', 6, 'xcode', ['iPhone15,3']),
  iphone('iPhone 15', 'A16 Bionic', 'Apple8', 6, 'xcode', ['iPhone15,4']),
  iphone('iPhone 15 Plus', 'A16 Bionic', 'Apple8', 6, 'xcode', ['iPhone15,5']),
  iphone('iPhone 15 Pro', 'A17 Pro', 'Apple9', 8, 'xcode', ['iPhone16,1']),
  iphone('iPhone 15 Pro Max', 'A17 Pro', 'Apple9', 8, 'xcode', ['iPhone16,2']),
  iphone('iPhone 16', 'A18', 'Apple9', 8, 'xcode', ['iPhone17,3']),
  iphone('iPhone 16 Plus', 'A18', 'Apple9', 8, 'xcode', ['iPhone17,4']),
  iphone('iPhone 16 Pro', 'A18 Pro', 'Apple9', 8, 'xcode', ['iPhone17,1']),
  iphone('iPhone 16 Pro Max', 'A18 Pro', 'Apple9', 8, 'xcode', ['iPhone17,2']),
  iphone('iPhone 16e', 'A18', 'Apple9', 8, 'xcode', ['iPhone17,5']),
  iphone('iPhone 17', 'A19', 'Apple10', 8, 'xcode', ['iPhone18,3']),
  iphone('iPhone Air', 'A19 Pro', 'Apple10', 12, 'xcode', ['iPhone18,4']),
  iphone('iPhone 17 Pro', 'A19 Pro', 'Apple10', 12, 'xcode', ['iPhone18,1']),
  iphone('iPhone 17 Pro Max', 'A19 Pro', 'Apple10', 12, 'xcode', ['iPhone18,2']),
  iphone('iPhone 17e', 'A19', 'Apple10', 8, 'xcode', ['iPhone18,5']),
  // Released September 2026, after the Xcode on this machine. RAM from
  // MacRumors (read out of Xcode 27). Identifiers are not confirmed, so the
  // list stays empty and these devices are matched by reported RAM instead.
  // GPU family Apple10 is an Annahme (at least that of the A19).
  iphone('iPhone 18 Pro', 'A20 Pro', 'Apple10', 12, 'macrumors', [], 'identifier unconfirmed'),
  iphone('iPhone 18 Pro Max', 'A20 Pro', 'Apple10', 12, 'macrumors', [], 'identifier unconfirmed'),
  iphone('iPhone Duo', 'A20 Pro', 'Apple10', 12, 'assumption', [], 'same chip as iPhone 18 Pro, RAM not confirmed'),

  // iPad
  ipad('iPad (6th generation)', 'A10 Fusion', 'Apple3', 2, '9to5mac', ['iPad7,5', 'iPad7,6']),
  ipad('iPad (7th generation)', 'A10 Fusion', 'Apple3', 3, 'measured', ['iPad7,11', 'iPad7,12']),
  ipad('iPad (8th generation)', 'A12 Bionic', 'Apple5', 3, '9to5mac', ['iPad11,6', 'iPad11,7']),
  ipad('iPad (9th generation)', 'A13 Bionic', 'Apple6', 3, '9to5mac', ['iPad12,1', 'iPad12,2']),
  ipad('iPad (10th generation)', 'A14 Bionic', 'Apple7', 4, '9to5mac', ['iPad13,18', 'iPad13,19']),
  ipad('iPad (A16)', 'A16', 'Apple8', 6, 'xcode', ['iPad15,7', 'iPad15,8']),
  ipad('iPad mini (5th generation)', 'A12 Bionic', 'Apple5', 3, '9to5mac', ['iPad11,1', 'iPad11,2']),
  ipad('iPad mini (6th generation)', 'A15 Bionic', 'Apple8', 4, '9to5mac', ['iPad14,1', 'iPad14,2']),
  ipad('iPad mini (A17 Pro)', 'A17 Pro', 'Apple9', 8, 'xcode', ['iPad16,1', 'iPad16,2']),
  ipad('iPad Air (3rd generation)', 'A12 Bionic', 'Apple5', 3, '9to5mac', ['iPad11,3', 'iPad11,4']),
  ipad('iPad Air (4th generation)', 'A14 Bionic', 'Apple7', 4, '9to5mac', ['iPad13,1', 'iPad13,2']),
  ipad('iPad Air (5th generation)', 'M1', 'Apple7', 8, 'xcode', ['iPad13,16', 'iPad13,17']),
  ipad('iPad Air 11-inch (M2)', 'M2', 'Apple8', 8, 'xcode', ['iPad14,8', 'iPad14,9']),
  ipad('iPad Air 13-inch (M2)', 'M2', 'Apple8', 8, 'xcode', ['iPad14,10', 'iPad14,11']),
  ipad('iPad Air 11-inch (M3)', 'M3', 'Apple9', 8, 'xcode', ['iPad15,3', 'iPad15,4']),
  ipad('iPad Air 13-inch (M3)', 'M3', 'Apple9', 8, 'xcode', ['iPad15,5', 'iPad15,6']),
  ipad('iPad Air 11-inch (M4)', 'M4', 'Apple9', 12, 'apple', ['iPad16,8', 'iPad16,9']),
  ipad('iPad Air 13-inch (M4)', 'M4', 'Apple9', 12, 'apple', ['iPad16,10', 'iPad16,11']),
  ipad('iPad Pro (10.5-inch)', 'A10X Fusion', 'Apple3', 4, 'measured', ['iPad7,3', 'iPad7,4']),
  ipad('iPad Pro (12.9-inch) (2nd generation)', 'A10X Fusion', 'Apple3', 4, 'measured', ['iPad7,1', 'iPad7,2']),
  ipad('iPad Pro (11-inch)', 'A12X Bionic', 'Apple5', 4, 'measured', ['iPad8,1', 'iPad8,3'], 'up to 512 GB storage'),
  ipad('iPad Pro (11-inch)', 'A12X Bionic', 'Apple5', 6, '9to5mac', ['iPad8,2', 'iPad8,4'], '1 TB storage'),
  ipad('iPad Pro (12.9-inch) (3rd generation)', 'A12X Bionic', 'Apple5', 4, '9to5mac', ['iPad8,5', 'iPad8,7'], 'up to 512 GB storage'),
  ipad('iPad Pro (12.9-inch) (3rd generation)', 'A12X Bionic', 'Apple5', 6, 'measured', ['iPad8,6', 'iPad8,8'], '1 TB storage'),
  ipad('iPad Pro (11-inch) (2nd generation)', 'A12Z Bionic', 'Apple5', 6, '9to5mac', ['iPad8,9', 'iPad8,10']),
  ipad('iPad Pro (12.9-inch) (4th generation)', 'A12Z Bionic', 'Apple5', 6, '9to5mac', ['iPad8,11', 'iPad8,12']),
  ipad('iPad Pro (11-inch) (3rd generation)', 'M1', 'Apple7', 8, 'xcode', ['iPad13,4', 'iPad13,6'], 'up to 512 GB storage'),
  ipad('iPad Pro (11-inch) (3rd generation)', 'M1', 'Apple7', 16, 'xcode', ['iPad13,5', 'iPad13,7'], '1 TB and 2 TB storage'),
  ipad('iPad Pro (12.9-inch) (5th generation)', 'M1', 'Apple7', 8, 'xcode', ['iPad13,8', 'iPad13,10'], 'up to 512 GB storage'),
  ipad('iPad Pro (12.9-inch) (5th generation)', 'M1', 'Apple7', 16, 'xcode', ['iPad13,9', 'iPad13,11'], '1 TB and 2 TB storage'),
  // From here on both RAM sizes share one identifier; the reported RAM decides.
  ipad('iPad Pro (11-inch) (4th generation)', 'M2', 'Apple8', 8, 'xcode', ['iPad14,3', 'iPad14,4'], 'up to 512 GB storage'),
  ipad('iPad Pro (11-inch) (4th generation)', 'M2', 'Apple8', 16, 'xcode', ['iPad14,3', 'iPad14,4'], '1 TB and 2 TB storage'),
  ipad('iPad Pro (12.9-inch) (6th generation)', 'M2', 'Apple8', 8, 'xcode', ['iPad14,5', 'iPad14,6'], 'up to 512 GB storage'),
  ipad('iPad Pro (12.9-inch) (6th generation)', 'M2', 'Apple8', 16, 'xcode', ['iPad14,5', 'iPad14,6'], '1 TB and 2 TB storage'),
  ipad('iPad Pro 11-inch (M4)', 'M4', 'Apple9', 8, 'xcode', ['iPad16,3', 'iPad16,4'], 'up to 512 GB storage'),
  ipad('iPad Pro 11-inch (M4)', 'M4', 'Apple9', 16, 'xcode', ['iPad16,3', 'iPad16,4'], '1 TB and 2 TB storage'),
  ipad('iPad Pro 13-inch (M4)', 'M4', 'Apple9', 8, 'xcode', ['iPad16,5', 'iPad16,6'], 'up to 512 GB storage'),
  ipad('iPad Pro 13-inch (M4)', 'M4', 'Apple9', 16, 'xcode', ['iPad16,5', 'iPad16,6'], '1 TB and 2 TB storage'),
  ipad('iPad Pro 11-inch (M5)', 'M5', 'Apple10', 12, 'xcode', ['iPad17,1', 'iPad17,2'], 'up to 512 GB storage'),
  ipad('iPad Pro 11-inch (M5)', 'M5', 'Apple10', 16, 'xcode', ['iPad17,1', 'iPad17,2'], '1 TB and 2 TB storage'),
  ipad('iPad Pro 13-inch (M5)', 'M5', 'Apple10', 12, 'xcode', ['iPad17,3', 'iPad17,4'], 'up to 512 GB storage'),
  ipad('iPad Pro 13-inch (M5)', 'M5', 'Apple10', 16, 'xcode', ['iPad17,3', 'iPad17,4'], '1 TB and 2 TB storage'),
]

/** How sure a limit is. */
export type LimitKind = 'measured' | 'single-report' | 'assumption'

export interface MemoryBudget {
  platform: MobilePlatform
  /** RAM class in GB. */
  ramGb: number
  /**
   * Assumed hard ceiling for the app's memory footprint in MB (MiB), without
   * any entitlement. The fit rule never plans up to this number, see
   * FIT_SHARE and TIGHT_SHARE in lib/device-fit.ts.
   */
  limitMb: number
  limitKind: LimitKind
  /** Where limitMb comes from. */
  limitSource: string
  /**
   * iOS only: ceiling with `com.apple.developer.kernel.increased-memory-limit`.
   * Equal to limitMb where no higher limit is known.
   */
  increasedLimitMb: number
  increasedLimitKind: LimitKind
  increasedLimitSource: string
  /** Context length the app starts a chat with on this class. */
  defaultContext: number
}

const SO = 'Stack Overflow answer 15200855, crash threshold measured with a memory fill tool'
const FORUM = 'Apple Developer Forums thread 834805, one report, no reply from Apple'

/**
 * iOS and iPadOS, by RAM class. The value is the LOWEST limit known for any
 * device of the class, so an iPad that was measured higher (iPad Pro 10.5:
 * 3057 MB of 4 GB) still gets the iPhone figure of its class.
 *
 * defaultContext: 2048 up to 4 GB, 4096 above, from IOS-MACHBARKEIT.md 4.5.
 */
export const IOS_MEMORY_BUDGETS: MemoryBudget[] = [
  {
    platform: 'ios', ramGb: 2,
    // Measured on 2 GB devices of the previous generation: iPad Air 2 1383 MB,
    // iPhone 7 1395 MB. The iPad (6th generation) itself was not measured: Annahme
    // that it behaves like them. 1380 rounds the lowest reading down.
    limitMb: 1380, limitKind: 'measured', limitSource: `${SO} (iPad Air 2 1383 MB, iPhone 7 1395 MB)`,
    // No report of a higher limit on 2 GB devices: Annahme, unchanged.
    increasedLimitMb: 1380, increasedLimitKind: 'assumption', increasedLimitSource: 'Annahme: entitlement has no effect on this class',
    defaultContext: 2048,
  },
  {
    platform: 'ios', ramGb: 3,
    // iPhone XR 1792 MB (iOS 12.1). iPad (7th generation) measured higher, 1844 MB.
    limitMb: 1790, limitKind: 'measured', limitSource: `${SO} (iPhone XR 1792 MB)`,
    increasedLimitMb: 1790, increasedLimitKind: 'assumption', increasedLimitSource: 'Annahme: entitlement has no effect on this class',
    defaultContext: 2048,
  },
  {
    platform: 'ios', ramGb: 4,
    // iPhone XS 2040 MB, XS Max 2039 MB, 11 2068 MB, 11 Pro Max 2067 MB.
    // Apple Developer Forums thread 688973 names "ActiveHard 2098 MB" for 4 GB iPhones.
    limitMb: 2040, limitKind: 'measured', limitSource: `${SO} (iPhone XS 2040 MB, iPhone 11 2068 MB)`,
    increasedLimitMb: 2040, increasedLimitKind: 'assumption', increasedLimitSource: 'Annahme: entitlement has no effect on this class',
    defaultContext: 2048,
  },
  {
    platform: 'ios', ramGb: 6,
    // iPhone 12 Pro 3054 MB (iOS 16.1). For iPhone 13 Pro, 14 and 15 this is an
    // Annahme: same class, not measured.
    limitMb: 3050, limitKind: 'measured', limitSource: `${SO} (iPhone 12 Pro 3054 MB); newer 6 GB devices Annahme`,
    increasedLimitMb: 3050, increasedLimitKind: 'assumption', increasedLimitSource: 'Annahme: no report of a higher limit on 6 GB devices',
    defaultContext: 4096,
  },
  {
    platform: 'ios', ramGb: 8,
    // Annahme: half of the RAM, the old rule of thumb. Not measured anywhere.
    limitMb: 4000, limitKind: 'assumption', limitSource: 'Annahme: about 50 percent of RAM',
    // iPhone 16 Pro Max, about 6144 MB with the entitlement.
    increasedLimitMb: 6144, increasedLimitKind: 'single-report', increasedLimitSource: `${FORUM} (iPhone 16 Pro Max, about 6144 MB)`,
    defaultContext: 4096,
  },
  {
    platform: 'ios', ramGb: 12,
    // Annahme: deliberately the same as 8 GB until someone measures it.
    limitMb: 4000, limitKind: 'assumption', limitSource: 'Annahme: same as the 8 GB class until measured',
    // iPhone 17 Pro Max, about 6144 MB with the entitlement.
    increasedLimitMb: 6144, increasedLimitKind: 'single-report', increasedLimitSource: `${FORUM} (iPhone 17 Pro Max, about 6144 MB)`,
    defaultContext: 4096,
  },
  {
    platform: 'ios', ramGb: 16,
    // Only iPad Pro with 1 TB or more. Annahme: same as the 8 GB class.
    limitMb: 4000, limitKind: 'assumption', limitSource: 'Annahme: same as the 8 GB class until measured',
    // Annahme: at least what the 8 and 12 GB iPhones were reported with.
    increasedLimitMb: 6144, increasedLimitKind: 'assumption', increasedLimitSource: 'Annahme: same as the 12 GB class',
    defaultContext: 4096,
  },
]

const ANDROID_NOTE = 'Annahme: Android has no fixed per app limit for native memory. The low memory killer decides by system pressure.'

/**
 * Android, by RAM class. Every limit here is an Annahme: Android does not cap
 * native (malloc, mmap) memory per app, it kills the largest background and,
 * under pressure, foreground processes. The figures are what a freshly booted
 * device of the class typically has free for one foreground app, rounded down.
 * At load time the engine additionally checks the memory the system reports as
 * available (see lib/device-fit.ts), and the lower of the two wins.
 *
 * There is no entitlement on Android, so the increased fields repeat limitMb.
 */
export const ANDROID_MEMORY_BUDGETS: MemoryBudget[] = [
  // 42 percent of RAM. Annahme. Set so that the smallest catalog models
  // (about 0.3 to 0.4 GB files) still count as fitting on a 3 GB phone.
  android(3, 1300, 2048),
  // 44 percent of RAM. Annahme.
  android(4, 1800, 2048),
  // 49 percent of RAM. Annahme.
  android(6, 3000, 4096),
  // 51 percent of RAM. Annahme.
  android(8, 4200, 4096),
  // 53 percent of RAM. Annahme.
  android(12, 6500, 4096),
  // 55 percent of RAM. Annahme.
  android(16, 9000, 4096),
]

function android(ramGb: number, limitMb: number, defaultContext: number): MemoryBudget {
  return {
    platform: 'android', ramGb, limitMb, limitKind: 'assumption', limitSource: ANDROID_NOTE,
    increasedLimitMb: limitMb, increasedLimitKind: 'assumption', increasedLimitSource: 'not applicable on Android',
    defaultContext,
  }
}

export const MEMORY_BUDGETS: Record<MobilePlatform, MemoryBudget[]> = {
  ios: IOS_MEMORY_BUDGETS,
  android: ANDROID_MEMORY_BUDGETS,
}

/** RAM classes per platform, ascending. */
export const RAM_CLASSES: Record<MobilePlatform, number[]> = {
  ios: IOS_MEMORY_BUDGETS.map((b) => b.ramGb),
  android: ANDROID_MEMORY_BUDGETS.map((b) => b.ramGb),
}

/**
 * All table rows for a `hw.machine` identifier. More than one row means the
 * identifier ships with two RAM sizes and the reported RAM has to decide.
 */
export function appleDevicesByIdentifier(identifier: string): AppleDevice[] {
  const wanted = identifier.trim().toLowerCase()
  if (!wanted) return []
  return APPLE_DEVICES.filter((d) => d.identifiers.some((id) => id.toLowerCase() === wanted))
}

/** Budget row for an exact RAM class, or undefined when the class does not exist. */
export function memoryBudget(platform: MobilePlatform, ramGb: number): MemoryBudget | undefined {
  return MEMORY_BUDGETS[platform].find((b) => b.ramGb === ramGb)
}

/**
 * The RAM class a device belongs to: the largest class whose nominal size the
 * device reaches to at least 85 percent. Devices report less than their
 * nominal RAM (a 6 GB iPhone reports 5.57 GB, a 3 GB one 2.75 GB), and a
 * 10 GB Android phone has to count as 8, not 12. Undefined below the smallest
 * class.
 */
export function ramClassFor(platform: MobilePlatform, ramGb: number): MemoryBudget | undefined {
  if (!Number.isFinite(ramGb) || ramGb <= 0) return undefined
  let hit: MemoryBudget | undefined
  for (const row of MEMORY_BUDGETS[platform]) {
    if (row.ramGb * 0.85 <= ramGb) hit = row
  }
  return hit
}
