// @vitest-environment jsdom
/**
 * Gap L7 (mobile-docs/r38/luecken.md, fixed in r39/restore.md). When the
 * WebView drops localStorage as a whole, the start takes the full restore
 * (boot/restore.ts) and only what the native backup carries comes back. The
 * mark of the thinking default and the queue of unsent reports had only the
 * IndexedDB copy of settings-durable.ts, which does not help there: thinking
 * was switched off again over the user's choice, and a report the user was
 * told is "saved and sent later" was lost without a word.
 *
 * The walk below holds every localStorage name the phone shell declares
 * against the backup list. A new key fails it until somebody decides.
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const world = vi.hoisted(() => ({ backup: {} as Record<string, string> }))

vi.mock('../../../api/backend', () => ({
  isTauri: () => true,
  backendCall: async (cmd: string) => {
    if (cmd === 'restore_stores') return JSON.stringify(world.backup)
    if (cmd === 'is_onboarding_done') return true
    return null
  },
}))

const MOBILE = join(dirname(fileURLToPath(import.meta.url)), '../..')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === '__tests__') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

/**
 * Names under src/mobile that are not in the native backup, each with the
 * reason. Some are not localStorage at all (a vault name, a database).
 */
const NOT_IN_BACKUP: Record<string, string> = {
  // Their own native home.
  'lu-mobile-age': 'native vault (policy/age-vault.ts)',
  'lu-mobile-ai-consent': 'native vault (policy/decision-vault.ts)',
  'lu-mobile-notify-offered': 'native vault (policy/decision-vault.ts)',
  'lu-age-declaration': 'name in the native vault, not localStorage',
  'lu-ai-consent': 'name in the native vault, not localStorage',
  'lu-notify-offered': 'name in the native vault, not localStorage',
  'lu-store-journal': 'name in the native vault, not localStorage',
  'lu-document-journal': 'name in the native vault, not localStorage',
  'lu-mobile-remote-token': 'a secret: Keystore or Keychain, never a backup that travels',
  // Bookkeeping of the backup and the restore themselves.
  'lu-restore-complete': 'set again by every start',
  'lu-mobile-document-removals': 'held against the backup at the start (lib/document-list-recovery.ts); after a full restore the list is the one of the backup',
  'lu-mobile-settings-copy': 'name of an alert, not a stored value',
  'lu-mobile-settings-recovered': 'sessionStorage guard against a reload loop',
  'lu-mobile-warm-reload': 'sessionStorage mark of a restart by the app itself (nav/restore.ts), never outlives the process',
  // Short lived or derived.
  'lu-mobile-chat-drafts': 'text of an unsent draft; attachments are gone with IndexedDB anyway',
  'lu-mobile-first-question': 'written for milliseconds until the chat store has the question',
  'lu-mobile-onboarding-model': 'the model picked during the onboarding, which is done',
  'lu-mobile-nav': 'the screen that was open; the app starts on its root',
  'lu-mobile-last-speed': 'the last measured speed, measured again with the next answer',
  'lu-mobile-memory-learning-decided': 'only read before the onboarding is done; the restored settings say it is',
  'lu-computer-create-models': 'models of the computer, asked again from its capabilities',
  'lu-computer-create-jobs': 'open jobs on the computer; the computer keeps its jobs and results, the picture is made again from there',
  'lu-remote-outbox': 'messages that wait for the computer this phone is paired with; a restored phone is paired anew',
  'lu-remote-notices': 'the switch for notices of the computer, on by default and set again with one tap',
  'lu-remote-notices-offered': 'the question for notices was put once; on a restored phone the system has its own answer, and the switch asks again',
  'lu-create-computer-tool': 'the last picked tool of Create on My computer, picked again with one tap',
  'lu-create-source': 'the last picked source in Create (LU Cloud or My computer), picked again with one tap',
  // Not localStorage at all.
  'lu-mobile-settings-mirror': 'name of the IndexedDB copy of the settings',
  'lu-computer-media': 'name of the IndexedDB of results from the computer; they stay on the computer',
  'lu-keychain-probe': 'account of a keychain probe',
  'lu-mobile-theme-change': 'name of an event',
  'lu-preview-error': 'name of a message of the preview frame',
  'lu-preview-ready': 'name of a message of the preview frame',
  'lu-test-device': 'name of an event of the tests',
  // Developer and test switches.
  'lu-mobile-dev': 'developer switch',
  'lu-mobile-device': 'pretended device of the tests',
  'lu-test-store-preset': 'test hook',
}

