import { describe, expect, it } from 'vitest'
import {
  ANDROID_MEMORY_BUDGETS,
  APPLE_DEVICES,
  IOS_MEMORY_BUDGETS,
  MEMORY_BUDGETS,
  RAM_CLASSES,
  appleDevicesByIdentifier,
  memoryBudget,
} from '../device-memory'

describe('Apple device table', () => {
  it('lists the iOS 17 floor and the current top of both families', () => {
    const names = new Set(APPLE_DEVICES.map((d) => d.name))
    for (const name of [
      'iPhone XR', 'iPhone XS', 'iPhone SE (2nd generation)', 'iPhone 15', 'iPhone 16e', 'iPhone 17 Pro Max', 'iPhone Air',
      'iPad (6th generation)', 'iPad mini (5th generation)', 'iPad Air (3rd generation)', 'iPad Pro (10.5-inch)',
      'iPad Pro (12.9-inch) (2nd generation)', 'iPad Pro (11-inch)', 'iPad Pro 13-inch (M5)', 'iPad Air 13-inch (M4)',
    ]) expect(names, name).toContain(name)
    // Not on iOS 17: nothing with an A11 or older phone chip, no iPad (5th generation).
    for (const name of ['iPhone X', 'iPhone 8', 'iPad (5th generation)', 'iPad Pro (9.7-inch)']) expect(names.has(name), name).toBe(false)
  })

  it('gives every device a RAM figure that is one of the iOS classes, a chip, a GPU family and a source', () => {
    for (const d of APPLE_DEVICES) {
      expect(RAM_CLASSES.ios, d.name).toContain(d.ramGb)
      expect(d.chip.length, d.name).toBeGreaterThan(1)
      expect(d.gpuFamily, d.name).toMatch(/^Apple(3|5|6|7|8|9|10)$/)
      expect(['xcode', '9to5mac', 'macrumors', 'measured', 'apple', 'assumption'], d.name).toContain(d.ramSource)
    }
  })

  it('uses well formed identifiers of the right family', () => {
    for (const d of APPLE_DEVICES) {
      for (const id of d.identifiers) {
        expect(id, d.name).toMatch(d.family === 'iphone' ? /^iPhone\d+,\d+$/ : /^iPad\d+,\d+$/)
      }
    }
  })

  it('shares an identifier only between RAM variants of one model', () => {
    const seen = new Map<string, { name: string; ram: number[] }>()
    for (const d of APPLE_DEVICES) {
      for (const id of d.identifiers) {
        const prior = seen.get(id)
        if (!prior) { seen.set(id, { name: d.name, ram: [d.ramGb] }); continue }
        expect(prior.name, id).toBe(d.name)
        expect(prior.ram, id).not.toContain(d.ramGb)
        expect(d.variant, id).toBeTruthy()
        prior.ram.push(d.ramGb)
      }
    }
  })

  it('finds devices by identifier, both RAM sizes where one identifier has two', () => {
    expect(appleDevicesByIdentifier('iPhone15,4').map((d) => d.name)).toEqual(['iPhone 15'])
    expect(appleDevicesByIdentifier('iphone11,8')[0].ramGb).toBe(3)
    expect(appleDevicesByIdentifier('iPad16,3').map((d) => d.ramGb).sort((a, b) => a - b)).toEqual([8, 16])
    expect(appleDevicesByIdentifier('iPad8,2').map((d) => d.ramGb)).toEqual([6])
    expect(appleDevicesByIdentifier('arm64')).toEqual([])
    expect(appleDevicesByIdentifier('')).toEqual([])
  })

  it('pins the RAM of the devices the budget rows were measured on', () => {
    const ram = (name: string) => APPLE_DEVICES.filter((d) => d.name === name).map((d) => d.ramGb)
    expect(ram('iPhone XR')).toEqual([3])
    expect(ram('iPhone XS')).toEqual([4])
    expect(ram('iPhone 11')).toEqual([4])
    expect(ram('iPhone 12 Pro')).toEqual([6])
    expect(ram('iPhone 15')).toEqual([6])
    expect(ram('iPhone 16 Pro Max')).toEqual([8])
    expect(ram('iPhone 17 Pro Max')).toEqual([12])
    expect(ram('iPad (6th generation)')).toEqual([2])
  })
})

describe('memory budgets', () => {
  it('pins the iOS rows from IOS-MACHBARKEIT.md 4.5', () => {
    const rows = IOS_MEMORY_BUDGETS.map((b) => [b.ramGb, b.limitMb, b.increasedLimitMb, b.limitKind, b.defaultContext])
    expect(rows).toEqual([
      [2, 1380, 1380, 'measured', 2048],
      [3, 1790, 1790, 'measured', 2048],
      [4, 2040, 2040, 'measured', 2048],
      [6, 3050, 3050, 'measured', 4096],
      [8, 4000, 6144, 'assumption', 4096],
      [12, 4000, 6144, 'assumption', 4096],
      [16, 4000, 6144, 'assumption', 4096],
    ])
  })

  it('pins the Android classes and marks every one of them an assumption', () => {
    expect(ANDROID_MEMORY_BUDGETS.map((b) => [b.ramGb, b.limitMb])).toEqual([
      [3, 1300], [4, 1800], [6, 3000], [8, 4200], [12, 6500], [16, 9000],
    ])
    for (const b of ANDROID_MEMORY_BUDGETS) {
      expect(b.limitKind).toBe('assumption')
      expect(b.increasedLimitMb).toBe(b.limitMb)
    }
  })

  it('never assumes a limit above two thirds of the RAM, never lets a larger class have less, and names a source', () => {
    for (const platform of ['ios', 'android'] as const) {
      let previous = 0
      for (const b of MEMORY_BUDGETS[platform]) {
        expect(b.platform).toBe(platform)
        expect(b.limitMb, `${platform} ${b.ramGb}`).toBeLessThanOrEqual(b.ramGb * 1024 * 0.68)
        expect(b.increasedLimitMb).toBeGreaterThanOrEqual(b.limitMb)
        expect(b.increasedLimitMb).toBeLessThanOrEqual(b.ramGb * 1024 * 0.76)
        expect(b.limitMb).toBeGreaterThanOrEqual(previous)
        expect(b.limitSource.length).toBeGreaterThan(10)
        expect(b.increasedLimitSource.length).toBeGreaterThan(10)
        expect([2048, 4096]).toContain(b.defaultContext)
        previous = b.limitMb
      }
    }
  })

  it('says Annahme wherever the kind is an assumption', () => {
    for (const b of [...IOS_MEMORY_BUDGETS, ...ANDROID_MEMORY_BUDGETS]) {
      if (b.limitKind === 'assumption') expect(b.limitSource, `${b.platform} ${b.ramGb}`).toContain('Annahme')
    }
  })

  it('looks a class up exactly', () => {
    expect(memoryBudget('ios', 6)?.limitMb).toBe(3050)
    expect(memoryBudget('android', 2)).toBeUndefined()
    expect(memoryBudget('ios', 5)).toBeUndefined()
  })
})
