// @vitest-environment jsdom
/**
 * Acceptance android-4gb, F9: the app never asked for notifications, and a
 * download in the background showed none.
 *
 * The rule (parts/notify.ts, NotifyRule.kt): the first download says in a
 * sentence what the notification is for, then the system asks. A no stands
 * and is not asked again. The switch on the storage page leads to the
 * settings of the system where the app may not ask. The download never
 * waits for the system.
 *
 * Run: npx vitest run src/mobile/screens/models/__tests__/notify-question.test.ts
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const native = vi.hoisted(() => ({
  state: { granted: false, needed: true, asked: false } as { granted: boolean; needed: boolean; asked: boolean },
  /** What the user answers to the system: null leaves the question open for ever. */
  systemAnswer: true as boolean | null,
  asks: 0,
  order: [] as string[],
}))
const navMock = vi.hoisted(() => ({ answer: true, specs: [] as Array<{ title: string; text?: string; testid?: string; risk?: string; confirmLabel: string; cancelLabel?: string }> }))
const door = vi.hoisted(() => ({ started: [] as string[] }))
vi.mock('../parts/adapters/downloads', () => ({
  startFile: async (file: { filename: string }) => {
    native.order.push('start')
    door.started.push(file.filename)
    return { answer: 'started' }
  },
}))
vi.mock('../../../../api/discover', () => ({
  luEngineDownloadDir: async () => '/models',
  checkDownloadSpace: async () => ({ ok: true, freeBytes: 64e9, neededBytes: 0 }),
}))
vi.mock('../parts/download-state', async (orig) => ({ ...(await orig<typeof import('../parts/download-state')>()), spaceShortfall: () => null }))
vi.mock('../../../ui', () => ({ toast: () => {} }))
vi.mock('../../../nav', () => ({
  nav: {
    confirm: async (spec: (typeof navMock.specs)[number]) => {
      native.order.push('sentence')
      navMock.specs.push(spec)
      return navMock.answer
    },
    push: () => {},
  },
}))

import { __setBridgeForTests } from '../../../platform/bridge'
import { notifyStatusOf } from '../../../platform/notifications'
import { MODELS_STRINGS as S } from '../../../strings/models'
import type { FitView } from '../parts/fit'
import { NOTIFY_OFFERED_KEY, offerNotifications, shouldOffer, switchAction } from '../parts/notify'
import { startDownload } from '../parts/start-download'

const FIT = { level: 'ok', needBytes: 0, usableBytes: 0, coarse: false, nearLimit: false } as unknown as FitView
const FILES = [{ filename: 'model.gguf', url: 'https://huggingface.co/a/b/resolve/main/model.gguf', expectedBytes: 1000 }]
const download = () => startDownload({ name: 'Model', files: FILES as never, fit: FIT })

beforeEach(() => {
  localStorage.clear()
  native.state = { granted: false, needed: true, asked: false }
  native.systemAnswer = true
  native.asks = 0
  native.order = []
  navMock.answer = true
  navMock.specs = []
  door.started = []
  __setBridgeForTests({
    connectionInfo: async () => ({ kind: 'wifi', metered: false, wifiOnly: false }),
    notificationState: async () => ({ ...native.state }),
    requestNotificationPermission: () => {
      native.order.push('system')
      // What NotifyRule.kt does: the question is put once, a refusal stands.
      if (native.state.granted || native.state.asked) return Promise.resolve(native.state.granted)
      native.asks += 1
      native.state.asked = true
      if (native.systemAnswer === null) return new Promise<boolean>(() => {})
      native.state.granted = native.systemAnswer
      return Promise.resolve(native.systemAnswer)
    },
  })
})

afterAll(() => __setBridgeForTests(undefined))

describe('the state the system reports', () => {
  it('is read into four cases', () => {
    expect(notifyStatusOf({ granted: true, needed: true, asked: false })).toBe('granted')
    expect(notifyStatusOf({ granted: false, needed: true, asked: false })).toBe('open')
    expect(notifyStatusOf({ granted: false, needed: true, asked: true })).toBe('refused')
    // iOS, the desktop, a browser: nothing to ask for.
    expect(notifyStatusOf({ granted: true, needed: false, asked: false })).toBe('not-needed')
    expect(notifyStatusOf(null)).toBe('not-needed')
    // A plugin older than this page answers `{ granted: true }` only.
    expect(notifyStatusOf({ granted: true })).toBe('not-needed')
    // Before Android 13 there is no question; off means switched off in the system settings.
    expect(notifyStatusOf({ granted: false, needed: false, asked: false })).toBe('refused')
  })

  it('only "never asked" is a reason for the sentence, and only once', () => {
    expect(shouldOffer('open', false)).toBe(true)
    expect(shouldOffer('open', true)).toBe(false)
    expect(shouldOffer('refused', false)).toBe(false)
    expect(shouldOffer('granted', false)).toBe(false)
    expect(shouldOffer('not-needed', false)).toBe(false)
  })
})