describe('every localStorage name of the phone shell is in the backup or named (gap L7)', () => {
  it('walks src/mobile', async () => {
    const { STORE_KEYS } = await import('../../../lib/store-backup')
    const found = new Map<string, string>()
    for (const file of sourceFiles(MOBILE)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/\bconst\s+[A-Z][A-Z0-9_]*\s*(?::\s*string\s*)?=\s*'(lu-[a-z0-9-]+)'/g)) {
        found.set(m[1], file.slice(MOBILE.length + 1))
      }
    }
    // The walk must see the keys it is about, or it guards nothing.
    for (const known of ['lu-mobile-thinking-default-v1', 'lu-mobile-report-queue', 'lu-mobile-age', 'lu-mobile-theme']) {
      expect([...found.keys()], known).toContain(known)
    }
    const undecided = [...found].filter(([key]) => !STORE_KEYS.includes(key) && !(key in NOT_IN_BACKUP)).map(([key, file]) => `${file}: ${key}`)
    expect(undecided).toEqual([])
    const both = Object.keys(NOT_IN_BACKUP).filter((key) => STORE_KEYS.includes(key))
    expect(both).toEqual([])
  })
})

describe('after localStorage was dropped as a whole', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    sessionStorage.clear()
    Object.defineProperty(window, 'location', { value: { ...window.location, reload: vi.fn() }, configurable: true })
  })

  it('the snapshot carries the thinking mark and the waiting reports', async () => {
    localStorage.setItem('lu-mobile-thinking-default-v1', 'off')
    localStorage.setItem('lu-mobile-report-queue', '[{"reportId":"r1"}]')
    const { collectStoreSnapshot } = await import('../../../lib/store-backup')
    const snap = await collectStoreSnapshot()
    expect(snap['lu-mobile-thinking-default-v1']).toBe('off')
    expect(snap['lu-mobile-report-queue']).toBe('[{"reportId":"r1"}]')
  })

  it('a queue that was sent empty goes into the snapshot as empty, so the backup does not keep the sent reports', async () => {
    const { sendReport, setReportTransportForTests } = await import('../../policy/report')
    setReportTransportForTests(async () => 'sent')
    try {
      expect(await sendReport({ kind: 'message', id: 'm1', model: 'x', source: 'local', reason: 'hate' })).toBe('sent')
    } finally {
      setReportTransportForTests(null)
    }
    const { collectStoreSnapshot } = await import('../../../lib/store-backup')
    expect((await collectStoreSnapshot())['lu-mobile-report-queue']).toBe('[]')
  })

  it('the full restore puts them back, so thinking stays as chosen and the report still waits', async () => {
    world.backup = {
      'chat-settings': '{"state":{"settings":{"thinkingEnabled":true}}}',
      'lu-mobile-thinking-default-v1': 'off',
      'lu-mobile-report-queue': '[{"reportId":"r1"}]',
    }
    const { runStoreRestore } = await import('../restore')
    expect((await runStoreRestore()).kind).toBe('reloading')
    expect(localStorage.getItem('lu-mobile-thinking-default-v1')).toBe('off')
    expect(localStorage.getItem('lu-mobile-report-queue')).toBe('[{"reportId":"r1"}]')
    const { claimThinkingDefault } = await import('../../screens/chat/parts/thinking-default')
    // The mark is back: the start does not switch thinking off again.
    expect(claimThinkingDefault(localStorage)).toBe(false)
  })
})