describe('the first download', () => {
  it('says what the notification is for, then the system asks, and the download starts', async () => {
    expect(await download()).toBe('started')
    expect(navMock.specs).toHaveLength(1)
    const spec = navMock.specs[0]
    expect(spec.testid).toBe('notify')
    expect(spec.title).toBe(S.notify.title)
    // One sentence about what it is for, and that the system asks next.
    expect(spec.text).toMatch(/progress of a download in a notification/)
    expect(spec.text).toMatch(/asks for permission next/)
    // The button that brings up the dialog of the system is marked, so a sweep does not tap it.
    expect(spec.risk).toBe('leaves-app')
    expect(native.asks).toBe(1)
    expect(native.order).toEqual(['sentence', 'system', 'start'])
    expect(door.started).toEqual(['model.gguf'])
  })

  it('does not wait for the answer of the system', async () => {
    native.systemAnswer = null
    expect(await download()).toBe('started')
    expect(native.asks).toBe(1)
    expect(door.started).toEqual(['model.gguf'])
  })

  it('"Not now" is a no: the system is not asked, the download runs, and no later download asks again', async () => {
    navMock.answer = false
    expect(await download()).toBe('started')
    expect(native.asks).toBe(0)
    expect(localStorage.getItem(NOTIFY_OFFERED_KEY)).toBe('1')
    navMock.answer = true
    expect(await download()).toBe('started')
    expect(await download()).toBe('started')
    expect(navMock.specs).toHaveLength(1)
    expect(native.asks).toBe(0)
  })

  it('a no to the system stands: the next download asks nothing', async () => {
    native.systemAnswer = false
    await download()
    expect(native.asks).toBe(1)
    await download()
    await download()
    expect(navMock.specs).toHaveLength(1)
    expect(native.asks).toBe(1)
  })

  it('a yes is not asked again either', async () => {
    await download()
    await download()
    expect(navMock.specs).toHaveLength(1)
    expect(native.asks).toBe(1)
  })

  it('a refusal the page forgot (lost storage) is still a refusal: native code remembers', async () => {
    native.state = { granted: false, needed: true, asked: true }
    localStorage.clear()
    await offerNotifications()
    expect(navMock.specs).toHaveLength(0)
    expect(native.asks).toBe(0)
  })

  it('nothing is asked where the system has no such question (iOS, an older Android)', async () => {
    native.state = { granted: true, needed: false, asked: false }
    expect(await download()).toBe('started')
    expect(navMock.specs).toHaveLength(0)
    expect(native.asks).toBe(0)
  })

  it('a native layer that does not answer does not hold the download', async () => {
    __setBridgeForTests({
      connectionInfo: async () => ({ kind: 'wifi', metered: false, wifiOnly: false }),
      notificationState: () => new Promise(() => {}),
    })
    vi.useFakeTimers()
    try {
      const pending = download()
      await vi.advanceTimersByTimeAsync(2000)
      expect(await pending).toBe('started')
    } finally {
      vi.useRealTimers()
    }
    expect(navMock.specs).toHaveLength(0)
  })
})

describe('the switch on the storage page', () => {
  it('asks while the question is open, and leads to the settings of the system otherwise', () => {
    expect(switchAction('open')).toBe('ask')
    expect(switchAction('refused')).toBe('system-settings')
    expect(switchAction('granted')).toBe('system-settings')
  })

  it('carries the mark of a row that leaves the app, and says so', () => {
    const page = readFileSync(resolve(__dirname, '../StoragePage.tsx'), 'utf8')
    const row = page.slice(page.indexOf('m-settings-storage-notify') - 400, page.indexOf('m-settings-storage-notify') + 300)
    expect(row).toContain('risk="leaves-app"')
    expect(S.notify.rowRefused).toMatch(/Opens the settings of your phone/)
    expect(S.notify.rowOnHint).toMatch(/Opens the settings of your phone/)
  })
})

describe('native code', () => {
  const PLUGIN = resolve(__dirname, '../../../../../src-tauri/plugins/lu-native')
  const read = (path: string) => readFileSync(resolve(PLUGIN, path), 'utf8')

  it('Android: the command asks the rule, notes the question before it is put, and can be asked for the state alone', () => {
    const plugin = read('android/src/main/java/com/purpledoubled/lunative/LuNativePlugin.kt')
    const command = plugin.slice(plugin.indexOf('fun requestNotificationPermission'), plugin.indexOf('fun notificationPermissionResult'))
    expect(command).toContain('NotifyRule.step(')
    expect(command).toContain('args.ask')
    expect(command.indexOf('NotifyRule.noteAsked(activity)')).toBeGreaterThan(-1)
    expect(command.indexOf('NotifyRule.noteAsked(activity)')).toBeLessThan(command.indexOf('requestPermissions('))
    expect(read('src/commands.rs')).toContain('"ask": ask.unwrap_or(true)')
  })

  it('iOS: LU posts no notification, so nothing is needed and nothing is asked', () => {
    const sources = ['Downloads.swift', 'LuNativePlugin.swift', 'Extras.swift'].map((f) => read(`ios/Sources/${f}`)).join('\n')
    expect(sources).not.toMatch(/UNUserNotificationCenter|UNMutableNotificationContent|requestAuthorization/)
    expect(read('ios/Sources/LuNativePlugin.swift')).toContain('"needed": false')
  })
})
